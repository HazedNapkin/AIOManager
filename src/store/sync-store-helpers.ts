import { clearSessionSyncToken } from '@/lib/session-sync-token'

// Shared mutable sync runtime state. Lives here so the store and any extracted
// sync modules mutate one instance instead of reaching across modules.
// Cloud-side watch-event tombstones as of the last pull. The push serialisation merges local
// stale local map can never erase fresher cloud deletes.
export const syncRuntime = {
    appReady: false,
    lastPushedHash: null as string | null,
    corruptRestoreInFlight: false,
    lastPulledDeletedWatchEvents: null as Record<string, number> | null,
    lastPulledNotesTrash: null as import('./notesStore').Note[] | null,
    lastPulledVaultTombstones: null as import('./vaultStore').VaultTombstone[] | null,
    pendingRetry: false,
    syncDebounceTimer: null as ReturnType<typeof setTimeout> | null,
    lastSyncedAccountCount: null as number | null,
    onlineHandler: null as (() => void) | null,
    syncBC: null as BroadcastChannel | null,
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
