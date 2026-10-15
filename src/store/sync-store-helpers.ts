import { clearSessionSyncToken } from '@/lib/session-sync-token'
import { getActiveWorkspaceId } from '@/lib/workspace-persistence'

// Shared mutable sync runtime state. Lives here so the store and any extracted
// sync modules mutate one instance instead of reaching across modules.
// Cloud-side watch-event tombstones as of the last pull. The push serialisation merges local
// stale local map can never erase fresher cloud deletes.
export const syncRuntime = {
    appReady: false,
    lastPushedHash: null as string | null,
    corruptRestoreInFlight: false,
    // Bumped at the start of every login pull and every mirror. Async
    // continuations (deferred hydration, completion flips) capture their token
    // and stand down when a newer pull, logout or workspace switch has
    // superseded them. Monotonic: it never moves backwards.
    pullSeq: 0,
    // Explicit adoption slot: a no-op conditional (304) refresh that invalidated
    // a still-applying pull of the same account may re-arm that pull here
    // instead of superseding it. Ownership checks accept the adopted sequence so
    // the pending work can finish, while pullSeq itself never rewinds (no other
    // stale actor can revive). Cleared on every real supersession.
    adoptedSeq: null as number | null,
    // Outcome of the newest pull's deferred hydration: 'pending' while slices
    // apply, 'ok' once every slice and blob landed, 'failed' otherwise. The 304
    // shortcut consults it: "unchanged" can only certify state that was fully
    // applied, never a pull still running or one that broke midway. The kind
    // separates pull records (adoptable by a 304) from mirror records (never).
    hydration: null as { seq: number; id: string; status: 'pending' | 'ok' | 'failed'; kind: 'pull' | 'mirror' } | null,
    lastPulledDeletedWatchEvents: null as Record<string, number> | null,
    lastPulledNotesTrash: null as import('./notesStore').Note[] | null,
    // Last cloud-known notes (with content). A page that has not imported notes yet
    // (boot into the anon namespace, then an identity swap) must never push an empty
    // store over this copy: same rationale as the empty-accounts push guard.
    lastPulledNotes: null as import('./notesStore').Note[] | null,
    lastPulledVaultTombstones: null as import('./vaultStore').VaultTombstone[] | null,
    // Preserved on push when this device has no avatar; mirrors the pull's upgrade-only identity rule.
    lastPulledCloudAvatar: null as string | null,
    pendingRetry: false,
    syncDebounceTimer: null as ReturnType<typeof setTimeout> | null,
    lastSyncedAccountCount: null as number | null,
    onlineHandler: null as (() => void) | null,
    syncBC: null as BroadcastChannel | null,
}

// Thrown by an ownership context's assert(): the pull or import that captured the
// context was superseded by a logout, reset, or a newer session before it finished.
// Detected by name so callers can single it out without importing the class.
export class SyncOwnershipLostError extends Error {
    constructor(
        public readonly expectedWorkspace: string,
        public readonly expectedSeq: number,
        public readonly activeWorkspace: string,
        public readonly activeSeq: number,
    ) {
        super(`Sync ownership lost: expected workspace ${expectedWorkspace} @ ${expectedSeq}, active is ${activeWorkspace} @ ${activeSeq}`)
        this.name = 'SyncOwnershipLostError'
    }
}

export interface SyncOwnership {
    readonly workspace: string
    readonly seq: number
    current: () => boolean
    assert: () => void
}

// Ownership context for one sync pull (or one standalone import): captures the
// active workspace AND the pull sequence at capture time, before the first await.
// Both must still match for the work to write or publish, so a same-id
// logout/relogin (identical workspace string, new sequence) invalidates the old
// work exactly like a real workspace switch does. A sequence recorded in the
// explicit adoption slot stays valid too: that is how a 304 re-arms a pending
// pull without rewinding the global counter. capture/assert are cheap
// synchronous reads; call assert again after every await that precedes a storage
// dispatch or a state publication.
export function captureSyncOwnership(seq: number = syncRuntime.pullSeq): SyncOwnership {
    const workspace = getActiveWorkspaceId()
    const current = () =>
        getActiveWorkspaceId() === workspace &&
        (syncRuntime.pullSeq === seq || syncRuntime.adoptedSeq === seq)
    const assert = () => {
        if (!current()) {
            throw new SyncOwnershipLostError(workspace, seq, getActiveWorkspaceId(), syncRuntime.pullSeq)
        }
    }
    return { workspace, seq, current, assert }
}

export async function computeHash(data: string): Promise<string> {
    const encoded = new TextEncoder().encode(data)
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

let _syncLock: Promise<void> | null = null

export async function acquireSyncLock(): Promise<() => void> {
    while (_syncLock) {
        await _syncLock
    }
    let resolve!: () => void
    _syncLock = new Promise<void>(r => { resolve = r })
    let released = false
    return () => {
        if (released) return
        released = true
        _syncLock = null
        resolve()
    }
}

let _accountsHydrated = false

export function markAccountsHydrated() {
    _accountsHydrated = true
}

export function resetAccountsHydration() {
    _accountsHydrated = false
}

export function isAccountsHydrationComplete() {
    return _accountsHydrated
}

// Identity profile lives outside the churnable auth object: session resets, 401 wipes and
// expiry paths must never erase the user's chosen name or avatar. The id stamp scopes the
// local fallback to the owning account so identities never bleed across accounts.
const IDENTITY_KEY = 'aio-identity-v1'

export function readIdentityProfile(): { id: string | null; name: string; avatar: string | null } {
    try {
        const raw = JSON.parse(localStorage.getItem(IDENTITY_KEY) || '{}') as { id?: unknown; name?: unknown; avatar?: unknown }
        return {
            id: typeof raw.id === 'string' && raw.id ? raw.id : null,
            name: typeof raw.name === 'string' ? raw.name : '',
            avatar: typeof raw.avatar === 'string' && raw.avatar ? raw.avatar : null,
        }
    } catch {
        return { id: null, name: '', avatar: null }
    }
}

export function writeIdentityProfile(id: string, name: string, avatar: string | null): void {
    try { localStorage.setItem(IDENTITY_KEY, JSON.stringify({ id, name, avatar })) } catch {}
}

// Upgrade-only identity resolution: a non-empty cloud value wins, otherwise the same-account
// local fallback applies. An empty cloud value can never erase what this device has.
export function resolveCloudIdentity(
    cloud: Record<string, unknown>,
    accountId: string,
    localAuth: { name: string; avatar: string | null },
): { name: string; avatar: string | null } {
    const profile = readIdentityProfile()
    const sameAccount = profile.id === accountId
    const fallbackName = sameAccount ? (localAuth.name || profile.name) : ''
    const fallbackAvatar = sameAccount ? (localAuth.avatar ?? profile.avatar) : null
    const name = (typeof cloud.name === 'string' && cloud.name) ? cloud.name : fallbackName
    const avatar = (typeof cloud.avatar === 'string' && cloud.avatar) ? cloud.avatar : fallbackAvatar
    return { name, avatar }
}

export const LEGACY_SYNC_PASSWORD_KEY = 'aioman-sync-password'

const DEFAULT_SERVER = '/api'

export function getSyncApiPath(serverUrl: string | undefined): string {
    const base = (serverUrl || DEFAULT_SERVER).trim().replace(/\/+$/, '')
    if (!base) return DEFAULT_SERVER
    if (!base.startsWith('http')) return base
    return base.endsWith('/api') ? base : `${base}/api`
}

export const clearSyncCredentialCaches = () => {
    try { sessionStorage.removeItem(LEGACY_SYNC_PASSWORD_KEY) } catch (e) { if (import.meta.env.DEV) console.error(e) }
    clearSessionSyncToken()
    import('@/lib/crypto').then(({ clearSyncKeyCache }) => clearSyncKeyCache()).catch(() => {})
}

export async function isDeviceSessionActive(): Promise<boolean> {
    try {
        const { isDeviceAuthActive } = await import('@/lib/device-session')
        return isDeviceAuthActive()
    } catch {
        return false
    }
}

export async function getActiveDeviceSyncKey(): Promise<CryptoKey | null> {
    try {
        const { getDeviceSyncKey } = await import('@/lib/device-session')
        return getDeviceSyncKey()
    } catch {
        return null
    }
}

export async function deviceUnlockFromSession(): Promise<{ syncKey: CryptoKey } | undefined> {
    const syncKey = await getActiveDeviceSyncKey()
    return syncKey ? { syncKey } : undefined
}
