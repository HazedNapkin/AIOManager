import { useMemo } from 'react'
import { useWatchEventStore } from '@/store/watchEventStore'
import { useLibraryCache } from '@/store/libraryCache'
import { useAccountStore } from '@/store/accountStore'
import { ActivityItem } from '@/types/activity'
import { getLocalDayKey, getEpisodeIdentity } from '@/lib/activity-utils'

/**
 * A unified watch history entry combining the richness of WatchEvents
 * (real timestamps, per-episode history) with live ActivityItem state
 * (current progress, poster, account metadata).
 */
export interface HistoryEntry {
    // Identity
    id: string            // WatchEvent.id or ActivityItem.id
    itemId: string        // base content ID (tt1234)
    video_id: string      // episode-aware ID
    accountId: string
    accountName: string
    accountColorIndex: number

    // Content
    name: string
    type: string
    poster: string
    season?: number
    episode?: number

    // Timestamps - from event log when available, live item as fallback
    timestamp: Date        // when this watch event occurred
    firstWatched?: Date    // _ctime: when they first started this content
    detectedAt?: Date      // when AIOManager detected it

    // Watch data
    duration: number
    watched: number        // ms watched this session (time_watched)
    progress: number       // 0-100
    overallTimeWatched?: number
    timesWatched?: number

    // State flags
    isInProgress: boolean  // currently mid-watch
    isFromEventLog: boolean // true = from accumulated events, false = live snapshot only
    source?: string        // platform the watch came from (absent = stremio)
    backfill?: boolean     // recovered from the watched-bitfield (synthetic timestamp)

    // Live overlay (only set when this item is also in current library)
    liveProgress?: number
    liveWatched?: number
    liveEpisode?: string   // current video_id from live state
}

export interface WatchHistoryResult {
    // Full chronological history - event log entries + live-only items
    history: HistoryEntry[]
    // Items currently in progress (timeOffset > 0, progress < 90) from live state
    inProgress: ActivityItem[]
    // Whether we have any event log data yet
    hasEventLog: boolean
    loading: boolean
}

export function useWatchHistory(accountId?: string): WatchHistoryResult {
    const events = useWatchEventStore(s => s.events)
    const liveItems = useLibraryCache(s => s.items)
    const loading = useLibraryCache(s => s.loading)
    const accounts = useAccountStore(s => s.accounts)

    return useMemo(() => {
        // Build a lookup of live items for overlay data
        const liveByAccountItem = new Map<string, ActivityItem>()
        for (const item of liveItems) {
            liveByAccountItem.set(`${item.accountId}:${item.uniqueItemId || item.itemId}`, item)
            if (item.episode !== undefined) {
                liveByAccountItem.set(
                    `${item.accountId}:${getEpisodeIdentity(item.itemId, item.uniqueItemId, item.season, item.episode)}`,
                    item
                )
            }
        }

        // Build account metadata lookup
        const accountMeta = new Map(accounts.map((a, i) => [
            a.id,
            {
                name: a.name || a.email?.split('@')[0] || a.id || 'Unknown',
                colorIndex: i % 10,
            }
        ]))

        const filteredEvents = (accountId
            ? events.filter(e => e.accountId === accountId)
            : events
        ).filter(e => {
            const isSeries = e.type === 'series' || e.type === 'anime' || e.type === 'episode'
            if (!isSeries) return true
            if (e.episode != null) return true
            if (e.season != null) return true
            if (e.video_id !== e.itemId) return true
            return false
        })

        const dedupedEvents = Array.from(
            filteredEvents.reduce((map, e) => {
                const existing = map.get(e.id)
                if (!existing || e.detected_ts > existing.detected_ts) {
                    map.set(e.id, e)
                }
                return map
            }, new Map<string, typeof filteredEvents[0]>()).values()
        )

        const sessionEvents = Array.from(
            dedupedEvents.reduce((map, event) => {
                const episodeKey = getEpisodeIdentity(event.itemId, event.video_id, event.season, event.episode)
                const key = `${event.accountId}:${episodeKey}:${getLocalDayKey(event.event_ts)}`
                const existing = map.get(key)
                if (
                    !existing ||
                    event.event_ts > existing.event_ts ||
                    (event.event_ts === existing.event_ts && event.detected_ts > existing.detected_ts)
                ) {
                    map.set(key, event)
                }
                return map
            }, new Map<string, (typeof dedupedEvents)[number]>()).values()
        )

        // Convert WatchEvents to HistoryEntries
        const eventEntries: HistoryEntry[] = sessionEvents.map(event => {
            const live = liveByAccountItem.get(
                `${event.accountId}:${getEpisodeIdentity(event.itemId, event.video_id, event.season, event.episode)}`
            )
            const meta = accountMeta.get(event.accountId)
            const duration = event.duration || live?.duration || 0
            const watchedProgress = event.time_watched || 0
            const watched = event.time_watched_delta ?? event.time_watched ?? 0
            const progress = duration > 0
                ? Math.min(100, Math.max(0, (watchedProgress / duration) * 100))
                : (live?.progress ?? 0)

            return {
                id: event.id,
                itemId: event.itemId,
                video_id: event.video_id,
                accountId: event.accountId,
                accountName: meta?.name ?? event.accountId,
                accountColorIndex: meta?.colorIndex ?? 0,
                name: event.name,
                type: event.type,
                poster: live?.poster || event.poster,
                season: event.season,
                episode: event.episode,
                timestamp: new Date(event.event_ts),
                firstWatched: live?.firstWatched,
                detectedAt: new Date(event.detected_ts),
                duration,
                watched,
                progress,
                overallTimeWatched: undefined,
                timesWatched: live?.timesWatched,
                isInProgress: live?.isInProgress ?? false,
                isFromEventLog: true,
                source: event.source || live?.source || 'stremio',
                backfill: event.backfill,
                liveProgress: live?.progress,
                liveWatched: live?.watched,
                liveEpisode: live?.uniqueItemId,
            }
        })

        // Find live items not represented in the event log yet
        // (new items added since last diff, or first-run before any events)
        const eventItemIds = new Set(sessionEvents.map(e =>
            `${e.accountId}:${getEpisodeIdentity(e.itemId, e.video_id, e.season, e.episode)}`
        ))
        const liveOnlyItems = (accountId
            ? liveItems.filter(i => i.accountId === accountId)
            : liveItems
        ).filter(item => {
            if (item.source && item.source !== 'stremio') return true
            return !eventItemIds.has(
                `${item.accountId}:${getEpisodeIdentity(item.itemId, item.uniqueItemId, item.season, item.episode)}`
            )
        })

        const liveOnlyEntries: HistoryEntry[] = liveOnlyItems.map(item => ({
            id: item.id,
            itemId: item.itemId,
            video_id: item.uniqueItemId,
            accountId: item.accountId,
            accountName: item.accountName,
            accountColorIndex: item.accountColorIndex,
            name: item.name,
            type: item.type,
            poster: item.poster,
            season: item.season,
            episode: item.episode,
            timestamp: item.timestamp,
            firstWatched: item.firstWatched,
            duration: item.duration,
            watched: item.watched,
            progress: item.progress,
            overallTimeWatched: item.overallTimeWatched,
            timesWatched: item.timesWatched,
            isInProgress: item.isInProgress,
            isFromEventLog: false,
            source: item.source,
            liveProgress: item.progress,
            liveWatched: item.watched,
            liveEpisode: item.uniqueItemId,
        }))

        // Merge: event log entries first (richer history), then live-only
        const allEntries = [...eventEntries, ...liveOnlyEntries]
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

        // In-progress items from live state (these are always current)
        const inProgress = (accountId
            ? liveItems.filter(i => i.accountId === accountId)
            : liveItems
        ).filter(i => i.isInProgress)
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

        return {
            history: allEntries,
            inProgress,
            hasEventLog: events.length > 0,
            loading,
        }
    }, [events, liveItems, accounts, accountId, loading])
}
