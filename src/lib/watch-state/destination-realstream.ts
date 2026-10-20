// GATED RealStream destination prototype: pure, transport-injected, UI-free.
// Do not expose this adapter as a product destination. Official Windows client
// 1.0.1+2 testing on 2026-10-19 found a different provider-prefixed identity and
// normalized-progress format. Even a native-format import appeared in Continue
// Watching but did not resume reliably. See scratch-validation/realstream-live-20261019/report.md.
//
// Interface for runtime integration (the parent owns factories/session wrappers):
//   createRealStreamWatchDestination(options) -> WatchStateDestination
//   options: { connectionId, label, subject, scope, open(signal) }
//   options.open(signal) resolves AFTER re-verifying the connection/user and returns a
//   user-pinned transport:
//     { fetchPage(page, perPage, signal) -> { items, totalItems },
//       writeRecord(recordId | null, entries, signal) }   // PATCH when recordId, POST when null
//   This module owns entry matching, array-preserving write decisions and readback verification.
//
// Verified RealStream contracts behind this adapter (evidence in
// scratch-validation/watch-destinations-20261019/nuvio-realstream.md):
//   - PocketBase `progress` collection: paged reads with honest totalItems; each record is
//     { id, user, data } where data is the FULL ARRAY of progress entries, and writes replace
//     that array wholesale. There is no atomic compare-and-swap and no timestamp sort/filter.
//   - Progress entries are client-authored JSON with the live-verified key set
//     { uniqueId, mediaType 'tv'|'movie', seasonNumber, episodeNumber, currentTime seconds,
//       duration seconds, lastWatched epoch ms, title, posterPath (embeds the IMDb id) }.
//   - RealStream tracks current progress only: watched flags and play counts do not exist, and
//     none are invented. Only resume points are imported, and only for IMDb-identifiable titles.
import type { MigrationWriteResult, WatchStateDestination, WatchStatePatch, WatchStateRecord } from './types.ts'
import { canonicalWatchIdentity, sourceTime, watchFingerprint } from './records.ts'
import type { RealStreamProgressPage } from './source-realstream.ts'

export interface RealStreamWatchDestinationTransport {
    /** Paged read of the pinned user's progress records; totalItems may be NaN when the server omits it. */
    fetchPage(page: number, perPage: number, signal: AbortSignal): Promise<RealStreamProgressPage>
    /** Replaces one record's full data array (PATCH), or creates the user's record when recordId is null (POST). */
    writeRecord(recordId: string | null, entries: Record<string, unknown>[], signal: AbortSignal): Promise<unknown>
}

export interface RealStreamWatchDestinationOptions {
    connectionId: string
    label: string
    subject: string
    scope: string
    /** Returns a verified, user-pinned transport; the runtime wrapper owns auth and identity re-checks. */
    open(signal: AbortSignal): Promise<RealStreamWatchDestinationTransport>
}

const PER_PAGE = 200
const MAX_PAGES = 50
const IMDb_IN_POSTER = /(tt\d{5,})/i
const IMDB_IDENTITY = /^(movie|episode):imdb:(tt\d{5,})(?::(\d+):(\d+))?$/
const READBACK_FAILED = 'The RealStream write could not be verified by reading the list back. Preview again to check whether it was saved.'

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function intOrNull(value: unknown): number | null {
    return Number.isSafeInteger(value) ? (value as number) : null
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function positiveDuration(value: unknown): number | null {
    const number = finiteNumber(value)
    return number !== null && number > 0 ? number : null
}

function secondsToMs(value: unknown): number | null {
    const seconds = typeof value === 'number' ? value : typeof value === 'string' && value !== '' && Number.isFinite(Number(value)) ? Number(value) : NaN
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null
}

function firstNonEmpty(...values: Array<unknown>): string | null {
    for (const value of values) if (typeof value === 'string' && value) return value
    return null
}

/** Stable deep-stringify for preservation checks (records.ts keeps its own private copy). */
function ordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(ordered)
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]))
    }
    return value
}

function stableStringify(value: unknown): string {
    return JSON.stringify(ordered(value))
}

interface RealStreamEntryHit {
    identity: string
    imdb: string
    type: 'movie' | 'episode'
    season: number | null
    episode: number | null
    entry: Record<string, unknown>
}

/** Derives an entry's identity exactly like source-realstream.ts: IMDb from the poster path. */
function entryHit(entry: Record<string, unknown>): RealStreamEntryHit | null {
    const posterPath = typeof entry.posterPath === 'string' ? entry.posterPath : typeof entry.poster_path === 'string' ? entry.poster_path : ''
    const imdb = IMDb_IN_POSTER.exec(posterPath)?.[1] ?? null
    if (imdb === null) return null
    const rawType = entry.mediaType ?? entry.media_type ?? entry.type
    const normalizedType = rawType != null ? String(rawType).toLowerCase() : ''
    const season = intOrNull(entry.seasonNumber ?? entry.season_number ?? entry.season)
    const episode = intOrNull(entry.episodeNumber ?? entry.episode_number ?? entry.episode)
    let type: 'movie' | 'episode' | null = null
    if (normalizedType === 'movie') type = 'movie'
    else if (normalizedType === 'tv' || season !== null && episode !== null) type = 'episode'
    if (type === null) return null
    const identity = canonicalWatchIdentity(type, imdb, season ?? undefined, episode ?? undefined)
    return identity === null ? null : { identity, imdb, type, season, episode, entry }
}

/** Only IMDb identities can be written to a RealStream entry (the poster path carries the id). */
function imdbIdentity(identity: string): { imdb: string; type: 'movie' | 'episode'; season?: number; episode?: number } | null {
    const match = IMDB_IDENTITY.exec(identity)
    if (!match) return null
    if (match[1] === 'movie') return match[3] === undefined ? { imdb: match[2], type: 'movie' } : null
    if (match[3] === undefined || match[4] === undefined) return null
    const season = Number(match[3])
    const episode = Number(match[4])
    if (!Number.isSafeInteger(season) || !Number.isSafeInteger(episode)) return null
    return { imdb: match[2], type: 'episode', season, episode }
}

interface RealStreamContainer {
    id: string
    data: Record<string, unknown>[]
}

interface RealStreamRead {
    containers: RealStreamContainer[]
    broken: Array<{ id: string; data: unknown }>
    complete: boolean
    capped: boolean
}

/** Paged read of every progress record, mirroring the source adapter's completeness guards. */
async function readAll(transport: RealStreamWatchDestinationTransport, signal: AbortSignal): Promise<RealStreamRead> {
    let total: number | null = null
    let complete = true
    let capped = false
    let repeated = false
    let totalsUnverified = false
    let movingTotal = false
    let previousPageKey: string | null = null
    const raw: Array<{ id: string; data: unknown }> = []
    let page = 1
    for (; page <= MAX_PAGES; page++) {
        signal.throwIfAborted()
        const result = await transport.fetchPage(page, PER_PAGE, signal)
        if (!isRecord(result) || !Array.isArray(result.items)) throw new Error('RealStream returned an unexpected response shape; nothing was interpreted as data.')
        if (typeof result.totalItems === 'number' && Number.isFinite(result.totalItems) && result.totalItems >= 0) {
            if (total === null) total = result.totalItems
            else if (result.totalItems !== total) { movingTotal = true; complete = false }
        } else {
            totalsUnverified = true
            complete = false
        }
        const pageKey = `${result.items.length}:${result.items.map(item => (isRecord(item) && typeof item.id === 'string' ? item.id : '')).join(',')}`
        if (result.items.length === PER_PAGE && previousPageKey !== null && pageKey === previousPageKey) {
            repeated = true
            complete = false
            break
        }
        for (const item of result.items) {
            if (!isRecord(item) || typeof item.id !== 'string' || !item.id) throw new Error('RealStream returned a progress record without a usable id; nothing was interpreted as data.')
            raw.push({ id: item.id, data: item.data })
        }
        if (result.items.length < PER_PAGE) break
        previousPageKey = pageKey
    }
    if (page > MAX_PAGES) {
        capped = true
        complete = false
    }
    const containers: RealStreamContainer[] = []
    const broken: Array<{ id: string; data: unknown }> = []
    for (const record of raw) {
        if (Array.isArray(record.data) && record.data.every(isRecord)) containers.push({ id: record.id, data: record.data as Record<string, unknown>[] })
        else broken.push(record)
    }
    if (broken.length > 0) complete = false
    if (total !== null && total > raw.length) complete = false
    return { containers, broken, complete: complete && !capped && !repeated && !totalsUnverified && !movingTotal, capped }
}

async function recordFromEntry(scope: string, hit: RealStreamEntryHit): Promise<WatchStateRecord> {
    const positionMs = secondsToMs(hit.entry.currentTime ?? hit.entry.current_time ?? hit.entry.progress ?? hit.entry.position)
    const durationMs = secondsToMs(hit.entry.duration ?? hit.entry.total_duration ?? hit.entry.runtime)
    const playedAt = sourceTime(hit.entry.lastWatched ?? hit.entry.last_watched ?? hit.entry.timestamp)
    const record: WatchStateRecord = {
        id: hit.type === 'movie' ? `movie:${hit.imdb}` : `episode:${hit.imdb}:${hit.season}:${hit.episode}`,
        title: firstNonEmpty(hit.entry.title, hit.entry.name) ?? 'RealStream entry',
        type: hit.type,
        identities: [hit.identity],
        playedAt,
        fingerprint: await watchFingerprint({ scope, entry: hit.entry }),
    }
    if (hit.type === 'episode') {
        record.season = hit.season ?? undefined
        record.episode = hit.episode ?? undefined
    }
    if (positionMs !== null) record.positionMs = positionMs
    if (durationMs !== null) record.durationMs = durationMs
    return record
}

async function placeholderRecord(scope: string, identity: string, type: 'movie' | 'episode', season: number | null, episode: number | null, imdb: string, expected: WatchStateRecord): Promise<WatchStateRecord> {
    const durationMs = positiveDuration(expected.durationMs)
    const record: WatchStateRecord = {
        id: type === 'movie' ? `movie:${imdb}` : `episode:${imdb}:${season}:${episode}`,
        title: expected.title || imdb,
        type,
        identities: [identity],
        watched: false,
        positionMs: 0,
        playedAt: null,
        playCount: 0,
        unmodified: true,
        fingerprint: await watchFingerprint({ scope, absent: true, identity, durationMs }),
    }
    if (type === 'episode') {
        record.season = season ?? undefined
        record.episode = episode ?? undefined
    }
    if (durationMs !== null) record.durationMs = durationMs
    return record
}

/** Builds the entry to append: only verified fields, no invented timestamps or ids. */
function buildEntry(parts: { imdb: string; type: 'movie' | 'episode'; season?: number; episode?: number }, patch: WatchStatePatch, expected: WatchStateRecord, durationMs: number | null): Record<string, unknown> {
    const entry: Record<string, unknown> = parts.type === 'episode'
        ? { uniqueId: `tv_${parts.imdb}_s${parts.season}e${parts.episode}`, mediaType: 'tv', seasonNumber: parts.season, episodeNumber: parts.episode }
        : { uniqueId: `movie_${parts.imdb}`, mediaType: 'movie' }
    entry.currentTime = (patch.positionMs as number) / 1000
    if (durationMs !== null) entry.duration = durationMs / 1000
    if (patch.playedAt !== undefined) entry.lastWatched = patch.playedAt
    entry.title = expected.title
    entry.posterPath = parts.type === 'episode' ? `/poster/series/${parts.imdb}` : `/poster/movie/${parts.imdb}`
    return entry
}

export function createRealStreamWatchDestination(options: RealStreamWatchDestinationOptions): WatchStateDestination {
    const { connectionId, label, subject, scope } = options
    const capabilities: WatchStateDestination['capabilities'] = {
        watched: false,
        resume: true,
        dates: false,
        counts: false,
        combined: false,
        notes: [
            'All reads and writes stay pinned to one verified RealStream user.',
            'RealStream stores current progress only: watched flags and play counts cannot be imported, and none are invented.',
            'Each imported entry carries the resume point alone; no watch time is stamped on it when the source has none.',
            'Progress lives in one shared list per account: every write re-reads the list first, preserves every other entry exactly, and verifies the saved result by reading it back.',
            'That list has no atomic compare-and-swap: a write racing the RealStream app or another device can still be lost even with this verification. Import while playback is stopped.',
            'Imported entries embed the verified IMDb id in their poster path so the destination can re-identify them; the RealStream app may not display poster images for them.',
        ],
    }

    // Preview-resolution cache: the exact read behind this instance's last successful resolve()
    // chain. Only resolve() fills it; apply() always reads live state and drops the cache.
    let previewRead: Promise<RealStreamRead> | null = null
    const ensureRead = (signal: AbortSignal): Promise<RealStreamRead> => {
        if (previewRead === null) {
            const built = (async () => {
                const transport = await options.open(signal)
                signal.throwIfAborted()
                return readAll(transport, signal)
            })()
            previewRead = built
            built.catch(() => {
                if (previewRead === built) previewRead = null
            })
        }
        return previewRead
    }

    async function resolve(record: WatchStateRecord, signal: AbortSignal): Promise<WatchStateRecord[]> {
        signal.throwIfAborted()
        if (!record.identities.length) return []
        const read = await ensureRead(signal)
        const matches: WatchStateRecord[] = []
        for (const container of read.containers) {
            for (const entry of container.data) {
                const hit = entryHit(entry)
                if (hit === null || !record.identities.includes(hit.identity)) continue
                matches.push(await recordFromEntry(scope, hit))
            }
        }
        if (matches.length > 0) return matches
        if (!read.complete) throw new Error('The RealStream progress list could not be read completely, so matches cannot be verified safely. Try the preview again.')
        for (const identity of record.identities) {
            const parts = imdbIdentity(identity)
            if (parts !== null) return [await placeholderRecord(scope, identity, parts.type, parts.season ?? null, parts.episode ?? null, parts.imdb, record)]
        }
        return []
    }

    async function apply(expected: WatchStateRecord, patch: WatchStatePatch, signal: AbortSignal): Promise<MigrationWriteResult> {
        signal.throwIfAborted()
        previewRead = null
        if (patch.watched === true || patch.playCount !== undefined) {
            return { status: 'conflict', message: 'RealStream stores current progress only: watched flags and play counts cannot be imported.' }
        }
        const wantsPosition = typeof patch.positionMs === 'number'
        if (!wantsPosition) return { status: 'unchanged', message: 'Nothing was selected to import for this title.' }
        const positionMs = patch.positionMs as number
        if (!Number.isFinite(positionMs) || positionMs <= 0) {
            return { status: 'conflict', message: 'The proposed resume point is invalid; nothing was written.' }
        }

        const transport = await options.open(signal)
        signal.throwIfAborted()
        const read = await readAll(transport, signal)
        if (!read.complete) throw new Error('The RealStream progress list could not be read completely, so this import cannot be verified safely. Preview again.')

        const entryMatches: RealStreamEntryHit[] = []
        for (const container of read.containers) {
            for (const entry of container.data) {
                const hit = entryHit(entry)
                if (hit !== null && expected.identities.includes(hit.identity)) entryMatches.push(hit)
            }
        }
        if (entryMatches.length > 1) {
            return { status: 'conflict', message: 'More than one destination entry matches this title. They will be kept; resolve the duplicates first.', record: await recordFromEntry(scope, entryMatches[0]) }
        }
        if (entryMatches.length === 1) {
            const current = secondsToMs(entryMatches[0].entry.currentTime ?? entryMatches[0].entry.current_time ?? entryMatches[0].entry.progress ?? entryMatches[0].entry.position)
            const currentTime = sourceTime(entryMatches[0].entry.lastWatched ?? entryMatches[0].entry.last_watched)
            const record = await recordFromEntry(scope, entryMatches[0])
            if (current === patch.positionMs && (patch.playedAt === undefined || currentTime === patch.playedAt)) {
                return { status: 'unchanged', message: 'The destination already has the selected state. Nothing was written.', record }
            }
            return { status: 'conflict', message: 'The destination entry changed since the preview. It will be kept; preview again.', record }
        }

        const parts = expected.identities.map(imdbIdentity).find((value): value is { imdb: string; type: 'movie' | 'episode'; season?: number; episode?: number } => value !== null) ?? null
        if (parts === null) {
            return { status: 'conflict', message: 'This title has no IMDb identity, so RealStream cannot store a resume point for it.' }
        }
        const durationMs = positiveDuration(patch.durationMs) ?? positiveDuration(expected.durationMs)
        const entry = buildEntry(parts, patch, expected, durationMs)
        const container = read.containers[0] ?? null
        const sentData = container ? [...container.data, entry] : [entry]
        await transport.writeRecord(container ? container.id : null, sentData, signal)

        // Exact readback: the saved entry, every pre-existing entry, and every other record.
        const check = await readAll(transport, signal)
        if (!check.complete) throw new Error(READBACK_FAILED)
        const saved: RealStreamEntryHit[] = []
        for (const checked of check.containers) {
            for (const checkedEntry of checked.data) {
                const hit = entryHit(checkedEntry)
                if (hit !== null && expected.identities.includes(hit.identity)) saved.push(hit)
            }
        }
        if (saved.length !== 1) throw new Error(READBACK_FAILED)
        if (secondsToMs(saved[0].entry.currentTime) !== patch.positionMs) throw new Error(READBACK_FAILED)
        if (durationMs !== null && secondsToMs(saved[0].entry.duration) !== durationMs) throw new Error(READBACK_FAILED)
        if (patch.playedAt !== undefined && sourceTime(saved[0].entry.lastWatched) !== patch.playedAt) throw new Error(READBACK_FAILED)
        // Preservation: every pre-existing entry and record must survive the write exactly.
        // A concurrent foreign append may legitimately appear; a loss of any baseline entry may not.
        const afterEntries = check.containers.flatMap(candidate => candidate.data)
        const afterEntryKeys = new Set(afterEntries.map(entry => stableStringify(entry)))
        const anotherWriter = 'Another writer changed the RealStream progress list during the import. The write could not be verified; preview again.'
        for (const before of read.containers) {
            if (!check.containers.some(candidate => candidate.id === before.id)) throw new Error(anotherWriter)
            for (const entry of before.data) {
                if (!afterEntryKeys.has(stableStringify(entry))) throw new Error(anotherWriter)
            }
        }
        for (const before of read.broken) {
            const after = check.broken.find(candidate => candidate.id === before.id) ?? check.containers.find(candidate => candidate.id === before.id)
            if (after === undefined || stableStringify(after.data) !== stableStringify(before.data)) throw new Error(anotherWriter)
        }
        if (container !== null) {
            if (!check.containers.some(candidate => candidate.id === container.id)) throw new Error(READBACK_FAILED)
        } else {
            const created = check.containers.filter(candidate => !read.containers.some(before => before.id === candidate.id) && !read.broken.some(before => before.id === candidate.id))
            if (created.length !== 1) throw new Error(READBACK_FAILED)
        }
        return { status: 'applied', message: 'Saved and verified by an exact readback.', record: await recordFromEntry(scope, saved[0]) }
    }

    return { connectionId, label, subject, scope, capabilities, resolve, apply }
}
