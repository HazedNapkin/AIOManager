import type { ActivityItem } from '../../types/activity.ts'
import type { Connection } from '../../types/connection.ts'
import type { JellyfinMediaReads } from './reads.ts'
import type { JellyfinItem, JellyfinNowPlayingItem, JellyfinSession } from './types.ts'
import { jellyfinImdbId } from './metadata.ts'

export interface MediaAccount { id: string; name: string }
export interface MediaPlayback {
    item: ActivityItem
    state: 'playing' | 'paused' | 'resume'
    checkedAt: number
    productName: string
}
export interface MediaActivity {
    history: ActivityItem[]
    inProgress: ActivityItem[]
    playback: MediaPlayback[]
}

const playbackOrder = { playing: 0, paused: 1, resume: 2 }
export function compareMediaPlayback(a: MediaPlayback, b: MediaPlayback): number {
    return playbackOrder[a.state] - playbackOrder[b.state] || b.item.timestamp.getTime() - a.item.timestamp.getTime()
}

const milliseconds = (ticks: unknown) => typeof ticks === 'number' && Number.isFinite(ticks) && ticks >= 0 ? ticks / 10_000 : 0
const index = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
function playedDate(value: unknown, now: number): Date | undefined {
    if (typeof value !== 'string') return undefined
    const time = Date.parse(value)
    return Number.isFinite(time) && time >= Date.UTC(1995, 0, 1) && time <= now + 60_000 ? new Date(time) : undefined
}

function identifiers(item: JellyfinItem | JellyfinNowPlayingItem, connectionId: string) {
    const episode = item.Type === 'Episode'
    // An episode's IMDb/TMDB ID identifies the episode, not its parent series.
    // Resolve the parent's provider IDs, or an explicit canonical SeriesId.
    const imdb = episode ? jellyfinImdbId(item.SeriesProviderIds) || item.SeriesId : jellyfinImdbId(item.ProviderIds)
    const canonical = typeof imdb === 'string' && /^tt\d+$/.test(imdb) ? imdb : undefined
    const base = canonical || `jellyfin:${encodeURIComponent(connectionId)}:${encodeURIComponent(episode ? item.SeriesId || item.Id || '' : item.Id || '')}`
    const season = index(item.ParentIndexNumber)
    const episodeNumber = index(item.IndexNumber)
    const unique = episode && season !== undefined && episodeNumber !== undefined
        ? `${base}:${season}:${episodeNumber}`
        : canonical || `jellyfin:${encodeURIComponent(connectionId)}:${encodeURIComponent(item.Id || '')}`
    return { base, unique, season, episode: episodeNumber, canonical }
}

function activityItem(account: MediaAccount, colorIndex: number, connection: Connection, item: JellyfinItem | JellyfinNowPlayingItem, kind: 'resume' | 'played' | 'live', checkedAt: number, now: number, positionTicks?: number): ActivityItem | undefined {
    if (typeof item.Id !== 'string' || !item.Id || typeof item.Name !== 'string' || !item.Name.trim()) return undefined
    if (item.Type !== 'Movie' && item.Type !== 'Episode' && !(kind === 'live' && item.Type === undefined)) return undefined
    const ids = identifiers(item, connection.id)
    const duration = milliseconds(item.RunTimeTicks)
    const position = milliseconds(positionTicks ?? item.UserData?.PlaybackPositionTicks)
    const played = kind === 'played' && item.UserData?.Played === true
    const timestamp = playedDate(item.UserData?.LastPlayedDate, now)
    const progress = played ? 100 : duration > 0 ? Math.min(100, position / duration * 100) : 0
    return {
        id: `${account.id}:jellyfin:${connection.id}:${encodeURIComponent(item.Id)}`,
        accountId: account.id, accountName: account.name, accountColorIndex: colorIndex,
        itemId: ids.base, uniqueItemId: ids.unique,
        name: item.Type === 'Episode' && typeof item.SeriesName === 'string' ? item.SeriesName || item.Name : item.Name,
        type: item.Type === 'Episode' ? 'series' : item.Type === 'Movie' ? 'movie' : 'video',
        poster: ids.canonical ? `https://images.metahub.space/poster/medium/${ids.canonical}/img` : '',
        // Undated resume points are useful in Continue Watching, never a dated event.
        timestamp: timestamp || new Date(0),
        // A seek position is not elapsed viewing time; keep it out of watch-hour totals.
        duration, watched: 0, progress,
        isInProgress: kind === 'live' || (kind !== 'played' && position > 0 && !played),
        season: ids.season, episode: ids.episode,
        source: 'jellyfin',
        mediaObservation: { connectionId: connection.id, productName: connection.mediaServer?.productName || 'Jellyfin', kind, checkedAt, hasPlayedDate: !!timestamp, positionMs: position },
        mediaTargets: [{ connectionId: connection.id, itemId: item.Id }],
    }
}

function fresh(session: JellyfinSession, userId: string, now: number) {
    const checked = Date.parse(session.LastPlaybackCheckIn || '')
    return session.UserId === userId && !!session.NowPlayingItem && !!session.PlayState
        && Number.isFinite(checked) && checked <= now + 5_000 && now - checked <= 120_000
}

export function jellyfinMediaActivity(account: MediaAccount, colorIndex: number, connection: Connection, reads: JellyfinMediaReads | null, now = Date.now()): MediaActivity {
    const result: MediaActivity = { history: [], inProgress: [], playback: [] }
    if (!reads || !connection.enabled || !connection.mediaServer?.userId) return result
    for (const kind of ['played', 'resume'] as const) {
        const read = reads[kind]
        if (read.status !== 'success') continue
        for (const source of read.data.items) {
            if (kind === 'played' && source.UserData?.Played !== true) continue
            const item = activityItem(account, colorIndex, connection, source, kind, read.checkedAt, now)
            if (!item) continue
            if (item.mediaObservation?.hasPlayedDate) result.history.push(item)
            if (item.isInProgress) {
                result.inProgress.push(item)
                result.playback.push({ item, state: 'resume', checkedAt: read.checkedAt, productName: item.mediaObservation!.productName })
            }
        }
    }
    if (reads.sessions.status === 'success') {
        for (const session of reads.sessions.data) {
            if (!fresh(session, connection.mediaServer.userId, now)) continue
            const resume = reads.resume.status === 'success' ? reads.resume.data.items.find(item => item.Id === session.NowPlayingItem?.Id) : undefined
            const item = activityItem(account, colorIndex, connection, { ...resume, ...session.NowPlayingItem }, 'live', reads.sessions.checkedAt, now, session.PlayState?.PositionTicks)
            if (!item) continue
            item.mediaObservation!.isPaused = session.PlayState?.IsPaused === true
            item.mediaObservation!.reportedAt = Date.parse(session.LastPlaybackCheckIn!)
            if (item.isInProgress) result.inProgress.unshift(item)
            result.playback.unshift({ item, state: session.PlayState?.IsPaused ? 'paused' : 'playing', checkedAt: reads.sessions.checkedAt, productName: item.mediaObservation!.productName })
        }
    }
    result.history = mergeMediaItems([], result.history)
    result.inProgress = mergeMediaItems([], result.inProgress)
    result.playback.sort(compareMediaPlayback)
    return result
}

function identity(item: Pick<ActivityItem, 'accountId' | 'type' | 'itemId' | 'uniqueItemId' | 'season' | 'episode' | 'source' | 'sourceConnectionId'>) {
    const series = item.type === 'series' || item.type === 'episode' || item.type === 'anime'
    // Saved native logins own independent progress. The media overlay also runs when
    // no media-server observations exist, so its merge key must preserve those origins.
    const origin = item.sourceConnectionId ? `|${item.source || 'stremio'}:${item.sourceConnectionId}` : ''
    return `${item.accountId}${origin}|${series ? 'series' : item.type}|${item.itemId}|${series ? `${item.season ?? '?'}:${item.episode ?? item.uniqueItemId}` : ''}`
}

function mergeCurrentState(prior: ActivityItem, item: ActivityItem): ActivityItem {
    const labels = [...new Set([...(prior.mediaSources || []), ...(item.mediaSources || []), prior.mediaObservation?.productName, item.mediaObservation?.productName].filter((value): value is string => !!value))]
    const targets = [...new Map([...(prior.mediaTargets || []), ...(item.mediaTargets || [])].map(target => [JSON.stringify([target.connectionId, target.itemId]), target])).values()]
    const priorLive = prior.mediaObservation?.kind === 'live'
    const incomingLive = item.mediaObservation?.kind === 'live'
    const priorPlaying = priorLive && !prior.mediaObservation?.isPaused
    const incomingPlaying = incomingLive && !item.mediaObservation?.isPaused
    const preferred = priorPlaying !== incomingPlaying ? (priorPlaying ? prior : item)
        : priorLive !== incomingLive ? (priorLive ? prior : item)
        : prior.timestamp.getTime() !== item.timestamp.getTime() ? (prior.timestamp > item.timestamp ? prior : item)
        : prior.source !== 'jellyfin' ? prior : item.source !== 'jellyfin' ? item : prior
    return { ...preferred, mediaSources: labels, mediaTargets: targets }
}

/** One current state per title/episode; a newer media observation can replace old native state. */
export function mergeMediaItems(existing: ActivityItem[], incoming: ActivityItem[]): ActivityItem[] {
    const merged = new Map<string, ActivityItem>()
    for (const item of [...existing, ...incoming]) {
        const key = identity(item)
        const prior = merged.get(key)
        merged.set(key, prior ? mergeCurrentState(prior, item) : item)
    }
    return [...merged.values()]
}

/** Preserve watch events on different days; snapshots can only augment the same reported watch day. */
export function mergeMediaHistory(existing: ActivityItem[], incoming: ActivityItem[]): ActivityItem[] {
    const history = [...existing]
    for (const item of incoming) {
        const key = identity(item)
        let match = -1
        let distance = Infinity
        for (let index = 0; index < history.length; index++) {
            const prior = history[index]
            if (identity(prior) !== key || prior.timestamp.toDateString() !== item.timestamp.toDateString()) continue
            const difference = Math.abs(prior.timestamp.getTime() - item.timestamp.getTime())
            if (difference < distance) { match = index; distance = difference }
        }
        if (match === -1) { history.push(item); continue }
        const prior = history[match]
        const merged = mergeCurrentState(prior, item)
        history[match] = prior.source !== 'jellyfin'
            ? { ...prior, mediaSources: merged.mediaSources, mediaTargets: merged.mediaTargets }
            : merged
    }
    return history
}

export function isReadOnlyMediaActivity(item: Pick<ActivityItem, 'source' | 'readOnly'>): boolean {
    return item.readOnly === true
}

export const RECENT_ACTIVITY_WINDOW_MS = 5 * 60_000
export type ActivityNowStatus = 'playing' | 'recent'

/** "Now" is recent activity; only an actual player report establishes live playback. */
export function activityNowStatus(item: ActivityItem, now = Date.now()): ActivityNowStatus | undefined {
    if (item.mediaObservation?.kind === 'live') {
        const age = now - (item.mediaObservation.reportedAt ?? item.mediaObservation.checkedAt)
        return !item.mediaObservation.isPaused && age >= -5_000 && age < 120_000 ? 'playing' : undefined
    }
    if (item.backfill || !item.isInProgress || item.progress >= 90 || (item.flaggedWatched ?? 0) > 0 || item.mediaObservation?.kind === 'played') return undefined
    const age = now - item.timestamp.getTime()
    return age >= -60_000 && age < RECENT_ACTIVITY_WINDOW_MS ? 'recent' : undefined
}

/** Select from the full feed so searching cannot revive an older episode's badge. */
export function activityNowStatuses(history: ActivityItem[], now = Date.now(), current: ActivityItem[] = []): Map<string, ActivityNowStatus> {
    const latest = new Map<string, ActivityItem>()
    const latestByIdentity = new Map<string, ActivityItem>()
    for (const item of [...history, ...current]) {
        const time = item.timestamp.getTime()
        if (item.backfill || !Number.isFinite(time) || time <= 0 || time > now + 60_000) continue
        const prior = latest.get(item.accountId)
        if (!prior || time > prior.timestamp.getTime() || (time === prior.timestamp.getTime() && item.id < prior.id)) latest.set(item.accountId, item)
    }
    for (const item of history) {
        const prior = latestByIdentity.get(identity(item))
        if (!prior || item.timestamp > prior.timestamp) latestByIdentity.set(identity(item), item)
    }
    const liveByIdentity = new Map<string, ActivityItem>()
    for (const item of current) {
        if (item.mediaObservation?.kind === 'live') {
            const prior = liveByIdentity.get(identity(item))
            if (!prior || activityNowStatus(item, now) === 'playing') liveByIdentity.set(identity(item), item)
        }
    }
    const status = new Map<string, ActivityNowStatus>()
    for (const item of history) {
        const live = liveByIdentity.get(identity(item))
        if (live && latestByIdentity.get(identity(item))?.id !== item.id) continue
        const latestItem = latest.get(item.accountId)
        const isLatest = latestItem?.id === item.id || (!!latestItem && identity(latestItem) === identity(item) && latestByIdentity.get(identity(item))?.id === item.id)
        const value = activityNowStatus(live || (isLatest ? latestItem! : item), now)
        if (value === 'playing' || (value === 'recent' && isLatest)) status.set(item.id, value)
    }
    return status
}

/** Dated resume points compete with every platform's latest item. Only live reports override it. */
export function accountMediaPlayback(playback: MediaPlayback[], latest: ActivityItem | null): MediaPlayback | undefined {
    return playback.find(item => item.state === 'playing') || playback.find(item => item.state === 'paused')
        || (!latest ? playback.find(item => !item.item.mediaObservation?.hasPlayedDate) : undefined)
}
