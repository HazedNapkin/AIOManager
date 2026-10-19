import type { MigrationProgress, WatchStateRecord, WatchStateSnapshot, WatchStateSource } from './types.ts'
import { canonicalWatchIdentity, sourceTime, watchFingerprint } from './records.ts'
import { decodeWatchedBitfield } from '../watched-bitfield.ts'

export interface StremioSeriesVideo {
    id: string
    season?: number | null
    episode?: number | null
}

export interface StremioWatchSourceOptions {
    connectionId: string
    label: string
    subject: string
    scope: string
    open(signal: AbortSignal): Promise<{ request: (body: Record<string, unknown>, signal: AbortSignal) => Promise<unknown> }>
    seriesVideos?(id: string): Promise<StremioSeriesVideo[] | null>
}

const PROVIDER_ITEM_ID = /^(?:tt\d{5,}|tmdb:\d+)$/
const MAX_LIBRARY_ITEMS = 10_000
const METADATA_CONCURRENCY = 4

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

function libraryEntries(result: unknown): unknown[] {
    if (Array.isArray(result)) return result
    if (isRecord(result) && Array.isArray(result.library)) return result.library
    throw new Error('Stremio returned an unexpected library shape; nothing was interpreted as data.')
}

interface LibraryItem {
    raw: Record<string, unknown>
    id: string
    name: string
    kind: 'movie' | 'series' | null
    state: Record<string, unknown>
}

function parseLibraryItem(entry: unknown): LibraryItem {
    if (!isRecord(entry)) throw new Error('Stremio returned a malformed library item; refusing to guess.')
    const id = entry._id
    if (typeof id !== 'string' || !id) throw new Error('Stremio returned a malformed library item; refusing to guess.')
    return {
        raw: entry,
        id,
        name: typeof entry.name === 'string' && entry.name ? entry.name : id,
        kind: entry.type === 'movie' ? 'movie' : entry.type === 'series' || entry.type === 'anime' ? 'series' : null,
        state: isRecord(entry.state) ? entry.state : {},
    }
}

function hasAnyState(state: Record<string, unknown>): boolean {
    if (positiveDuration(state.timeOffset) !== null) return true
    if ((finiteNumber(state.flaggedWatched) ?? 0) > 0) return true
    if ((finiteNumber(state.timesWatched) ?? 0) > 0) return true
    if (epochMs(state.lastWatched) !== null) return true
    if (typeof state.watched === 'string' && state.watched !== '') return true
    if (intOrUndefined(state.season) !== undefined || intOrUndefined(state.episode) !== undefined) return true
    if (typeof state.video_id === 'string' && state.video_id !== '') return true
    return false
}

function preservedItem(item: Record<string, unknown>): Record<string, unknown> {
    const clone: Record<string, unknown> = { ...item }
    delete clone._mtime
    return clone
}

async function itemFingerprint(scope: string, item: Record<string, unknown>, episode?: string): Promise<string> {
    return watchFingerprint(episode === undefined ? { scope, item: preservedItem(item) } : { scope, item: preservedItem(item), episode })
}

async function unmappedRecord(scope: string, item: LibraryItem, notes: string[]): Promise<WatchStateRecord> {
    return {
        id: `stremio:${item.id}`,
        title: item.name,
        type: 'unknown',
        identities: [],
        playedAt: null,
        notes,
        fingerprint: await itemFingerprint(scope, item.raw),
    }
}

async function movieRecords(scope: string, item: LibraryItem): Promise<WatchStateRecord[]> {
    const identity = canonicalWatchIdentity('movie', item.id)
    if (!identity) return []
    const flaggedWatched = finiteNumber(item.state.flaggedWatched)
    const timesWatched = finiteNumber(item.state.timesWatched)
    const watched = (flaggedWatched !== null && flaggedWatched > 0) || (timesWatched !== null && timesWatched > 0)
    const rawOffset = finiteNumber(item.state.timeOffset)
    const offset = rawOffset !== null && rawOffset > 0 ? Math.round(rawOffset) : null
    const lastWatchedAt = epochMs(item.state.lastWatched)
    if (!watched && offset === null && lastWatchedAt === null) return []
    const record: WatchStateRecord = {
        id: `movie:${item.id}`,
        title: item.name,
        type: 'movie',
        identities: [identity],
        watched,
        playedAt: lastWatchedAt,
        fingerprint: await itemFingerprint(scope, item.raw),
    }
    if (offset !== null) record.positionMs = offset
    const durationMs = positiveDuration(item.state.duration)
    if (durationMs !== null) record.durationMs = Math.round(durationMs)
    const playCount = intOrUndefined(timesWatched)
    if (playCount !== undefined && playCount >= 0) record.playCount = playCount
    return [record]
}

function resumeVideoVerified(itemId: string, season: number, episode: number, videoId: string | null, videos: StremioSeriesVideo[] | null): boolean {
    if (videos) {
        const match = videos.find(video => video.season === season && video.episode === episode)
        return !!match && (!videoId || match.id === videoId)
    }
    return videoId === `${itemId}:${season}:${episode}`
}

interface EpisodeAccumulator {
    season?: number
    episode?: number
    watched: boolean
    positionMs?: number
    durationMs?: number
}

async function seriesRecords(scope: string, item: LibraryItem, videos: StremioSeriesVideo[] | null): Promise<WatchStateRecord[]> {
    const episodes = new Map<string, EpisodeAccumulator>()
    const surfaced = new Map<string, WatchStateRecord>()
    const surface = async (notes: string[]) => {
        const record = await unmappedRecord(scope, item, notes)
        const existing = surfaced.get(record.id)
        if (existing) existing.notes = [...(existing.notes || []), ...(record.notes || [])]
        else surfaced.set(record.id, record)
    }
    const state = item.state
    const flaggedWatched = finiteNumber(state.flaggedWatched)
    const timesWatched = finiteNumber(state.timesWatched)
    const markedWatched = (flaggedWatched !== null && flaggedWatched > 0) || (timesWatched !== null && timesWatched > 0)
    let decodedBits = 0
    if (typeof state.watched === 'string' && state.watched !== '') {
        const decoded = await decodeWatchedBitfield(state.watched)
        if (!decoded) {
            await surface(['The watched-episode data for this series could not be decoded, so it is listed as unmatched.'])
        } else if (decoded.watchedIndices.length > 0) {
            decodedBits = decoded.watchedIndices.length
            if (!videos) {
                await surface(['Episode order for this series could not be verified, so its watched episodes are listed as unmatched.'])
            } else {
                const anchor = videos[Math.max(...decoded.watchedIndices)]
                if (!anchor || decoded.videoId !== anchor.id) {
                    await surface(['The watched-episode alignment for this series could not be verified, so it is listed as unmatched.'])
                } else {
                    let unmappedBits = 0
                    for (const index of decoded.watchedIndices) {
                        const video = videos[index]
                        const identity = video ? canonicalWatchIdentity('episode', item.id, video.season ?? undefined, video.episode ?? undefined) : null
                        if (!identity) {
                            unmappedBits++
                            continue
                        }
                        const accumulator = episodes.get(identity) ?? { season: video?.season ?? undefined, episode: video?.episode ?? undefined, watched: false }
                        accumulator.watched = true
                        episodes.set(identity, accumulator)
                    }
                    if (unmappedBits > 0) {
                        await surface([`${unmappedBits} watched episode${unmappedBits === 1 ? '' : 's'} in this series could not be identified, so ${unmappedBits === 1 ? 'it is' : 'they are'} listed as unmatched.`])
                    }
                }
            }
        }
    }
    if (markedWatched && decodedBits === 0) {
        await surface(['This series is marked watched in Stremio, but no per-episode watch data is stored for it, so its episodes are listed as unmatched.'])
    }
    const offset = finiteNumber(state.timeOffset)
    const season = intOrUndefined(state.season)
    const episode = intOrUndefined(state.episode)
    const identity = canonicalWatchIdentity('episode', item.id, season, episode)
    if (identity && season !== undefined && episode !== undefined && offset !== null && offset > 0) {
        const videoId = typeof state.video_id === 'string' ? state.video_id : null
        if (resumeVideoVerified(item.id, season, episode, videoId, videos)) {
            const accumulator = episodes.get(identity) ?? { season, episode, watched: false }
            accumulator.positionMs = Math.round(offset)
            const durationMs = positiveDuration(state.duration)
            if (durationMs !== null) accumulator.durationMs = Math.round(durationMs)
            episodes.set(identity, accumulator)
        } else {
            await surface(['The series resume point could not be matched to an episode, so it is listed as unmatched.'])
        }
    }
    const records: WatchStateRecord[] = [...surfaced.values()]
    for (const [episodeIdentity, accumulator] of episodes) {
        const record: WatchStateRecord = {
            id: `episode:${item.id}:${accumulator.season}:${accumulator.episode}`,
            title: item.name,
            type: 'episode',
            identities: [episodeIdentity],
            season: accumulator.season,
            episode: accumulator.episode,
            watched: accumulator.watched,
            playedAt: null,
            fingerprint: await itemFingerprint(scope, item.raw, episodeIdentity),
        }
        if (accumulator.positionMs !== undefined) record.positionMs = accumulator.positionMs
        if (accumulator.durationMs !== undefined) record.durationMs = accumulator.durationMs
        records.push(record)
    }
    return records
}

async function recordsForItem(scope: string, item: LibraryItem, videos: StremioSeriesVideo[] | null): Promise<WatchStateRecord[]> {
    if (item.kind === null || !PROVIDER_ITEM_ID.test(item.id)) {
        return hasAnyState(item.state)
            ? [await unmappedRecord(scope, item, ['This Stremio item has no recognizable movie or series identifier, so it is listed as unmatched.'])]
            : []
    }
    if (item.kind === 'movie') return movieRecords(scope, item)
    return seriesRecords(scope, item, videos)
}

async function orderedSeriesVideos(loader: StremioWatchSourceOptions['seriesVideos'], id: string): Promise<StremioSeriesVideo[] | null> {
    if (!loader) return null
    const list = await Promise.resolve(loader(id)).catch(() => null)
    if (!Array.isArray(list) || list.length === 0) return null
    const videos = list.filter((video): video is StremioSeriesVideo => isRecord(video) && typeof video.id === 'string')
    videos.sort((a, b) => {
        const seasonA = typeof a.season === 'number' ? a.season : Number.MAX_SAFE_INTEGER
        const seasonB = typeof b.season === 'number' ? b.season : Number.MAX_SAFE_INTEGER
        if (seasonA !== seasonB) return seasonA - seasonB
        const episodeA = typeof a.episode === 'number' ? a.episode : Number.MAX_SAFE_INTEGER
        const episodeB = typeof b.episode === 'number' ? b.episode : Number.MAX_SAFE_INTEGER
        if (episodeA !== episodeB) return episodeA - episodeB
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    return videos.length > 0 ? videos : null
}

export function createStremioWatchSource(options: StremioWatchSourceOptions): WatchStateSource {
    const { connectionId, label, subject, scope } = options
    const notes = [
        'The Stremio library is account-global: this source reads every profile that shares the signed-in account.',
        'Stremio stores no per-episode watch dates: migrated episodes are undated rather than dated with an invented time.',
        'A series marked watched without per-episode data cannot be expanded to individual episodes.',
    ]

    async function read(signal: AbortSignal, progress?: MigrationProgress): Promise<WatchStateSnapshot> {
        signal.throwIfAborted()
        const { request } = await options.open(signal)
        signal.throwIfAborted()
        progress?.('Reading the Stremio library…')
        const result = await request({ collection: 'libraryItem', all: true }, signal)
        const entries = libraryEntries(result)
        const capped = entries.length > MAX_LIBRARY_ITEMS
        const items: LibraryItem[] = []
        for (const entry of capped ? entries.slice(0, MAX_LIBRARY_ITEMS) : entries) {
            const item = parseLibraryItem(entry)
            if (item.kind !== null || hasAnyState(item.state)) items.push(item)
        }
        const videosCache = new Map<string, Promise<StremioSeriesVideo[] | null>>()
        const seriesVideos = (id: string): Promise<StremioSeriesVideo[] | null> => {
            const cached = videosCache.get(id)
            if (cached) return cached
            const promise = orderedSeriesVideos(options.seriesVideos, id)
            videosCache.set(id, promise)
            return promise
        }
        const records: WatchStateRecord[] = []
        let done = 0
        const queue = [...items]
        await Promise.all(Array.from({ length: Math.min(METADATA_CONCURRENCY, Math.max(items.length, 1)) }, async () => {
            while (queue.length) {
                signal.throwIfAborted()
                const item = queue.shift() as LibraryItem
                const needsVideos = item.kind === 'series'
                    && ((typeof item.state.watched === 'string' && item.state.watched !== '')
                        || (positiveDuration(item.state.timeOffset) !== null && intOrUndefined(item.state.season) !== undefined && intOrUndefined(item.state.episode) !== undefined))
                const videos = needsVideos ? await seriesVideos(item.id) : null
                records.push(...(await recordsForItem(scope, item, videos)))
                done++
                if (done % 25 === 0 || done === items.length) progress?.(`Reading watch state: ${done.toLocaleString()} of ${items.length.toLocaleString()} library items`)
            }
        }))
        signal.throwIfAborted()
        records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        const snapshotNotes = [...notes]
        if (capped) snapshotNotes.push(`The Stremio library exceeded ${MAX_LIBRARY_ITEMS.toLocaleString()} items, so this read is partial; only the first ${MAX_LIBRARY_ITEMS.toLocaleString()} items are listed.`)
        return { connectionId, label, subject, scope, records, complete: !capped, notes: snapshotNotes }
    }

    return { read }
}
