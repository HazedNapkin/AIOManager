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
    source?: string        // platform the watch came from (absent = unknown)
    backfill?: boolean     // recovered from the watched-bitfield (synthetic timestamp)
    genres?: string[]

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

    const eventsKey = `${events.length}:${events.length > 0 ? events[0].id : ''}`

    const { history, inProgress, hasEventLog } = useMemo(() => {
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

        const seriesOverallTime = new Map<string, number>()
        for (const item of liveItems) {
            if (item.overallTimeWatched && item.overallTimeWatched > 0) {
                const key = `${item.accountId}:${item.itemId}`
                const existing = seriesOverallTime.get(key)
                if (!existing || item.overallTimeWatched > existing) {
                    seriesOverallTime.set(key, item.overallTimeWatched)
                }
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

        const EPISODE_DEDUP_WINDOW_MS = 172800000
        type SessionEvent = (typeof sessionEvents)[number]

        const seriesGroups = new Map<string, SessionEvent[]>()
        const nonSeriesEvents: SessionEvent[] = []
        for (const event of sessionEvents) {
            const isSeries = event.type === 'series' || event.type === 'anime' || event.type === 'episode'
            if (!isSeries) {
                nonSeriesEvents.push(event)
                continue
            }
            const episodeKey = getEpisodeIdentity(event.itemId, event.video_id, event.season, event.episode)
            const key = `${event.accountId}:${episodeKey}`
            const arr = seriesGroups.get(key)
            if (arr) arr.push(event)
            else seriesGroups.set(key, [event])
        }

        const seriesDeduped: SessionEvent[] = []
        for (const arr of seriesGroups.values()) {
            arr.sort((a, b) => a.event_ts - b.event_ts || a.detected_ts - b.detected_ts)
            let kept: SessionEvent | null = null
            for (const event of arr) {
                if (kept === null) {
                    kept = event
                } else if (event.event_ts - kept.event_ts <= EPISODE_DEDUP_WINDOW_MS) {
                    if (
                        event.event_ts > kept.event_ts ||
                        (event.event_ts === kept.event_ts && event.detected_ts > kept.detected_ts)
                    ) {
                        kept = event
                    }
                } else {
                    seriesDeduped.push(kept)
                    kept = event
                }
            }
            if (kept) seriesDeduped.push(kept)
        }

        const seriesDedupedEvents = [...nonSeriesEvents, ...seriesDeduped]

        // Convert WatchEvents to HistoryEntries
        const eventEntries: HistoryEntry[] = seriesDedupedEvents.map(event => {
            const live = liveByAccountItem.get(
                `${event.accountId}:${getEpisodeIdentity(event.itemId, event.video_id, event.season, event.episode)}`
            )
            const meta = accountMeta.get(event.accountId)
            const duration = event.duration || live?.duration || 0
            const watchedProgress = event.time_watched || 0
            const watched = event.time_watched_delta ?? event.time_watched ?? 0
            const progress = duration > 0
                ? Math.min(100, Math.max(0, (watchedProgress / duration) * 100))
                : Math.min(live?.progress ?? 0, 100)

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
                overallTimeWatched: seriesOverallTime.get(`${event.accountId}:${event.itemId}`),
                timesWatched: live?.timesWatched,
                isInProgress: live?.isInProgress ?? false,
                isFromEventLog: true,
                source: event.source || live?.source || 'unknown',
                backfill: event.backfill,
                liveProgress: live?.progress,
                liveWatched: live?.watched,
                liveEpisode: live?.uniqueItemId,
            }
        })

        // Find live items not represented in the event log yet
        // (new items added since last diff, or first-run before any events)
        const eventItemIds = new Set(seriesDedupedEvents.map(e =>
            `${e.accountId}:${getEpisodeIdentity(e.itemId, e.video_id, e.season, e.episode)}`
        ))
        const eventIdentityKeys = new Set<string>()
        for (const entry of seriesDedupedEvents) {
            const name = entry.name?.toLowerCase().trim()
            const episode = entry.episode
            if (name && episode != null) {
                eventIdentityKeys.add(`${entry.accountId}:${name}:${episode}`)
            }
        }
        const liveOnlyItems = (accountId
            ? liveItems.filter(i => i.accountId === accountId)
            : liveItems
        ).filter(item => {
            if (item.source && item.source !== 'stremio') return true
            if (eventItemIds.has(
                `${item.accountId}:${getEpisodeIdentity(item.itemId, item.uniqueItemId, item.season, item.episode)}`
            )) return false
            const name = item.name?.toLowerCase().trim()
            if (name && item.episode != null && eventIdentityKeys.has(`${item.accountId}:${name}:${item.episode}`)) return false
            return true
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
            progress: Math.min(item.progress, 100),
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

        const finalDedup = new Map<string, HistoryEntry>()
        for (const entry of allEntries) {
            const name = entry.name?.toLowerCase().trim() || ''
            const episodeKey = entry.episode != null
                ? `${entry.accountId}:${name}:${entry.season || 1}:${entry.episode}`
                : `${entry.accountId}:${name}`

            const existing = finalDedup.get(episodeKey)
            if (!existing) {
                finalDedup.set(episodeKey, entry)
            } else {
                const existingScore = (existing.progress || 0) + (existing.poster ? 50 : 0) + (existing.duration ? 50 : 0)
                const newScore = (entry.progress || 0) + (entry.poster ? 50 : 0) + (entry.duration ? 50 : 0)
                if (newScore > existingScore) {
                    finalDedup.set(episodeKey, entry)
                }
            }
        }
        const dedupedList = Array.from(finalDedup.values())

        // In-progress items from live state (these are always current)
        const inProgress = (accountId
            ? liveItems.filter(i => i.accountId === accountId)
            : liveItems
        ).filter(i => i.isInProgress)
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

        return {
            history: dedupedList,
            inProgress,
            hasEventLog: events.length > 0,
        }
    }, [eventsKey, liveItems, accounts, accountId])

    return { history, inProgress, hasEventLog, loading }
}
