export interface LibraryItem {
    _id: string
    name?: string
    type?: string
    poster?: string
    background?: string
    logo?: string
    removed?: boolean
    temp?: boolean
    state?: {
        lastWatched?: string
        timeOffset?: number
        duration?: number
        flaggedWatched?: number
        timesWatched?: number
        timeWatched?: number
        overallTimeWatched?: number
        video_id?: string
        watched?: string
        season?: number
        episode?: number
    }
    _ctime?: string
    _mtime?: string
}

export interface ActivityItem {
    id: string // Unique ID: accountId:uniqueItemId (episode-aware)
    accountId: string
    accountName: string
    accountColorIndex: number
    itemId: string // Base item ID (e.g., tt123)
    uniqueItemId: string // Episode-aware ID (e.g., tt123:1:5 for series)
    name: string
    type: string
    poster: string
    timestamp: Date      // Last watched (_mtime / lastWatched)
    firstWatched?: Date  // First added to library (_ctime) - when they started watching
    duration: number
    watched: number
    progress: number
    timesWatched?: number  // From state.timesWatched
    flaggedWatched?: number // From state.flaggedWatched (Stremio's watched bit)
    isInProgress: boolean  // timeOffset > 0 && progress < 90
    season?: number
    episode?: number
    overallTimeWatched?: number
    genres?: string[]
    source?: string // platform the watch came from: 'stremio' | 'nuvio' | ... (absent = unknown)
    sourceConnectionId?: string // exact remote login this item came from (same-platform multiplicity); absent = canonical/legacy route
    backfill?: boolean // recovered from Stremio's watched-bitfield; no real per-episode time, so excluded from time-based Replay stats
    readOnly?: boolean
    mediaObservation?: { connectionId: string; productName: string; kind: 'resume' | 'played' | 'live'; checkedAt: number; reportedAt?: number; hasPlayedDate: boolean; positionMs: number; isPaused?: boolean }
    mediaSources?: string[]
    /** Exact user-scoped server items contributing to this observation. */
    mediaTargets?: Array<{ connectionId: string; itemId: string }>
}

// A detected watch event from snapshot diffing.
// Accumulated in the cloud sync blob as the source of truth for
// Activity, Metrics, and Replay history.
export interface WatchEvent {
    id: string
    accountId: string
    itemId: string
    video_id: string
    event_ts: number
    detected_ts: number
    name: string
    type: string
    poster: string
    time_watched: number
    time_watched_delta?: number
    duration: number
    season?: number
    episode?: number
    source?: string
    sourceConnectionId?: string // exact remote login that produced this event; absent = canonical/legacy account scope
    /** Frozen identity scope (canonical events carry attribution but keep the bare scope). */
    scopeKey?: string
    timesWatched?: number
    backfill?: boolean // recovered from Stremio's watched-bitfield (no real per-episode timestamp)
}

export interface SnapshotItem {
    mtime: number
    video_id: string
    overallTimeWatched: number
    timeWatched: number
    timeOffset: number
    duration?: number
    season?: number
    episode?: number
}
