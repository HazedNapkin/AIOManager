import type { MigrationProgress, WatchStateRecord, WatchStateSnapshot, WatchStateSource } from './types.ts'
import { canonicalWatchIdentity, sourceTime, watchFingerprint } from './records.ts'

export type NuvioPullRpc = (fn: 'sync_pull_watched_items' | 'sync_pull_watch_progress', body: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>

export interface NuvioWatchSourceOptions {
    connectionId: string
    label: string
    subject: string
    scope: string
    open(signal: AbortSignal): Promise<{ rpc: NuvioPullRpc; profileIndex: number }>
}

const CONTENT_ID = /^(?:tt\d{5,}|tmdb:\d+)$/
const PAGE_SIZE = 1_000
const MAX_ROWS = 5_000
const MAX_PAGES = 100

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function intOrUndefined(value: unknown): number | undefined {
    return Number.isSafeInteger(value) ? (value as number) : undefined
}

function positiveDuration(value: unknown): number | null {
    const number = finiteNumber(value)
    return number !== null && number > 0 ? number : null
}

function epochMs(value: unknown): number | null {
    const time = sourceTime(value)
    return time !== null && time >= 100_000_000_000 ? time : null
}

function resultRows(result: unknown, fn: string): unknown[] {
    if (Array.isArray(result)) return result
    if (isRecord(result)) {
        for (const key of ['items', 'rows', 'entries', 'list', 'data', 'results']) {
            const value = result[key]
            if (Array.isArray(value)) return value
        }
    }
    throw new Error(`Nuvio ${fn} returned an unexpected response shape; nothing was interpreted as data.`)
}

function firstString(...values: Array<unknown>): string | null {
    for (const value of values) if (typeof value === 'string' && value) return value
    return null
}

interface RowTarget {
    identity: string
    contentId: string
    type: 'movie' | 'episode'
    season?: number
    episode?: number
}

interface UnmappedRow {
    id: string
    row: Record<string, unknown>
    note: string
}

function parseRowTarget(entry: unknown, fn: string, index: number): { target: RowTarget | null; unmapped: UnmappedRow | null } {
    if (!isRecord(entry)) throw new Error(`Nuvio ${fn} returned a malformed row; refusing to guess.`)
    const contentId = entry.content_id
    const fallbackId = `nuvio:${fn}:${index}`
    if (typeof contentId !== 'string' || !CONTENT_ID.test(contentId)) {
        return { target: null, unmapped: { id: typeof contentId === 'string' && contentId ? `nuvio:${contentId}` : fallbackId, row: entry, note: 'This Nuvio entry has no recognizable movie or episode identifier, so it is listed as unmatched.' } }
    }
    const contentType = entry.content_type === 'movie' ? 'movie' : entry.content_type === 'series' ? 'series' : null
    if (!contentType) {
        return { target: null, unmapped: { id: `nuvio:${contentId}`, row: entry, note: 'This Nuvio entry has no recognizable movie or episode identifier, so it is listed as unmatched.' } }
    }
    if (contentType === 'movie') {
        const identity = canonicalWatchIdentity('movie', contentId)
        return identity
            ? { target: { identity, contentId, type: 'movie' }, unmapped: null }
            : { target: null, unmapped: { id: `nuvio:${contentId}`, row: entry, note: 'This Nuvio entry has no recognizable movie or episode identifier, so it is listed as unmatched.' } }
    }
    const season = intOrUndefined(entry.season)
    const episode = intOrUndefined(entry.episode)
    const identity = canonicalWatchIdentity('episode', contentId, season, episode)
    if (!identity) {
        return { target: null, unmapped: { id: `nuvio:${contentId}:${season ?? ''}:${episode ?? ''}`, row: entry, note: 'This Nuvio series entry has no season and episode, so it cannot be matched to an episode and is listed as unmatched.' } }
    }
    return { target: { identity, contentId, type: 'episode', season, episode }, unmapped: null }
}

async function pullWatched(profileIndex: number, rpc: NuvioPullRpc, signal: AbortSignal, unmapped: Map<string, UnmappedRow>): Promise<{ rows: Map<string, { target: RowTarget; row: Record<string, unknown> }>; complete: boolean }> {
    const byIdentity = new Map<string, { target: RowTarget; row: Record<string, unknown> }>()
    let complete = true
    let previousPageKey: string | null = null
    let seen = 0
    for (let page = 1; page <= MAX_PAGES; page++) {
        signal.throwIfAborted()
        const result = await rpc('sync_pull_watched_items', { p_profile_id: profileIndex, p_page: page, p_page_size: PAGE_SIZE }, signal)
        const rows = resultRows(result, 'sync_pull_watched_items')
        if (rows.length === 0) break
        const pageIdentities: string[] = []
        for (const [index, entry] of rows.entries()) {
            const parsed = parseRowTarget(entry, 'sync_pull_watched_items', seen + index)
            if (parsed.unmapped) {
                unmapped.set(parsed.unmapped.id, parsed.unmapped)
                continue
            }
            if (!parsed.target) continue
            pageIdentities.push(parsed.target.identity)
            const row = entry as Record<string, unknown>
            const existing = byIdentity.get(parsed.target.identity)
            if (!existing || (epochMs(row.watched_at) ?? -1) >= (epochMs(existing.row.watched_at) ?? -1)) byIdentity.set(parsed.target.identity, { target: parsed.target, row })
        }
        const pageKey = pageIdentities.length > 0 ? pageIdentities.join('|') : null
        if (pageKey !== null && previousPageKey !== null && pageKey === previousPageKey) {
            complete = false
            break
        }
        if (pageKey !== null) previousPageKey = pageKey
        seen += rows.length
        if (rows.length < PAGE_SIZE) break
        if (seen >= MAX_ROWS) { complete = false; break }
    }
    return { rows: byIdentity, complete }
}

async function pullProgress(profileIndex: number, rpc: NuvioPullRpc, signal: AbortSignal, unmapped: Map<string, UnmappedRow>): Promise<{ rows: Map<string, { target: RowTarget; row: Record<string, unknown> }>; complete: boolean }> {
    const byIdentity = new Map<string, { target: RowTarget; row: Record<string, unknown> }>()
    let complete = true
    let cursor = 0
    let seen = 0
    for (let page = 1; page <= MAX_PAGES; page++) {
        signal.throwIfAborted()
        const result = await rpc('sync_pull_watch_progress', { p_profile_id: profileIndex, p_since_last_watched: cursor, p_limit: PAGE_SIZE }, signal)
        const rows = resultRows(result, 'sync_pull_watch_progress')
        if (rows.length === 0) break
        let pageMax: number | null = null
        for (const [index, entry] of rows.entries()) {
            const parsed = parseRowTarget(entry, 'sync_pull_watch_progress', seen + index)
            if (parsed.unmapped) {
                unmapped.set(parsed.unmapped.id, parsed.unmapped)
                continue
            }
            if (!parsed.target) continue
            const row = entry as Record<string, unknown>
            const time = epochMs(row.last_watched)
            if (time !== null && (pageMax === null || time > pageMax)) pageMax = time
            const existing = byIdentity.get(parsed.target.identity)
            const existingTime = existing ? epochMs(existing.row.last_watched) : null
            if (!existing || (time !== null && (existingTime === null || time >= existingTime))) byIdentity.set(parsed.target.identity, { target: parsed.target, row })
        }
        seen += rows.length
        if (pageMax !== null && pageMax <= cursor) { complete = false; break }
        if (rows.length >= PAGE_SIZE) complete = false
        if (rows.length < PAGE_SIZE) break
        if (seen >= MAX_ROWS) { complete = false; break }
        if (pageMax !== null) cursor = pageMax
    }
    return { rows: byIdentity, complete }
}

export function createNuvioWatchSource(options: NuvioWatchSourceOptions): WatchStateSource {
    const { connectionId, label, subject, scope } = options
    const notes = [
        'This source is pinned to one Nuvio profile; other profiles of the account are not read.',
        'Nuvio stores completion and resume times independently; when a title has both, the original completion time is used as its watch date.',
    ]

    async function read(signal: AbortSignal, progress?: MigrationProgress): Promise<WatchStateSnapshot> {
        signal.throwIfAborted()
        const { rpc, profileIndex } = await options.open(signal)
        signal.throwIfAborted()
        const unmapped = new Map<string, UnmappedRow>()
        progress?.('Reading the Nuvio profile watch history…')
        const [watched, resume] = await Promise.all([
            pullWatched(profileIndex, rpc, signal, unmapped),
            pullProgress(profileIndex, rpc, signal, unmapped),
        ])
        signal.throwIfAborted()
        const identities = new Set([...watched.rows.keys(), ...resume.rows.keys()])
        const records: WatchStateRecord[] = []
        for (const identity of identities) {
            const historyHit = watched.rows.get(identity) ?? null
            const progressHit = resume.rows.get(identity) ?? null
            const target = (historyHit ?? progressHit) as { target: RowTarget; row: Record<string, unknown> }
            const historyRow = historyHit?.row ?? null
            const progressRow = progressHit?.row ?? null
            const hasHistory = historyRow !== null
            const position = progressRow ? finiteNumber(progressRow.position) : null
            const positionMs = position !== null && position > 0 ? Math.round(position) : null
            const duration = progressRow ? positiveDuration(progressRow.duration) : null
            const watchedAt = historyRow ? epochMs(historyRow.watched_at) : null
            const lastWatched = progressRow ? epochMs(progressRow.last_watched) : null
            const videoId = progressRow && typeof progressRow.video_id === 'string' ? progressRow.video_id : null
            const record: WatchStateRecord = {
                id: target.target.type === 'movie' ? `movie:${target.target.contentId}` : `episode:${target.target.contentId}:${target.target.season}:${target.target.episode}`,
                title: firstString(historyRow?.title, progressRow?.title) ?? target.target.contentId,
                type: target.target.type,
                identities: [identity],
                watched: hasHistory,
                playedAt: watchedAt ?? lastWatched,
                fingerprint: await watchFingerprint({ scope, identity, watched: hasHistory, positionMs, durationMs: duration, watchedAt, lastWatched, videoId }),
            }
            if (target.target.type === 'episode') {
                record.season = target.target.season
                record.episode = target.target.episode
            }
            if (positionMs !== null) record.positionMs = positionMs
            if (duration !== null) record.durationMs = Math.round(duration)
            records.push(record)
        }
        for (const row of unmapped.values()) {
            const position = finiteNumber(row.row.position)
            const playedAt = epochMs(row.row.watched_at) ?? epochMs(row.row.last_watched)
            const record: WatchStateRecord = {
                id: row.id,
                title: firstString(row.row.title) ?? 'Nuvio entry',
                type: 'unknown',
                identities: [],
                playedAt,
                notes: [row.note],
                fingerprint: await watchFingerprint({ scope, row: row.row }),
            }
            if (position !== null && position > 0) record.positionMs = Math.round(position)
            records.push(record)
        }
        records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        const complete = watched.complete && resume.complete
        const snapshotNotes = [...notes]
        if (!complete) snapshotNotes.push('The Nuvio read is partial: rows past a pagination boundary may be missing, and absence is never assumed.')
        return { connectionId, label, subject, scope, records, complete, notes: snapshotNotes }
    }

    return { read }
}
