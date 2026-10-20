import { useMemo, useState, useEffect, useDeferredValue, useCallback, useRef } from 'react'
import { useWatchEventStore } from '@/store/watchEventStore'
import { useLibraryCache } from '@/store/libraryCache'
import { useAccountStore } from '@/store/accountStore'
import { ActivityItem, SavedEpisodesSummary } from '@/types/activity'
import { getLocalDayKey, getEpisodeIdentity, fetchCinemetaDetail, historyEntryToActivityItem } from '@/lib/activity-utils'
import { summarizeSavedEpisodes } from '@/lib/imported-watch-state'
import { useJellyfinActivity, type MediaReadIssue } from '@/hooks/useJellyfinActivity'
import { mergeMediaHistory, mergeMediaItems } from '@/lib/jellyfin/activity'
import { reconcileRailProgress } from '@/lib/rail-progress'
import { trace } from '@/lib/trace'
import { usePacedValue } from '@/hooks/usePacedValue'
import { isUnresolvedActivityName } from '@/lib/activity-metadata-overlay'

const GENRE_CACHE_STORAGE_KEY = 'aio-genre-map-v1'
let _genreCache: Map<string, string[]> | null = null

// Cold-load derivation pacing: per-account watch-event diffs publish in a burst
// while the library loads, and every intermediate publication used to trigger a
// full history derivation. While a library load is active the
// events input to the big derivation is re-derived at most this often; the
// trailing edge always carries the newest events and the load ending delivers
// the final state immediately, so partial results stay usable and incremental
// single-change publications outside a load are unaffected.
const HISTORY_LOAD_PACE_MS = 1200

/** Reference equality over a deps tuple (for the interrupted-render caches below). */
function depsEqual(a: unknown[], b: unknown[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
}

function loadGenreCache(): Map<string, string[]> {
    if (_genreCache) return _genreCache
    try {
        const raw = localStorage.getItem(GENRE_CACHE_STORAGE_KEY)
        _genreCache = raw ? new Map(JSON.parse(raw) as Array<[string, string[]]>) : new Map()
    } catch {
        _genreCache = new Map()
    }
    return _genreCache
}

function saveGenreCache(map: Map<string, string[]>) {
    _genreCache = map
    try { localStorage.setItem(GENRE_CACHE_STORAGE_KEY, JSON.stringify([...map])) } catch {}
}

/**
 * A unified watch history entry combining the richness of WatchEvents
 * (real timestamps, per-episode history) with live ActivityItem state
 * (current progress, poster, account metadata).
 */
export interface HistoryEntry {
    id: string
    itemId: string
    video_id: string      // episode-aware ID (distinct from the base itemId)
    accountId: string
    accountName: string
    accountColorIndex: number

    name: string
    type: string
    poster: string
    season?: number
    episode?: number

    timestamp: Date
    firstWatched?: Date    // maps to Stremio's _ctime
    detectedAt?: Date

    duration: number
    watched: number        // ms watched this session
    progress: number
    overallTimeWatched?: number
    timesWatched?: number
    flaggedWatched?: number

    isInProgress: boolean
    isFromEventLog: boolean
    source?: string
    /** Exact remote login this entry came from (same-platform multiplicity); absent = canonical/legacy. */
    sourceConnectionId?: ActivityItem['sourceConnectionId']
    readOnly?: ActivityItem['readOnly']
    mediaObservation?: ActivityItem['mediaObservation']
    mediaSources?: string[]
    mediaTargets?: ActivityItem['mediaTargets']
    backfill?: boolean     // recovered from the watched-bitfield (synthetic timestamp)
    /** Imported saved watch state: no real watch dates; presented as saved state, never a dated watch. */
    importedSavedState?: boolean
    /** Verified saved-episode summary recovered from the watched bitfield (series aggregates). */
    savedEpisodes?: SavedEpisodesSummary
    genres?: string[]

    // Live overlay (only set when this item is also in current library)
    liveProgress?: number
    liveWatched?: number
    liveEpisode?: string
}

export interface WatchHistoryResult {
    refreshMedia: () => void
    mediaIssues: MediaReadIssue[]
    history: HistoryEntry[]
    // Items currently in progress (timeOffset > 0, progress < 90) from live state
    inProgress: ActivityItem[]
    hasEventLog: boolean
    loading: boolean
}

export function useWatchHistory(accountId?: string): WatchHistoryResult {
    const media = useJellyfinActivity(accountId)
    const rawEvents = useWatchEventStore(s => s.events)
    const rawLiveItems = useLibraryCache(s => s.items)
    const loading = useLibraryCache(s => s.loading)
    const accounts = useAccountStore(s => s.accounts)
    const deletedEventKeys = useWatchEventStore(s => s.deletedEventKeys)
    // Ownership, canonical-login changes and deletions invalidate a paced snapshot
    // immediately. A delayed event array must never outlive its identity context.
    const pacingScope = useMemo(() => [accounts, accountId, deletedEventKeys], [accounts, accountId, deletedEventKeys])
    const pacedEvents = usePacedValue(rawEvents, HISTORY_LOAD_PACE_MS, loading, pacingScope)
    const historyInput = useMemo(() => ({ events: pacedEvents, liveItems: rawLiveItems, scope: pacingScope }), [pacedEvents, rawLiveItems, pacingScope])
    const deferredInput = useDeferredValue(historyInput)
    const { events, liveItems } = deferredInput.scope === pacingScope
        ? deferredInput
        : { events: rawEvents, liveItems: rawLiveItems }
    const [genreMap, setGenreMap] = useState<Map<string, string[]>>(loadGenreCache)

    // Canonical-aware origin context: the CURRENT canonical login's items/events share the
    // bare account scope with legacy and server-merged canonical rows (so one watch never
    // shows twice), while every other login keeps its `accountId::connectionId` scope.
    // Post-promotion, the demoted login's frozen scopeKeys (rewritten by the migration)
    // agree with this computation.
    const canonicalStremioByAccount = useMemo(() => {
        const m = new Map<string, string | undefined>()
        for (const a of accounts) {
            const native = (a.connections || []).filter(c => c.platform === 'stremio' && (c.connectionType == null || c.connectionType === 'native'))
            m.set(a.id, native.find(c => c.id === a.primaryConnectionId)?.id ?? native[0]?.id)
        }
        return m
    }, [accounts])
    const ctxOf = useCallback((accountId: string, sourceConnectionId?: string) => {
        if (!sourceConnectionId) return accountId
        return sourceConnectionId !== canonicalStremioByAccount.get(accountId)
            ? `${accountId}::${sourceConnectionId}`
            : accountId
    }, [canonicalStremioByAccount])

    const baseDerivationRef = useRef<{ deps: unknown[]; value: { history: HistoryEntry[]; inProgress: ActivityItem[]; hasEventLog: boolean } } | null>(null)

    // Verified saved-episode recoveries per series scope. Derived from the RAW event stream
    // (not the paced/deferred input): the aggregate live items arrive as soon as the library
    // loads, while the paced events snapshot can lag a beat — deriving the index from the
    // paced input would blank the counts on every load. The cache is keyed by backfill
    // content, so publications that don't touch backfill events reuse the same Map and never
    // re-run the big derivation below.
    // An episode counts as confirmed-watched when it is a bitfield recovery, carries the
    // positive per-episode flag (recordBackfillEpisodes stamps it onto real events the
    // verified bitfield covers), or measurably completed a known duration (>= 95%). Mere
    // watch time or aggregate counts never qualify — a 20% partial is not a completion.
    const isConfirmedSavedEpisode = (e: typeof rawEvents[number]): boolean => {
        if (e.backfill) return true
        if ((e.flaggedWatched ?? 0) > 0) return true
        return e.duration > 0 && (e.time_watched || 0) >= 0.95 * e.duration
    }
    const hasValidEpisodeAnchor = (e: { season?: number; episode?: number }): boolean =>
        e.season != null && e.episode != null
        && Number.isInteger(e.season) && Number.isInteger(e.episode)
        && e.episode > 0
    const buildSavedEpisodeIndex = (evs: typeof rawEvents) => {
        const index = new Map<string, Array<{ season?: number; episode?: number }>>()
        for (const e of evs) {
            if (!hasValidEpisodeAnchor(e) || !isConfirmedSavedEpisode(e)) continue
            const key = `${ctxOf(e.accountId, e.sourceConnectionId)}:${e.itemId}`
            const arr = index.get(key)
            if (arr) arr.push({ season: e.season, episode: e.episode })
            else index.set(key, [{ season: e.season, episode: e.episode }])
        }
        return index
    }
    // Content key over every field the index derives from: identity plus WHY an event
    // counts (backfill detection, stamped flag, measured completion). Annotations land
    // without touching detected_ts, so the flag token is what forces the rebuild; plain
    // progress wiggle below the completion threshold never churns the key.
    const savedEpisodeContentKey = useMemo(() => {
        let k = ''
        for (const e of rawEvents) {
            if (!hasValidEpisodeAnchor(e)) continue
            if (e.backfill) { k += `${e.id}:b:${e.detected_ts};`; continue }
            if ((e.flaggedWatched ?? 0) > 0) { k += `${e.id}:f;`; continue }
            if (e.duration > 0 && (e.time_watched || 0) >= 0.95 * e.duration) k += `${e.id}:m;`
        }
        return k
    }, [rawEvents])
    const savedIndexCacheRef = useRef<{ key: string; ctx: typeof ctxOf; value: Map<string, Array<{ season?: number; episode?: number }>> } | null>(null)
    if (!savedIndexCacheRef.current || savedIndexCacheRef.current.key !== savedEpisodeContentKey || savedIndexCacheRef.current.ctx !== ctxOf) {
        savedIndexCacheRef.current = { key: savedEpisodeContentKey, ctx: ctxOf, value: buildSavedEpisodeIndex(rawEvents) }
    }
    const savedEpisodeEvents = savedIndexCacheRef.current.value
    const { history, inProgress, hasEventLog } = useMemo(() => {
        // Interrupted-render cache: concurrent React restarts in-progress deferred
        // renders when higher-priority store publications arrive mid-derivation,
        // discarding the memoized result and re-executing this full-history pass.
        // Keying the result by its input references in a ref makes every restart a
        // reference comparison instead of a second O(events + live items) derivation.
        // The body is a pure derivation of the deps, so an abandoned attempt's value
        // is exactly what the committed attempt produces for the same inputs.
        const deps = [events, liveItems, accounts, accountId, genreMap, deletedEventKeys, savedEpisodeEvents]
        const cached = baseDerivationRef.current
        if (cached && depsEqual(cached.deps, deps)) return cached.value
        const normalizeName = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^a-z0-9]/g, '')

        const liveByAccountItem = new Map<string, ActivityItem>()
        for (const item of liveItems) {
            const ctx = ctxOf(item.accountId, item.sourceConnectionId)
            liveByAccountItem.set(`${ctx}:${item.uniqueItemId || item.itemId}`, item)
            if (item.episode !== undefined) {
                liveByAccountItem.set(
                    `${ctx}:${getEpisodeIdentity(item.itemId, item.uniqueItemId, item.season, item.episode, item.type)}`,
                    item
                )
            }
        }

        const seriesOverallTime = new Map<string, number>()
        for (const item of liveItems) {
            if (item.overallTimeWatched && item.overallTimeWatched > 0) {
                const key = `${ctxOf(item.accountId, item.sourceConnectionId)}:${item.itemId}`
                const existing = seriesOverallTime.get(key)
                if (!existing || item.overallTimeWatched > existing) {
                    seriesOverallTime.set(key, item.overallTimeWatched)
                }
            }
        }

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
                const episodeKey = getEpisodeIdentity(event.itemId, event.video_id, event.season, event.episode, event.type)
                const key = `${ctxOf(event.accountId, event.sourceConnectionId)}:${episodeKey}:${getLocalDayKey(event.event_ts)}`
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
            const episodeKey = getEpisodeIdentity(event.itemId, event.video_id, event.season, event.episode, event.type)
            const key = `${ctxOf(event.accountId, event.sourceConnectionId)}:${episodeKey}`
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

        const eventEntries: HistoryEntry[] = seriesDedupedEvents.map(event => {
            const ctx = ctxOf(event.accountId, event.sourceConnectionId)
            const live = liveByAccountItem.get(
                `${ctx}:${getEpisodeIdentity(event.itemId, event.video_id, event.season, event.episode, event.type)}`
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
                overallTimeWatched: seriesOverallTime.get(`${ctx}:${event.itemId}`),
                timesWatched: live?.timesWatched ?? event.timesWatched,
                // Per-episode confirmation stamped on the event wins; the live overlay
                // (Stremio's own flaggedWatched marker, e.g. marked-watched movies) stays
                // the fallback when the event itself carries no flag.
                flaggedWatched: event.flaggedWatched ?? live?.flaggedWatched,
                isInProgress: live?.isInProgress ?? false,
                isFromEventLog: true,
                source: event.source || live?.source || 'stremio',
                sourceConnectionId: event.sourceConnectionId ?? live?.sourceConnectionId,
                backfill: event.backfill,
                genres: genreMap.get(event.itemId),
                liveProgress: live?.progress,
                liveWatched: live?.watched,
                liveEpisode: live?.uniqueItemId,
            }
        })

        // Find live items not represented in the event log yet
        // (new items added since last diff, or first-run before any events)
        const eventItemIds = new Set(seriesDedupedEvents.map(e =>
            `${ctxOf(e.accountId, e.sourceConnectionId)}:${getEpisodeIdentity(e.itemId, e.video_id, e.season, e.episode, e.type)}`
        ))
        const eventIdentityKeys = new Set<string>()
        for (const entry of seriesDedupedEvents) {
            const name = normalizeName(entry.name || '')
            const episode = entry.episode
            if (name && episode != null) {
                eventIdentityKeys.add(`${ctxOf(entry.accountId, entry.sourceConnectionId)}:${name}:${episode}`)
            }
        }
        const liveOnlyItems = (accountId
            ? liveItems.filter(i => i.accountId === accountId)
            : liveItems
        ).filter(item => {
            const ctx = ctxOf(item.accountId, item.sourceConnectionId)
            const deletedTs = deletedEventKeys[`${ctx}:${getEpisodeIdentity(item.itemId, item.uniqueItemId, item.season, item.episode, item.type)}`]
            if (deletedTs !== undefined && item.timestamp.getTime() <= deletedTs) {
                trace('useWatchHistory', 'liveonly.tombstoned', { accountId: item.accountId, itemId: item.itemId, source: item.source, name: item.name, ts: item.timestamp.getTime(), deletedTs })
                return false
            }
            if (item.source && item.source !== 'stremio') return true
            if (eventItemIds.has(
                `${ctx}:${getEpisodeIdentity(item.itemId, item.uniqueItemId, item.season, item.episode, item.type)}`
            )) return false
            const name = normalizeName(item.name || '')
            if (name && item.episode != null && eventIdentityKeys.has(`${ctx}:${name}:${item.episode}`)) return false
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
            flaggedWatched: item.flaggedWatched,
            isInProgress: item.isInProgress,
            isFromEventLog: false,
            source: item.source,
            sourceConnectionId: item.sourceConnectionId,
            liveProgress: item.progress,
            liveWatched: item.watched,
            liveEpisode: item.uniqueItemId,
            // Imported saved watch state (bitfield-aggregate series / flagged-only movie):
            // no real watch dates, so it is excluded from the dated chronology and time-based
            // stats exactly like the per-episode backfill recoveries it summarizes. The
            // timestamp stays the honest import/observation time for ordering and labels only.
            ...(item.importedSavedState ? {
                importedSavedState: true,
                backfill: true,
                savedEpisodes: summarizeSavedEpisodes(
                    savedEpisodeEvents.get(`${ctxOf(item.accountId, item.sourceConnectionId)}:${item.itemId}`) ?? [],
                ),
            } : {}),
        }))

        // Merge: event log entries first (richer history), then live-only
        const allEntries = [...eventEntries, ...liveOnlyEntries]
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

        const finalDedup = new Map<string, HistoryEntry>()
        for (const entry of allEntries) {
            const normalizedName = normalizeName(entry.name || '')
            const isSeries = entry.type === 'series' || entry.type === 'anime' || entry.type === 'episode'
            const entryCtx = ctxOf(entry.accountId, entry.sourceConnectionId)
            // Correlate platform duplicates within a watch day, preserving earlier watches.
            const watchDay = entry.timestamp.toDateString()
            const episodeKey = isSeries && entry.episode != null
                ? `${entryCtx}:${watchDay}:${normalizedName}:${entry.season ?? 1}:${entry.episode}`
                : `${entryCtx}:${watchDay}:${normalizedName}`

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

        const bestNamesByItemId = new Map<string, { name: string; poster?: string }>()
        for (const entry of dedupedList) {
            if (isUnresolvedActivityName(entry.name)) continue
            const existing = bestNamesByItemId.get(entry.itemId)
            if (!existing || entry.name.length > existing.name.length) {
                bestNamesByItemId.set(entry.itemId, { name: entry.name, poster: entry.poster || undefined })
            }
        }

        const enrichedHistory = bestNamesByItemId.size > 0
            ? dedupedList.map(entry => {
                if (!isUnresolvedActivityName(entry.name)) return entry
                const best = bestNamesByItemId.get(entry.itemId)
                if (!best) return entry
                return { ...entry, name: best.name, poster: entry.poster || best.poster || entry.poster }
            })
            : dedupedList

        const railEvents = eventEntries
            .filter(entry => !entry.backfill)
            .map(entry => ({
                key: `${ctxOf(entry.accountId, entry.sourceConnectionId)}:${getEpisodeIdentity(entry.itemId, entry.video_id, entry.season, entry.episode, entry.type)}`,
                timestamp: entry.timestamp.getTime(),
                progress: entry.progress,
            }))

        const inProgress = reconcileRailProgress(
            (accountId
                ? liveItems.filter(i => i.accountId === accountId)
                : liveItems
            ).filter(i => i.isInProgress)
                .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
                .map(item => ({
                    ...item,
                    key: `${ctxOf(item.accountId, item.sourceConnectionId)}:${getEpisodeIdentity(item.itemId, item.uniqueItemId, item.season, item.episode, item.type)}`,
                })),
            railEvents
        ).map(({ key: _key, ...item }) => item)

        const value = {
            history: enrichedHistory,
            inProgress,
            hasEventLog: events.length > 0,
        }
        baseDerivationRef.current = { deps, value }
        return value
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [events, liveItems, accounts, accountId, genreMap, deletedEventKeys, savedEpisodeEvents])

    useEffect(() => {
        if (!events || events.length === 0) return
        const seen = new Set<string>()
        const typeByItemId = new Map<string, string | undefined>()
        for (const e of events) {
            const id = e.itemId
            if (id && id.startsWith('tt') && !seen.has(id)) {
                seen.add(id)
                typeByItemId.set(id, e.type)
            }
        }
        const needsGenres = [...seen].filter(id => !genreMap.has(id))
        if (needsGenres.length === 0) return
        let cancelled = false
        const BATCH = 5
        const results = new Map<string, string[]>()
        const failed = new Set<string>()
        ;(async () => {
            if (import.meta.env?.DEV) console.log('[GenreResolve] processing', needsGenres.length, 'items,', seen.size, 'tt items found')
            for (let i = 0; i < needsGenres.length; i += BATCH) {
                if (cancelled) return
                const batch = needsGenres.slice(i, i + BATCH)
                await Promise.all(batch.map(async id => {
                    const meta = await fetchCinemetaDetail(id, typeByItemId.get(id))
                    if (meta && typeof meta.genre === 'string' && meta.genre.trim()) {
                        const genres = meta.genre.split(',').map(g => g.trim()).filter(Boolean)
                        if (genres.length > 0) results.set(id, genres)
                        else failed.add(id)
                    } else {
                        failed.add(id)
                    }
                }))
            }
            if (!cancelled) {
                if (import.meta.env?.DEV) console.log('[GenreResolve] resolved', results.size, 'failed', failed.size, 'of', needsGenres.length)
                const merged = new Map(genreMap)
                for (const [id, g] of results) merged.set(id, g)
                for (const id of failed) if (!merged.has(id)) merged.set(id, [])
                for (const id of merged.keys()) {
                    if (!seen.has(id)) merged.delete(id)
                }
                saveGenreCache(merged)
                setGenreMap(merged)
            }
        })()
        return () => { cancelled = true }
    }, [events, genreMap])

    const combinedCacheRef = useRef<{ deps: unknown[]; value: { history: HistoryEntry[]; inProgress: ActivityItem[] } } | null>(null)
    const combined = useMemo(() => {
        // Same interrupted-render cache as the base derivation: the merge below walks
        // every history + media row and restarts pay full price without it.
        const deps = [history, inProgress, media.history, media.inProgress, deletedEventKeys, ctxOf]
        const cached = combinedCacheRef.current
        if (cached && depsEqual(cached.deps, deps)) return cached.value
        const byId = new Map(history.map(entry => [entry.id, entry]))
        const notDeleted = (item: ActivityItem) => {
            const deletedAt = deletedEventKeys[`${ctxOf(item.accountId, item.sourceConnectionId)}:${getEpisodeIdentity(item.itemId, item.uniqueItemId, item.season, item.episode, item.type)}`]
            return deletedAt === undefined || item.timestamp.getTime() > deletedAt
        }
        const merged = mergeMediaHistory(history.map(historyEntryToActivityItem), media.history.filter(notDeleted))
        const entries: HistoryEntry[] = merged.map(item => {
            const existing = byId.get(item.id)
            return existing ? { ...existing, mediaSources: item.mediaSources, mediaTargets: item.mediaTargets } : {
                ...item, video_id: item.uniqueItemId, isFromEventLog: false,
            }
        })
        entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        const value = { history: entries, inProgress: mergeMediaItems(inProgress, media.inProgress.filter(notDeleted)) }
        combinedCacheRef.current = { deps, value }
        return value
    }, [history, inProgress, media.history, media.inProgress, deletedEventKeys, ctxOf])
    return { ...combined, hasEventLog, loading: loading || media.initialLoading, refreshMedia: media.refresh, mediaIssues: media.readIssues }
}
