// Public type contract for the read-only Jellyfin-protocol client.
//
// This family of connections speaks the Jellyfin HTTP API against several distinct
// products: genuine Jellyfin servers, the AIOStreams Jellyfin facade and the
// AIOMetadata Jellyfin facade. Product identity is therefore reported explicitly
// (see JellyfinServerDetails) and must never be inferred from ProductName alone.

/** Detected product behind a Jellyfin-compatible API. */
export type JellyfinProduct = 'jellyfin' | 'aiostreams' | 'aiometadata' | 'compatible'

/** Error classification used by JellyfinError. */
export type JellyfinErrorKind =
    | 'invalid-url' // base URL rejected before any request was made
    | 'auth' // 401/403, rejected credentials, user mismatch or non-user-scoped token
    | 'unsupported' // endpoint missing (404), protocol mismatch, non-JSON response
    | 'server' // upstream 5xx / rate limiting
    | 'network' // fetch transport failure
    | 'invalid-response' // JSON that does not match the expected shape
    | 'timeout' // per-request timeout elapsed
    | 'aborted' // caller aborted via AbortSignal

/** Raw user DTO. Id is the only field every implementation is required to return. */
export interface JellyfinUser {
    Id: string
    Name?: string
    HasPassword?: boolean
    PrimaryImageTag?: string
    [key: string]: unknown
}

/** Result of signIn / connectToken. serverId is only known when the upstream reports it. */
export interface JellyfinSignIn {
    accessToken: string
    user: JellyfinUser
    serverId?: string
}

/** Shape of GET /System/Info/Public (and the common subset of /System/Info). */
export interface JellyfinSystemInfo {
    ServerName?: string
    Version?: string
    ProductName?: string
    Id?: string
    OperatingSystem?: string
    [key: string]: unknown
}

/**
 * Product-aware server description returned by inspect(). `productName` is a
 * stable display label (Jellyfin / AIOStreams / AIOMetadata /
 * Jellyfin-compatible server); the raw upstream PackageName is preserved
 * separately in `packageName` when the authenticated endpoint reports it.
 */
export interface JellyfinServerDetails {
    product: JellyfinProduct
    productName: string
    serverId?: string
    serverName?: string
    version?: string
    packageName?: string
}

/** Per-item user data relevant to watched/resume state. */
export interface JellyfinUserData {
    Played?: boolean
    PlaybackPositionTicks?: number
    LastPlayedDate?: string
    PlayCount?: number
    [key: string]: unknown
}

/** Library item (movie / episode) as returned by resume and played queries. */
export interface JellyfinItem {
    Id: string
    Name?: string
    Type?: string
    SeriesName?: string
    SeriesId?: string
    ParentIndexNumber?: number
    IndexNumber?: number
    RunTimeTicks?: number
    ProviderIds?: Record<string, string>
    /** Provider IDs verified from this episode's parent Series record. */
    SeriesProviderIds?: Record<string, string>
    UserData?: JellyfinUserData
    [key: string]: unknown
}

/**
 * Bounded result of readResume()/readPlayed(). Completeness is reported, never
 * assumed: `total` is the upstream-reported count only when it is a finite
 * nonnegative integer (null when unknown or invalid), and `complete` is true
 * only when the read is defensibly exhaustive — never merely because a page
 * ran out while a cap, duplicate, or contradictory total was observed.
 */
export interface JellyfinItemResult {
    items: JellyfinItem[]
    /** Upstream total when reported as a finite nonnegative integer; null when unknown. */
    total: number | null
    /** True only when nothing suggests truncation, duplicate inflation or contradiction. */
    complete: boolean
    /** The bound this read applied: 50 for resume, 500 for played. */
    limit: number
}

export interface JellyfinPagedReadOptions {
    maxItems?: number
    pageSize?: number
}

export interface JellyfinItemQuery {
    ids?: string[]
    parentId?: string
    includeItemTypes?: string
    startIndex?: number
    limit?: number
}

export interface JellyfinUserDataUpdate {
    Played?: true
    PlaybackPositionTicks?: number
    LastPlayedDate?: string
    PlayCount?: number
}

/** Backward-compatible alias for the played-history result. */
export type JellyfinPlayedResult = JellyfinItemResult

/** Raw now-playing item DTO from /Sessions. */
export interface JellyfinNowPlayingItem {
    Id?: string
    Name?: string
    Type?: string
    SeriesName?: string
    SeriesId?: string
    ParentIndexNumber?: number
    IndexNumber?: number
    RunTimeTicks?: number
    ProviderIds?: Record<string, string>
    SeriesProviderIds?: Record<string, string>
    UserData?: JellyfinUserData
    [key: string]: unknown
}

/** Raw play-state DTO from /Sessions. */
export interface JellyfinPlayState {
    PositionTicks?: number
    IsPaused?: boolean
    IsMuted?: boolean
    CanSeek?: boolean
    [key: string]: unknown
}

/**
 * Raw /Sessions row. Only rows carrying NowPlayingItem + PlayState + a fresh
 * LastPlaybackCheckIn are treated as live playback by readSessions.
 */
export interface JellyfinSession {
    Id?: string
    UserId?: string
    UserName?: string
    Client?: string
    DeviceName?: string
    ApplicationVersion?: string
    NowPlayingItem?: JellyfinNowPlayingItem
    PlayState?: JellyfinPlayState
    LastPlaybackCheckIn?: string
    [key: string]: unknown
}

export interface JellyfinClientOptions {
    /** Stable device identity sent in the Authorization header. Generated when omitted. */
    deviceId?: string
    /** Fetch implementation. Injected for tests; globalThis.fetch is resolved per call otherwise. */
    fetch?: typeof fetch
    /**
     * Per-request timeout in milliseconds (default 15000). Extension beyond the
     * shared connection contract, kept optional so existing callers are unaffected.
     */
    timeoutMs?: number
}

/**
 * Browser-direct, read-only Jellyfin protocol client. Every method performs at
 * most the documented requests (no retries, no refresh), never sends the access
 * token in a query string and never mutates watched/progress state.
 */
export interface JellyfinClient {
    getPublicInfo(signal?: AbortSignal): Promise<JellyfinSystemInfo>
    listPublicUsers(signal?: AbortSignal): Promise<JellyfinUser[]>
    signIn(username: string, password: string, signal?: AbortSignal): Promise<JellyfinSignIn>
    connectToken(accessToken: string, userId?: string, signal?: AbortSignal): Promise<JellyfinSignIn>
    listUsers(accessToken: string, signal?: AbortSignal): Promise<JellyfinUser[]>
    getUser(accessToken: string, userId: string, signal?: AbortSignal): Promise<JellyfinUser>
    inspect(accessToken: string, user: JellyfinUser, signal?: AbortSignal): Promise<JellyfinServerDetails>
    readItem(accessToken: string, userId: string, itemId: string, signal?: AbortSignal): Promise<JellyfinItem>
    readWatchItem(accessToken: string, userId: string, itemId: string, signal?: AbortSignal): Promise<JellyfinItem>
    readResume(accessToken: string, userId: string, signal?: AbortSignal): Promise<JellyfinItemResult>
    readPlayed(accessToken: string, userId: string, signal?: AbortSignal): Promise<JellyfinItemResult>
    readAllPlayed(accessToken: string, userId: string, options?: JellyfinPagedReadOptions, signal?: AbortSignal): Promise<JellyfinItemResult>
    readAllResume(accessToken: string, userId: string, options?: JellyfinPagedReadOptions, signal?: AbortSignal): Promise<JellyfinItemResult>
    readAllLibrary(accessToken: string, userId: string, options?: JellyfinPagedReadOptions, signal?: AbortSignal): Promise<JellyfinItemResult>
    queryUserItems(accessToken: string, userId: string, query: JellyfinItemQuery, signal?: AbortSignal): Promise<JellyfinItem[]>
    readSessions(accessToken: string, userId: string, signal?: AbortSignal): Promise<JellyfinSession[]>
}
