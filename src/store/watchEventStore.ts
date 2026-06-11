import { create } from 'zustand'
import localforage from 'localforage'
import { WatchEvent, SnapshotItem, LibraryItem } from '@/types/activity'
import { StremioAccount } from '@/types/account'
import { getSeasonEpisode, parseStremioDate, isActuallyWatched, getLocalDayKey, getEpisodeIdentity } from '@/lib/activity-utils'
import { decodeWatchedBitfield } from '@/lib/watched-bitfield'
import { resolveWatchedEpisodes, fetchSeriesVideos } from '@/lib/watched-episodes'

const STORAGE_KEY = 'aio_watch_events_v2'

// Per-session guard: `${accountId}:${seriesId}:${watchedString}` already attempted, so repeated
// library refreshes don't re-decode + re-fetch Cinemeta for unchanged series.
const backfillProcessed = new Set<string>()

// Snapshot: { [accountId]: { [itemId]: SnapshotItem } }
type Snapshot = Record<string, Record<string, SnapshotItem>>

function isSeriesItem(item: LibraryItem): boolean {
    return item.type === 'series' || item.type === 'anime' || item.type === 'episode'
}

function getSeasonEpisodeForVideoId(item: LibraryItem, videoId: string): { season?: number; episode?: number } {
    return getSeasonEpisode({
        ...item,
        state: {
            ...(item.state || {}),
            video_id: videoId
        }
    })
}

interface WatchEventState {
    events: WatchEvent[]
    snapshot: Snapshot
    initialized: boolean

    initialize: (events: WatchEvent[], snapshot: Snapshot) => void
    load: () => Promise<void>

    diffAndRecord: (
        accountId: string,
        items: LibraryItem[],
        account: StremioAccount,
        accounts: StremioAccount[]
    ) => WatchEvent[]

    mergeServerEvents: (serverEvents: ServerActivityEvent[]) => void

    recordBackfillEpisodes: (accountId: string, items: LibraryItem[]) => Promise<number>

    export: () => { events: WatchEvent[]; snapshot: Snapshot }
    reset: () => void
}

interface ServerActivityEvent {
    id: string
    accountId: string
    accountName: string
    itemId: string
    uniqueItemId: string
    name: string
    type: string
    poster: string
    season: number | null
    episode: number | null
    videoId: string | null
    eventType: string
    timestamp: number
    duration: number
    progress: number
    watched: number
    timesWatched: number
    isInProgress: boolean
    overallTimeWatched: number
}

async function persistWatchEvents(events: WatchEvent[], snapshot: Snapshot) {
    try {
        await localforage.setItem(STORAGE_KEY, { events, snapshot })
    } catch (e) {
        if (import.meta.env.DEV) console.error('[watchEventStore] persist failed:', e)
    }
}

export const useWatchEventStore = create<WatchEventState>((set, get) => ({
    events: [],
    snapshot: {},
    initialized: false,

    initialize: (events, snapshot) => {
        const cleaned = events.filter(e => {
            const isSeries = e.type === 'series' || e.type === 'anime' || e.type === 'episode'
            if (!isSeries) return true
            if (e.episode != null) return true
            if (e.season != null) return true
            if (e.video_id !== e.itemId) return true
            return false
        })
        set({ events: cleaned, snapshot, initialized: true })
        persistWatchEvents(cleaned, snapshot)
    },

    load: async () => {
        const state = get()
        if (state.initialized) return
        try {
            const stored = await localforage.getItem<{ events: WatchEvent[]; snapshot: Snapshot }>(STORAGE_KEY)
            if (stored && stored.events) {
                const cleaned = stored.events.filter(e => {
                    const isSeries = e.type === 'series' || e.type === 'anime' || e.type === 'episode'
                    if (!isSeries) return true
                    if (e.episode != null) return true
                    if (e.season != null) return true
                    if (e.video_id !== e.itemId) return true
                    return false
                })
                set({ events: cleaned, snapshot: stored.snapshot || {}, initialized: true })
            } else {
                set({ initialized: true })
            }
        } catch (e) {
            if (import.meta.env.DEV) console.error('[watchEventStore] load failed:', e)
            set({ initialized: true })
        }
    },

    diffAndRecord: (accountId, items, _account, _accounts) => {
        const now = Date.now()
        const state = get()
        const accountSnapshot = state.snapshot[accountId] || {}
        const newEvents: WatchEvent[] = []
        const updatedSnapshot = { ...accountSnapshot }
        const existingEventIds = new Set(state.events.map(e => e.id))
        const existingSessionEvents = new Map<string, WatchEvent>()
        let snapshotChanged = false

        for (const event of state.events) {
            const episodeKey = getEpisodeIdentity(event.itemId, event.video_id, event.season, event.episode)
            const key = `${event.accountId}:${episodeKey}:${getLocalDayKey(event.event_ts)}`
            const existing = existingSessionEvents.get(key)
            if (
                !existing ||
                event.event_ts > existing.event_ts ||
                (event.event_ts === existing.event_ts && event.detected_ts > existing.detected_ts)
            ) {
                existingSessionEvents.set(key, event)
            }
        }

        const setSnapshotItem = (itemId: string, next: SnapshotItem) => {
            const current = updatedSnapshot[itemId]
            if (
                !current ||
                current.mtime !== next.mtime ||
                current.video_id !== next.video_id ||
                current.overallTimeWatched !== next.overallTimeWatched ||
                current.timeWatched !== next.timeWatched ||
                (current.duration || 0) !== (next.duration || 0) ||
                current.season !== next.season ||
                current.episode !== next.episode
            ) {
                snapshotChanged = true
            }
            updatedSnapshot[itemId] = next
        }

        const preserveSnapshotEvent = (item: LibraryItem, prior: SnapshotItem) => {
            if (!isSeriesItem(item) || !prior.mtime) return

            const { season: priorSeason, episode: priorEpisode } = getSeasonEpisodeForVideoId(item, prior.video_id)
            const season = prior.season ?? priorSeason
            const episode = prior.episode ?? priorEpisode
            if (season == null && episode == null && (!prior.video_id || prior.video_id === item._id)) return

            const episodeKey = getEpisodeIdentity(item._id, prior.video_id, season, episode)
            const sessionKey = `${accountId}:${episodeKey}:${getLocalDayKey(prior.mtime)}`
            if (existingSessionEvents.has(sessionKey)) return

            const eventId = `${accountId}:${prior.video_id}:${prior.mtime}`
            if (existingEventIds.has(eventId)) return

            const watched = prior.timeWatched || 0
            const event: WatchEvent = {
                id: eventId,
                accountId,
                itemId: item._id,
                video_id: prior.video_id,
                event_ts: prior.mtime,
                detected_ts: now,
                name: item.name || 'Unknown',
                type: item.type || 'other',
                poster: item.poster || '',
                time_watched: watched,
                time_watched_delta: watched > 0 ? watched : undefined,
                duration: prior.duration || item.state?.duration || 0,
                season,
                episode,
            }

            newEvents.push(event)
            existingEventIds.add(eventId)
            existingSessionEvents.set(sessionKey, event)
        }

        for (const item of items) {
            if (!item._id) continue

            const mtimeDate = parseStremioDate(item._mtime)
            const mtime = mtimeDate ? mtimeDate.getTime() : 0
            if (!mtime) continue

            const video_id = item.state?.video_id || item._id
            const prior = accountSnapshot[item._id]

            if (item.removed && !prior) continue

            if (item.removed) {
                setSnapshotItem(item._id, { mtime, video_id, overallTimeWatched: 0, timeWatched: 0, duration: 0 })
                continue
            }

            // If no prior snapshot entry AND _ctime exists, seed a "first watched" event.
            // This gives retroactive history for the entire existing library on first run.
            if (!prior) {
                if (!isActuallyWatched(item)) {
                    setSnapshotItem(item._id, { mtime, video_id, overallTimeWatched: 0, timeWatched: 0, duration: 0 })
                    continue
                }
                const isSeries = isSeriesItem(item)
                const hasVideoId = !!(item.state?.video_id && item.state.video_id.trim() !== '')
                if (!isSeries || hasVideoId) {
                    const ctimeDate = parseStremioDate(item._ctime)
                    if (ctimeDate) {
                        const ctimeTs = ctimeDate.getTime()
                        const seedId = `${accountId}:${video_id}:${ctimeTs}`
                        if (!existingEventIds.has(seedId)) {
                            const { season, episode } = getSeasonEpisode(item)
                            newEvents.push({
                                id: seedId,
                                accountId,
                                itemId: item._id,
                                video_id,
                                event_ts: ctimeTs,
                                detected_ts: now,
                                name: item.name || 'Unknown',
                                type: item.type || 'other',
                                poster: item.poster || '',
                                time_watched: item.state?.timeWatched || 0,
                                time_watched_delta: item.state?.overallTimeWatched || 0,
                                duration: item.state?.duration || 0,
                                season,
                                episode,
                            })
                            existingEventIds.add(seedId)
                        }
                    }
                }
                const { season: seedSeason, episode: seedEpisode } = getSeasonEpisode(item)
                setSnapshotItem(item._id, {
                    mtime, video_id,
                    overallTimeWatched: item.state?.overallTimeWatched || 0,
                    timeWatched: item.state?.timeWatched || 0,
                    duration: item.state?.duration || 0,
                    season: seedSeason,
                    episode: seedEpisode,
                })
                continue
            }


            const mtimeChanged = mtime > prior.mtime
            const { season: currentSeason, episode: currentEpisode } = getSeasonEpisode(item)
            const episodeAdvanced = video_id !== prior.video_id ||
                currentSeason !== prior.season ||
                currentEpisode !== prior.episode

            if (isActuallyWatched(item) && (episodeAdvanced || !mtimeChanged)) {
                preserveSnapshotEvent(item, prior)
            }

            if ((mtimeChanged || episodeAdvanced) && isActuallyWatched(item)) {
                const currentOverall = item.state?.overallTimeWatched || 0
                const priorOverall = prior.overallTimeWatched || 0
                const delta = Math.max(0, currentOverall - priorOverall)
                const currentTW = item.state?.timeWatched || 0
                const priorTW = prior.timeWatched || 0
                const deltaTW = Math.max(0, currentTW - priorTW)
                const watchedDelta = delta || deltaTW
                const episodeKey = getEpisodeIdentity(item._id, video_id, currentSeason, currentEpisode)
                const sessionKey = `${accountId}:${episodeKey}:${getLocalDayKey(mtime)}`
                const mergeCandidate = !episodeAdvanced
                    ? existingSessionEvents.get(sessionKey)
                    : undefined

                if (mergeCandidate) {
                    const mergedEvent = {
                        ...mergeCandidate,
                        event_ts: Math.max(mergeCandidate.event_ts, mtime),
                        detected_ts: now,
                        name: item.name || mergeCandidate.name || 'Unknown',
                        type: item.type || mergeCandidate.type || 'other',
                        poster: item.poster || mergeCandidate.poster || '',
                        time_watched: Math.max(mergeCandidate.time_watched || 0, currentTW),
                        time_watched_delta: Math.max(mergeCandidate.time_watched_delta || 0, watchedDelta),
                        duration: item.state?.duration || mergeCandidate.duration || 0,
                        season: currentSeason,
                        episode: currentEpisode,
                    }
                    newEvents.push(mergedEvent)
                    existingEventIds.add(mergeCandidate.id)
                    existingSessionEvents.set(sessionKey, mergedEvent)
                } else {
                    const eventId = `${accountId}:${video_id}:${mtime}`
                    if (!existingEventIds.has(eventId)) {
                        newEvents.push({
                            id: eventId,
                            accountId,
                            itemId: item._id,
                            video_id,
                            event_ts: mtime,
                            detected_ts: now,
                            name: item.name || 'Unknown',
                            type: item.type || 'other',
                            poster: item.poster || '',
                            time_watched: currentTW,
                            time_watched_delta: watchedDelta,
                            duration: item.state?.duration || 0,
                            season: currentSeason,
                            episode: currentEpisode,
                        })
                        existingEventIds.add(eventId)
                    }
                }
            }

            if (mtimeChanged || episodeAdvanced) {
                setSnapshotItem(item._id, {
                    mtime, video_id,
                    overallTimeWatched: item.state?.overallTimeWatched || 0,
                    timeWatched: item.state?.timeWatched || 0,
                    duration: item.state?.duration || 0,
                    season: currentSeason,
                    episode: currentEpisode,
                })
            }
        }

        if (newEvents.length === 0 && !snapshotChanged) {
            return []
        }

        const merged = [...state.events, ...newEvents]
        const deduped = Array.from(new Map(merged.map(e => [e.id, e])).values())
        const sorted = deduped.sort((a, b) => b.event_ts - a.event_ts)

        const nextSnapshot = {
            ...state.snapshot,
            [accountId]: { ...accountSnapshot, ...updatedSnapshot },
        }

        set({
            events: sorted,
            snapshot: nextSnapshot,
        })

        persistWatchEvents(sorted, nextSnapshot)
        return newEvents
    },

    // Backfill complete per-episode history from Stremio's watched-bitfield for tt series. Fills
    // gaps the live video_id sampling misses (binges / batched device syncs). Events are marked
    // backfill (synthetic timestamp -> excluded from time-based Replay stats) and deduped against
    // any existing event for the same episode, so real watch data always wins and nothing double-counts.
    recordBackfillEpisodes: async (accountId, items) => {
        const state = get()
        const existingIdentities = new Set<string>()
        for (const e of state.events) {
            if (e.accountId !== accountId) continue
            existingIdentities.add(getEpisodeIdentity(e.itemId, e.video_id, e.season, e.episode))
        }
        const existingIds = new Set(state.events.map(e => e.id))
        const now = Date.now()
        const newEvents: WatchEvent[] = []

        for (const item of items) {
            const seriesId = item._id
            if (!seriesId || !isSeriesItem(item) || !seriesId.startsWith('tt')) continue

            const guardKey = `${accountId}:${seriesId}:${item.state?.watched || ''}`
            if (backfillProcessed.has(guardKey)) continue

            const decoded = await decodeWatchedBitfield(item.state?.watched)
            if (!decoded || decoded.watchedIndices.length === 0) { backfillProcessed.add(guardKey); continue }
            const videos = await fetchSeriesVideos(seriesId)
            if (!videos) continue // transient (meta fetch failed) -> retry on a later refresh
            backfillProcessed.add(guardKey) // deterministic from here (resolved or fail-closed)
            const episodes = resolveWatchedEpisodes(decoded, videos)
            if (!episodes) continue // fail-closed checksum did not pass

            const ts = parseStremioDate(item.state?.lastWatched)?.getTime()
                || parseStremioDate(item._mtime)?.getTime()
                || now

            for (const ep of episodes) {
                const season = ep.season ?? undefined
                const episode = ep.episode ?? undefined
                const identity = getEpisodeIdentity(seriesId, ep.videoId, season, episode)
                if (existingIdentities.has(identity)) continue // real event already covers this episode
                const id = `bf:${accountId}:${ep.videoId}`
                if (existingIds.has(id)) continue

                newEvents.push({
                    id,
                    accountId,
                    itemId: seriesId,
                    video_id: ep.videoId,
                    event_ts: ts,
                    detected_ts: now,
                    name: item.name || 'Unknown',
                    type: item.type || 'series',
                    poster: item.poster || '',
                    time_watched: 0,
                    duration: 0,
                    season,
                    episode,
                    backfill: true,
                })
                existingIdentities.add(identity)
                existingIds.add(id)
            }
        }

        if (newEvents.length === 0) return 0

        const cur = get()
        const merged = [...cur.events, ...newEvents]
        const deduped = Array.from(new Map(merged.map(e => [e.id, e])).values())
        const sorted = deduped.sort((a, b) => b.event_ts - a.event_ts)
        set({ events: sorted })
        persistWatchEvents(sorted, cur.snapshot)
        return newEvents.length
    },

    export: () => ({
        events: get().events,
        snapshot: get().snapshot,
    }),

    reset: () => {
        set({ events: [], snapshot: {}, initialized: false })
        localforage.removeItem(STORAGE_KEY).catch(() => {})
    },

    mergeServerEvents: (serverEvents) => {
        if (!serverEvents || serverEvents.length === 0) return
        const state = get()
        const now = Date.now()
        const eventsById = new Map(state.events.map(e => [e.id, e]))
        const localCanonical = new Map<string, number[]>()
        for (const e of state.events) {
            const key = `${e.accountId}:${e.itemId}:${e.video_id || ''}`
            let arr = localCanonical.get(key)
            if (!arr) { arr = []; localCanonical.set(key, arr) }
            arr.push(e.event_ts)
        }
        const TWO_MINUTES = 2 * 60 * 1000
        const newEvents: WatchEvent[] = []
        let changed = false

        for (const se of serverEvents) {
            const video_id = se.videoId || se.uniqueItemId || se.itemId
            const event: WatchEvent = {
                id: se.id,
                accountId: se.accountId,
                itemId: se.itemId,
                video_id,
                event_ts: se.timestamp,
                detected_ts: now,
                name: se.name || 'Unknown',
                type: se.type || 'other',
                poster: se.poster || '',
                time_watched: se.progress || se.watched || 0,
                time_watched_delta: undefined,
                duration: se.duration || 0,
                season: se.season ?? undefined,
                episode: se.episode ?? undefined,
            }

            const existingEvent = eventsById.get(se.id)
            if (existingEvent) {
                const mergedEvent = { ...existingEvent, ...event }
                if (
                    existingEvent.video_id !== mergedEvent.video_id ||
                    existingEvent.time_watched !== mergedEvent.time_watched ||
                    existingEvent.duration !== mergedEvent.duration ||
                    existingEvent.season !== mergedEvent.season ||
                    existingEvent.episode !== mergedEvent.episode ||
                    existingEvent.event_ts !== mergedEvent.event_ts
                ) {
                    eventsById.set(se.id, mergedEvent)
                    changed = true
                }
                continue
            }

            const canonicalKey = `${se.accountId}:${se.itemId}:${video_id || ''}`
            const localTimestamps = localCanonical.get(canonicalKey)
            if (localTimestamps && localTimestamps.some(ts => Math.abs(se.timestamp - ts) < TWO_MINUTES)) continue

            newEvents.push(event)
            eventsById.set(se.id, event)
            changed = true
        }

        if (newEvents.length === 0 && !changed) return

        const sorted = Array.from(eventsById.values()).sort((a, b) => b.event_ts - a.event_ts)

        const newSnapshot = { ...state.snapshot }
        for (const e of sorted) {
            if (!newSnapshot[e.accountId]) newSnapshot[e.accountId] = {}
            const existing = newSnapshot[e.accountId][e.itemId]
            if (!existing || e.event_ts >= (existing as SnapshotItem).mtime) {
                newSnapshot[e.accountId] = {
                    ...newSnapshot[e.accountId],
                    [e.itemId]: {
                        mtime: e.event_ts,
                        video_id: e.video_id || e.itemId,
                        overallTimeWatched: e.time_watched || 0,
                        timeWatched: e.time_watched || 0,
                        duration: e.duration || 0,
                        season: e.season,
                        episode: e.episode,
                    } as SnapshotItem
                }
            }
        }

        set({ events: sorted, snapshot: newSnapshot })
        persistWatchEvents(sorted, newSnapshot)
    },
}))
