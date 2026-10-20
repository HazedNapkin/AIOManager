import { LibraryItem, ActivityItem } from '@/types/activity'
import { Account } from '@/types/account'
import type { HistoryEntry } from '@/hooks/useWatchHistory'
import { getAccountEmail } from '@/store/accountStore'
import { sanitizePosterUrl } from '@/lib/utils'
import { parseCinemetaGenres, fetchCinemetaDetail } from './cinemeta-cache.ts'

export { sanitizePosterUrl }

/**
 * Stable per-connection scope key for watch attribution: a secondary Stremio login's
 * history lives under `${accountId}::${connectionId}`, while the canonical/legacy
 * scope stays the bare accountId so every pre-multiplicity row, snapshot and
 * tombstone keeps resolving exactly as before. Connection ids are uuids, so the
 * double-colon separator can never occur inside either id.
 */
export function watchContextKey(accountId: string, sourceConnectionId?: string): string {
    return sourceConnectionId ? `${accountId}::${sourceConnectionId}` : accountId
}

/**
 * Split a server-side scoped account id (`${accountId}::${connectionId}` for
 * per-connection rows, bare accountId for canonical/legacy rows) back into the real
 * account and the originating connection. The connection part is absent for
 * canonical/legacy history.
 */
export function parseScopedAccountId(scopedAccountId: string): { accountId: string; sourceConnectionId?: string } {
    const raw = String(scopedAccountId || '')
    const sep = raw.indexOf('::')
    if (sep < 0) return { accountId: raw }
    const accountId = raw.slice(0, sep)
    const sourceConnectionId = raw.slice(sep + 2)
    if (!accountId || !sourceConnectionId) return { accountId: raw }
    return { accountId, sourceConnectionId }
}

/** Cache/feed identity of a Stremio item: canonical keeps the legacy key, secondaries carry their connection. */
export function stremioActivityItemKey(accountId: string, uniqueItemId: string, sourceConnectionId?: string): string {
    return sourceConnectionId
        ? `${accountId}:stremio:${sourceConnectionId}:${uniqueItemId}`
        : `${accountId}:${uniqueItemId}`
}

/**
 * Human label distinguishing same-account peer logins (rail/detail surfaces): the
 * connection's own email or displayName when known, else a stable per-platform ordinal
 * ("Login 2"). Returns undefined without attribution or when the platform has only one
 * login (the account label already covers it). Raw values — callers apply privacy masking.
 */
export function peerLoginLabel(
    account: { connections?: Array<{ id: string; platform: string; enabled?: boolean; displayName?: string; credentials?: Record<string, string> }> } | undefined,
    sourceConnectionId?: string,
): string | undefined {
    if (!account || !sourceConnectionId) return undefined
    const conns = (account.connections || []).filter(c => c.platform !== 'jellyfin')
    const conn = conns.find(c => c.id === sourceConnectionId)
    if (!conn) return undefined
    const samePlatform = conns.filter(c => c.platform === conn.platform)
    if (samePlatform.length <= 1) return undefined
    const email = conn.credentials?.email
    if (email && email.includes('@')) return email
    if (conn.displayName) return conn.displayName
    return `Login ${samePlatform.findIndex(c => c.id === sourceConnectionId) + 1}`
}

export {
    fetchCinemetaDetail,
    getCachedCinemetaName,
    type CinemetaCastMember,
    type CinemetaCrewMember,
    type CinemetaDirectorMember,
    type CinemetaMeta,
    type CinemetaRelatedItem,
    type CinemetaReview,
    type CinemetaVideo,
} from './cinemeta-cache.ts'

export function isActuallyWatched(item: LibraryItem): boolean {
    const s = item.state || {}
    if ((s.timesWatched ?? 0) > 0) return true
    if (s.video_id && s.video_id.trim() !== '') return true
    if ((s.timeOffset ?? 0) > 0) return true
    if ((s.timeWatched ?? 0) > 0 || (s.overallTimeWatched ?? 0) > 0) return true
    return false
}

export function getUniqueItemId(item: LibraryItem): string {
    const baseId = item._id
    if ((item.type === 'series' || item.type === 'anime' || item.type === 'episode') && item.state?.video_id) {
        const videoId = item.state.video_id
        const parts = videoId.split(':')
        // Standard format: "tt123:season:episode" (3 parts) or Kitsu "kitsu:id:s:e" (4 parts)
        if (parts.length >= 3) return videoId
        // Format: "tt123:episode" (2 parts, no season)
        if (parts.length === 2) return `${parts[0]}:1:${parts[1]}`
    }
    return baseId
}

export function getWatchTimestamp(item: LibraryItem): Date {
    const times: number[] = []
    if (item.state?.lastWatched) {
        const d = new Date(item.state.lastWatched)
        if (!isNaN(d.getTime())) times.push(d.getTime())
    }
    if (item._mtime) {
        const d = new Date(item._mtime)
        if (!isNaN(d.getTime())) times.push(d.getTime())
    }
    const now = Date.now()

    // This protects against Stremio sending bad timestamps (e.g. 12h future)
    // which would otherwise be clamped to "now" and appear as "Just now"
    const validTimes = times.filter(t => t <= now + 5 * 60 * 1000)

    const maxTime = validTimes.length > 0 ? Math.max(...validTimes) : now

    return new Date(Math.min(maxTime, now))
}

export function getSeasonEpisode(item: LibraryItem): { season?: number; episode?: number } {
    if ((item.type !== 'series' && item.type !== 'anime' && item.type !== 'episode') || !item.state?.video_id) {
        return {}
    }

    const parts = item.state.video_id.split(':')
    const firstPart = parts[0]?.toLowerCase() || ''
    const animeProviders = ['kitsu', 'mal', 'anilist', 'anidb']
    const isAnimeProvider = animeProviders.includes(firstPart)

    const safeParseInt = (val: string | undefined, fallback: number): number => {
        if (val === undefined) return fallback
        const stripped = val.replace(/^[^0-9]*/, '')
        const n = parseInt(stripped, 10)
        return Number.isNaN(n) ? fallback : n
    }

    if (parts.length >= 4) {
        return {
            season: safeParseInt(parts[parts.length - 2], 1),
            episode: safeParseInt(parts[parts.length - 1], 0)
        }
    }

    if (parts.length === 3 && isAnimeProvider) {
        return { season: 1, episode: safeParseInt(parts[2], 0) }
    }

    if (parts.length === 3) {
        return {
            season: safeParseInt(parts[1], 1),
            episode: safeParseInt(parts[2], 0)
        }
    }

    if (parts.length === 2 && !isAnimeProvider) {
        return { season: 1, episode: safeParseInt(parts[1], 0) }
    }

    return {
        season: item.state.season ?? 1,
        episode: item.state.episode
    }
}

export function getLocalDayKey(timestamp: number): string {
    const date = new Date(timestamp)
    if (isNaN(date.getTime())) return 'unknown'
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
}

export function getEpisodeIdentity(
    itemId: string,
    videoId: string | undefined,
    season: number | undefined,
    episode: number | undefined,
    type: string
): string {
    const isSeries = type === 'series' || type === 'anime' || type === 'episode'
    if (!isSeries) return itemId
    if (episode !== undefined) return `${itemId}:s${season ?? 1}:e${episode}`
    if (videoId && videoId !== itemId) {
        const parts = videoId.split(':')
        if (parts.length >= 3) {
            const s = parseInt(parts[parts.length - 2])
            const e = parseInt(parts[parts.length - 1])
            if (!isNaN(e)) return `${itemId}:s${isNaN(s) ? 1 : s}:e${e}`
        }
        if (parts.length === 2) {
            const e = parseInt(parts[1])
            if (!isNaN(e)) return `${itemId}:s1:e${e}`
        }
    }
    return videoId || itemId
}

export function parseStremioDate(dateStr: string | undefined): Date | undefined {
    if (!dateStr) return undefined
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return undefined
    return d.getTime() > Date.now() + 5 * 60 * 1000 ? new Date() : d
}

export function transformLibraryItemToActivityItem(
    item: LibraryItem,
    account: Account,
    accounts: Account[],
    options?: { connectionId?: string; distinctId?: boolean }
): ActivityItem {
    const uniqueItemId = getUniqueItemId(item)
    const timestamp = getWatchTimestamp(item)
    const firstWatched = parseStremioDate(item._ctime)
    const { season, episode } = getSeasonEpisode(item)
    let duration = item.state?.duration || 0
    const timeOffset = item.state?.timeOffset || 0
    const overallTimeWatched = item.state?.overallTimeWatched
    const timesWatched = item.state?.timesWatched
    const flaggedWatched = item.state?.flaggedWatched

    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

    if (duration > TWENTY_FOUR_HOURS_MS) {
        duration = 0
    }

    const progress = duration > 0 ? Math.min(100, Math.max(0, (timeOffset / duration) * 100)) : 0
    const isInProgress = (timeOffset > 3000 || progress > 0.5) && progress < 95
    const accountColorIndex = accounts.indexOf(account) % 10
    // Stable per-origin identity: BOTH canonical and secondary items record which login
    // they came from (deletes resolve the exact key after a canonical switch/promotion),
    // but only a SECONDARY tags its id — the canonical keeps the legacy id so cached
    // feeds, deleted-entry keys and tombstones stay valid, and two logins watching the
    // same title stay independently visible and independently deletable.
    const itemId = options?.connectionId && options.distinctId !== false
        ? stremioActivityItemKey(account.id, uniqueItemId, options.connectionId)
        : `${account.id}:${uniqueItemId}`

    return {
        id: itemId,
        accountId: account.id,
        accountName: account.name || getAccountEmail(account)?.split('@')[0] || account.id || 'Unknown',
        accountColorIndex,
        itemId: item._id,
        uniqueItemId,
        name: item.name || 'Unknown Title',
        type: item.type || 'other',
        poster: sanitizePosterUrl(item.poster) || '',
        timestamp,
        firstWatched,
        duration,
        watched: timeOffset,
        progress,
        timesWatched,
        flaggedWatched,
        isInProgress,
        season,
        episode,
        overallTimeWatched,
        source: 'stremio',
        ...(options?.connectionId ? { sourceConnectionId: options.connectionId } : {}),
    }
}

interface NuvioWatchedItem {
    content_id: string
    content_type?: string
    title?: string
    season?: number | null
    episode?: number | null
    watched_at?: number
}

interface NuvioProgressItem {
    content_id: string
    content_type?: string
    video_id?: string
    season?: number | null
    episode?: number | null
    position?: number
    duration?: number
    last_watched?: number
}

async function resolveCinemeta(imdbId: string, type?: string): Promise<{ name: string; poster: string; genres: string[] }> {
    const meta = await fetchCinemetaDetail(imdbId, type)
    if (!meta) return { name: '', poster: '', genres: [] }
    return {
        name: meta.name || '',
        poster: sanitizePosterUrl(meta.poster) || '',
        genres: parseCinemetaGenres(meta),
    }
}

function nuvioUniqueId(contentId: string, season?: number | null, episode?: number | null): string {
    if (episode != null) return `${contentId}:${season ?? 1}:${episode}`
    return contentId
}

function stripNuvioEpisodeTag(title: string, episode?: number | null): string {
    if (episode == null) return title
    return title.replace(/[\s-]*s\d{1,3}\s*e\d{1,3}\s*$/i, '').trim()
}

export function nuvioProgressKey(contentId: string, season?: number | null, episode?: number | null): string {
    if (episode != null) return `${contentId}_s${season ?? 1}e${episode}`
    return contentId
}

function accountActivityMeta(account: Account, accounts: Account[]) {
    return {
        name: account.name || getAccountEmail(account)?.split('@')[0] || account.id || 'Unknown',
        colorIndex: accounts.indexOf(account) % 10,
    }
}

export async function transformNuvioWatchedItemToActivityItem(row: NuvioWatchedItem, account: Account, accounts: Account[], options?: { connectionId?: string }): Promise<ActivityItem> {
    const uniqueItemId = nuvioUniqueId(row.content_id, row.season, row.episode)
    const meta = accountActivityMeta(account, accounts)
    const watchedAt = Number(row.watched_at) || Date.now()
    const resolved = await resolveCinemeta(row.content_id, row.content_type)
    let name: string
    if (row.episode != null && resolved.name.trim()) {
        name = resolved.name
    } else {
        name = stripNuvioEpisodeTag(row.title || '', row.episode)
        if (!name.trim()) name = resolved.name
    }
    const poster = resolved.poster
    const genres = resolved.genres.length > 0 ? resolved.genres : undefined
    return {
        // Per-origin identity: with several Nuvio logins bound, each copy tags its
        // connection so same-title watches stay separately visible and separately
        // deletable; the single-connection shape keeps the legacy id untouched.
        id: options?.connectionId
            ? `${account.id}:nuvio:${options.connectionId}:${uniqueItemId}`
            : `${account.id}:nuvio:${uniqueItemId}`,
        accountId: account.id,
        accountName: meta.name,
        accountColorIndex: meta.colorIndex,
        itemId: row.content_id,
        uniqueItemId,
        name: name || 'Unknown Title',
        type: row.content_type || 'other',
        poster,
        timestamp: new Date(Math.min(watchedAt, Date.now())),
        duration: 0,
        watched: 0,
        progress: 100,
        isInProgress: false,
        season: row.season ?? undefined,
        episode: row.episode ?? undefined,
        source: 'nuvio',
        ...(options?.connectionId ? { sourceConnectionId: options.connectionId } : {}),
        genres,
    }
}

// Progress rows carry no title (only watched rows do), so the caller can pass a title resolved
// from the watched-items list for the same content_id to avoid showing a raw id as the name.
export async function transformNuvioProgressToActivityItem(row: NuvioProgressItem, account: Account, accounts: Account[], titleHint?: string, options?: { connectionId?: string }): Promise<ActivityItem> {
    const uniqueItemId = row.video_id || nuvioUniqueId(row.content_id, row.season, row.episode)
    const meta = accountActivityMeta(account, accounts)
    const duration = Number(row.duration) || 0
    const position = Number(row.position) || 0
    const progress = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0
    const lastWatched = Number(row.last_watched) || Date.now()
    const resolved = await resolveCinemeta(row.content_id, row.content_type)
    let name: string
    if (row.episode != null && resolved.name.trim()) {
        name = resolved.name
    } else {
        name = stripNuvioEpisodeTag(titleHint?.trim() || '', row.episode)
        if (!name.trim()) name = resolved.name
    }
    const poster = resolved.poster
    const genres = resolved.genres.length > 0 ? resolved.genres : undefined
    return {
        id: options?.connectionId
            ? `${account.id}:nuvio:${options.connectionId}:${uniqueItemId}`
            : `${account.id}:nuvio:${uniqueItemId}`,
        accountId: account.id,
        accountName: meta.name,
        accountColorIndex: meta.colorIndex,
        itemId: row.content_id,
        uniqueItemId,
        name: name || row.content_id,
        type: row.content_type || 'other',
        poster,
        timestamp: new Date(Math.min(lastWatched, Date.now())),
        duration,
        watched: position,
        progress,
        isInProgress: progress > 0 && progress < 90,
        season: row.season ?? undefined,
        episode: row.episode ?? undefined,
        source: 'nuvio',
        ...(options?.connectionId ? { sourceConnectionId: options.connectionId } : {}),
        genres,
    }
}

export function historyEntryToActivityItem(entry: HistoryEntry): ActivityItem {
    return {
        id: entry.id,
        accountId: entry.accountId,
        accountName: entry.accountName,
        accountColorIndex: entry.accountColorIndex,
        itemId: entry.itemId,
        uniqueItemId: entry.video_id,
        name: entry.name,
        type: entry.type,
        poster: sanitizePosterUrl(entry.poster) || '',
        timestamp: entry.timestamp,
        firstWatched: entry.firstWatched,
        duration: entry.duration,
        watched: entry.isFromEventLog ? entry.watched : (entry.liveWatched ?? entry.watched),
        progress: Math.min(entry.isFromEventLog ? entry.progress : (entry.liveProgress ?? entry.progress), 100),
        timesWatched: entry.timesWatched,
        isInProgress: entry.isInProgress,
        season: entry.season,
        episode: entry.episode,
        overallTimeWatched: entry.overallTimeWatched,
        source: entry.source,
        sourceConnectionId: entry.sourceConnectionId,
        backfill: entry.backfill,
        genres: entry.genres,
        readOnly: entry.readOnly,
        mediaObservation: entry.mediaObservation,
        mediaSources: entry.mediaSources,
        mediaTargets: entry.mediaTargets,
    }
}

export function resolveWatchBadgePct(item: ActivityItem): number | undefined {
    if (item.progress > 0) return Math.round(item.progress)
    if ((item.timesWatched ?? 0) > 0 || (item.flaggedWatched ?? 0) > 0) return 100
    const isSeries = item.type === 'series' || item.type === 'anime' || item.type === 'episode'
    if (!isSeries && (item.overallTimeWatched ?? 0) > 0) return 100
    return 0
}
