import { LibraryItem, ActivityItem } from '@/types/activity'
import { Account } from '@/types/account'
import type { HistoryEntry } from '@/hooks/useWatchHistory'
import { getAccountEmail } from '@/store/accountStore'

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
    accounts: Account[]
): ActivityItem {
    const uniqueItemId = getUniqueItemId(item)
    const timestamp = getWatchTimestamp(item)
    const firstWatched = parseStremioDate(item._ctime)
    const { season, episode } = getSeasonEpisode(item)
    let duration = item.state?.duration || 0
    const timeOffset = item.state?.timeOffset || 0
    const overallTimeWatched = item.state?.overallTimeWatched
    const timesWatched = item.state?.timesWatched

    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

    if (duration > TWENTY_FOUR_HOURS_MS) {
        duration = 0
    }

    const progress = duration > 0 ? Math.min(100, Math.max(0, (timeOffset / duration) * 100)) : 0
    // In-progress: at least 2 minutes watched OR 5% through, and under 90% complete.
    // The 2-minute floor prevents accidental seek-to-0 artifacts from showing in Continue Watching.
    const TWO_MINUTES_MS = 2 * 60 * 1000
    const isInProgress = (timeOffset >= TWO_MINUTES_MS || progress >= 5) && progress < 90
    const accountColorIndex = accounts.indexOf(account) % 10

    return {
        id: `${account.id}:${uniqueItemId}`,
        accountId: account.id,
        accountName: account.name || getAccountEmail(account)?.split('@')[0] || account.id || 'Unknown',
        accountColorIndex,
        itemId: item._id,
        uniqueItemId,
        name: item.name || 'Unknown Title',
        type: item.type || 'other',
        poster: item.poster || '',
        timestamp,
        firstWatched,
        duration,
        watched: timeOffset,
        progress,
        timesWatched,
        isInProgress,
        season,
        episode,
        overallTimeWatched,
        source: 'unknown',
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

const cinemetaCache = new Map<string, { name: string; poster: string; genres: string[]; fetchedAt: number }>()
const CINEMETA_TTL = 24 * 60 * 60 * 1000

async function resolveCinemeta(imdbId: string, type?: string): Promise<{ name: string; poster: string; genres: string[] }> {
    const cached = cinemetaCache.get(imdbId)
    if (cached && Date.now() - cached.fetchedAt < CINEMETA_TTL) {
        return { name: cached.name, poster: cached.poster, genres: cached.genres }
    }
    try {
        const mediaType = type === 'movie' ? 'movie' : 'series'
        const res = await fetch(`https://v3-cinemeta.strem.io/meta/${mediaType}/${imdbId}.json`, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) return { name: '', poster: '', genres: [] }
        const data = await res.json()
        const meta = data?.meta
        const genres: string[] = typeof meta?.genre === 'string' && meta.genre.trim()
            ? meta.genre.split(',').map((g: string) => g.trim()).filter(Boolean)
            : []
        const entry = { name: meta?.name || '', poster: meta?.poster || '', genres, fetchedAt: Date.now() }
        cinemetaCache.set(imdbId, entry)
        return { name: entry.name, poster: entry.poster, genres: entry.genres }
    } catch {
        return { name: '', poster: '', genres: [] }
    }
}

function nuvioUniqueId(contentId: string, season?: number | null, episode?: number | null): string {
    if (episode != null) return `${contentId}:${season ?? 1}:${episode}`
    return contentId
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

export async function transformNuvioWatchedItemToActivityItem(row: NuvioWatchedItem, account: Account, accounts: Account[]): Promise<ActivityItem> {
    const uniqueItemId = nuvioUniqueId(row.content_id, row.season, row.episode)
    const meta = accountActivityMeta(account, accounts)
    const watchedAt = Number(row.watched_at) || Date.now()
    let name = row.title || ''
    let poster = ''
    let genres: string[] | undefined
    if (!name.trim()) {
        const resolved = await resolveCinemeta(row.content_id, row.content_type)
        name = resolved.name
        poster = resolved.poster
        genres = resolved.genres.length > 0 ? resolved.genres : undefined
    } else {
        const resolved = await resolveCinemeta(row.content_id, row.content_type)
        poster = resolved.poster
        genres = resolved.genres.length > 0 ? resolved.genres : undefined
    }
    return {
        id: `${account.id}:nuvio:${uniqueItemId}`,
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
        genres,
    }
}

// Progress rows carry no title (only watched rows do), so the caller can pass a title resolved
// from the watched-items list for the same content_id to avoid showing a raw id as the name.
export async function transformNuvioProgressToActivityItem(row: NuvioProgressItem, account: Account, accounts: Account[], titleHint?: string): Promise<ActivityItem> {
    const uniqueItemId = row.video_id || nuvioUniqueId(row.content_id, row.season, row.episode)
    const meta = accountActivityMeta(account, accounts)
    const duration = Number(row.duration) || 0
    const position = Number(row.position) || 0
    const progress = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0
    const lastWatched = Number(row.last_watched) || Date.now()
    let name = titleHint?.trim() || ''
    let poster = ''
    let genres: string[] | undefined
    if (!name) {
        const resolved = await resolveCinemeta(row.content_id, row.content_type)
        name = resolved.name
        poster = resolved.poster
        genres = resolved.genres.length > 0 ? resolved.genres : undefined
    } else {
        const resolved = await resolveCinemeta(row.content_id, row.content_type)
        poster = resolved.poster
        genres = resolved.genres.length > 0 ? resolved.genres : undefined
    }
    return {
        id: `${account.id}:nuvio:${uniqueItemId}`,
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
        poster: entry.poster,
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
        backfill: entry.backfill,
        genres: entry.genres,
    }
}
