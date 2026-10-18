// Platform derivation for addon surfaces. An account's addon collection lives on every
// platform the account is connected to, so the source set is derived from its connections.
// This says nothing about any individual addon being verified as installed: the details
// surface describes sync targets and their last synced state, never confirmed presence.
// Kept dependency-free (no runtime imports) so node --test can run it directly.

export interface PlatformSourceConnection {
    platform: string
    connectionType?: string
    driverType?: string
    enabled?: boolean
    status?: PlatformSyncStatus
    lastSync?: number | Date | string
    lastError?: string
}

export type PlatformSyncStatus = 'active' | 'expired' | 'error' | 'degraded' | 'pending'

export interface PlatformSourceAccount {
    authKey?: string
    status?: 'active' | 'error' | 'expired'
    lastSync?: number | Date | string
    connections?: PlatformSourceConnection[]
}

// Hydra connections key on an app-specific platform slug; the source is Hydra itself, so
// they resolve to the same registry id as the other platforms.
function connectionPlatform(conn: PlatformSourceConnection): string {
    return (conn.connectionType || conn.driverType) === 'hydra-outbound' ? 'hydra-outbound' : conn.platform
}

// Ordered unique platform ids the addon collection lives on. Paused connections still
// count as sources: pausing sync never removes existing addons, so the collection keeps
// living on the platform. the chip's details say the sync is paused. A legacy Stremio
// session (authKey) only implies Stremio when NO explicit native Stremio connection
// exists; a paused explicit connection must not be resurrected as an active implicit one.
export function addonPlatformSources(account: PlatformSourceAccount | null | undefined): string[] {
    if (!account) return []
    const sources: string[] = []
    let hasExplicitStremio = false
    for (const conn of account.connections || []) {
        const platform = connectionPlatform(conn)
        if (platform === 'stremio') hasExplicitStremio = true
        if (!sources.includes(platform)) sources.push(platform)
    }
    if (!hasExplicitStremio && account.authKey && !sources.includes('stremio')) sources.push('stremio')
    return sources
}

// One detail row per enabled sync target, for the chip's accessible details popover.
// `implicit` marks the legacy Stremio session derived from the authKey; its state comes
// from the account itself because there is no Connection record to read.
export interface PlatformSyncTarget {
    platform: string
    implicit: boolean
    status: PlatformSyncStatus
    // ms epoch of the last successful sync; null = never synced (presence unverified).
    lastSync: number | null
    lastError?: string
    // Set by aggregation only: how many accounts contribute an enabled connection here.
    accountCount?: number
}

export interface AccountSyncTargets {
    targets: PlatformSyncTarget[]
    // Platforms whose connections are all switched off. Sync is paused there; existing
    // installations are unchanged and will not receive updates until re-enabled.
    paused: string[]
}

// Persisted JSON reloads can turn Date fields into ISO strings; accept all three shapes.
function toMs(value: number | Date | string | undefined | null): number | null {
    if (value === undefined || value === null) return null
    let ms: number
    if (typeof value === 'number') ms = value
    else if (typeof value === 'string') ms = Date.parse(value)
    else ms = value.getTime()
    return Number.isFinite(ms) && ms > 0 ? ms : null
}

// Honesty-first ordering: a failing or stale connection outranks a healthy-looking one.
const STATUS_RANK: Record<PlatformSyncStatus, number> = {
    expired: 0,
    error: 1,
    degraded: 2,
    pending: 3,
    active: 4,
}

function worstStatus(a: PlatformSyncStatus, b: PlatformSyncStatus): PlatformSyncStatus {
    return STATUS_RANK[a] <= STATUS_RANK[b] ? a : b
}

// Merge two same-platform targets: keep the freshest sync data, surface the worst status,
// and carry the lastError that BELONGS to that worst status, so a failing connection's
// reason is never dropped when a newer healthy connection wins the timestamp.
function mergeTargets(a: PlatformSyncTarget, b: PlatformSyncTarget): PlatformSyncTarget {
    const fresher = (b.lastSync ?? -1) > (a.lastSync ?? -1) ? b : a
    const worst = worstStatus(a.status, b.status)
    const errorCarrier =
        STATUS_RANK[a.status] < STATUS_RANK[b.status] ? a
        : STATUS_RANK[b.status] < STATUS_RANK[a.status] ? b
        : a.lastError ? a
        : b
    return { ...fresher, status: worst, lastError: errorCarrier.lastError }
}

export function accountSyncTargets(account: PlatformSourceAccount | null | undefined): AccountSyncTargets {
    if (!account) return { targets: [], paused: [] }
    const byPlatform = new Map<string, PlatformSyncTarget>()
    const pausedCandidates = new Set<string>()
    const enabledPlatforms = new Set<string>()
    let hasExplicitStremio = false

    for (const conn of account.connections || []) {
        const platform = connectionPlatform(conn)
        if (platform === 'stremio') hasExplicitStremio = true
        if (conn.enabled === false) {
            // A paused connection is not a sync target while paused, but the platform
            // keeps its existing addons. remember it so the details can say so.
            pausedCandidates.add(platform)
            continue
        }
        enabledPlatforms.add(platform)
        const target: PlatformSyncTarget = {
            platform,
            implicit: false,
            status: conn.status || 'pending',
            lastSync: toMs(conn.lastSync),
            lastError: conn.lastError,
        }
        const existing = byPlatform.get(platform)
        byPlatform.set(platform, existing ? mergeTargets(existing, target) : target)
    }

    // The legacy session only implies Stremio when no explicit native Stremio connection
    // exists at all (enabled or paused).
    if (!hasExplicitStremio && account.authKey) {
        byPlatform.set('stremio', {
            platform: 'stremio',
            implicit: true,
            status: account.status === 'expired' ? 'expired' : account.status === 'error' ? 'error' : 'active',
            lastSync: toMs(account.lastSync),
        })
    }

    // Coherence: a platform with both enabled and paused connections is actively syncing;
    // report it as paused only when every connection for it is paused.
    const paused = Array.from(pausedCandidates).filter(platform => !enabledPlatforms.has(platform))
    return { targets: Array.from(byPlatform.values()), paused }
}

export interface PlatformSourceSummary {
    // Union of platforms the collections live on, in first-seen order.
    platforms: string[]
    // Per-platform merged sync target state across all accounts.
    targets: PlatformSyncTarget[]
    // Platforms paused on every account that has them (not actively synced anywhere).
    paused: string[]
}

// Aggregate the sync-target state of several accounts. e.g. every account whose recorded
// list contains one saved addon. Per platform: freshest last sync as the base, the worst
// status (with its own lastError) so failures stay visible, and how many accounts
// contribute an enabled connection.
export function aggregatePlatformSources(accounts: Array<PlatformSourceAccount | null | undefined>): PlatformSourceSummary {
    const platforms: string[] = []
    const byPlatform = new Map<string, PlatformSyncTarget>()
    const counts = new Map<string, number>()
    const pausedCandidates = new Set<string>()

    for (const account of accounts) {
        if (!account) continue
        for (const platform of addonPlatformSources(account)) {
            if (!platforms.includes(platform)) platforms.push(platform)
        }
        const { targets, paused } = accountSyncTargets(account)
        for (const target of targets) {
            counts.set(target.platform, (counts.get(target.platform) || 0) + 1)
            const existing = byPlatform.get(target.platform)
            byPlatform.set(target.platform, existing ? mergeTargets(existing, target) : { ...target })
        }
        for (const platform of paused) pausedCandidates.add(platform)
    }

    // Coherence: a platform any account actively syncs is not paused overall.
    for (const platform of byPlatform.keys()) pausedCandidates.delete(platform)

    return {
        platforms,
        targets: Array.from(byPlatform.entries()).map(([platform, target]) => ({
            ...target,
            platform,
            accountCount: counts.get(platform) || 1,
        })),
        paused: Array.from(pausedCandidates),
    }
}
