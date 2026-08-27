import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { useAccountStore, getStremioAuthKey } from './accountStore'
import type { AddonDescriptor } from '@/types/addon'
import { useAddonStore } from './addonStore'
import { useProfileStore } from './profileStore'
import { useFailoverStore } from './failoverStore'
import { useAuthStore } from './authStore'
import { useVaultStore } from './vaultStore'
import { toast } from '@/hooks/use-toast'
import { deriveSyncToken } from '@/lib/crypto'
import { resilientFetch } from '@/lib/api-resilience'
import { compressSyncPayload, decompressSyncPayload } from '@/lib/sync-payload-codec'
import { applySyncedSettings, readSyncedSettings } from '@/lib/synced-settings'
import { resolveRestoreSaltPolicy } from '@/lib/salt-policy'
import { serverHasStremioCredential, canonicalMembershipChanged } from '@/lib/canonical-visibility'
import {
    bindRepublishHost,
    learnServerCredentialedAccounts,
    adoptPushResponseCredentials,
    consumeForceFlag,
    resetRepublishAttempts,
    clearRepublishState,
} from '@/lib/canonical-republish'

export { learnServerCredentialedAccounts }
import { createSafeStorage } from './safe-storage'
import { wipeAllData } from '@/lib/storage-reset'
import { resetAllStores } from '@/lib/store-coordinator'
import { trace } from '@/lib/trace'

// Suppress toasts during initial boot to prevent React "state update on unmounted component" warnings
let _appReady = false
setTimeout(() => { _appReady = true }, 3000)

let _lastPushedHash: string | null = null
let _corruptRestoreInFlight = false

async function computeHash(data: string): Promise<string> {
    const encoded = new TextEncoder().encode(data)
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

let _pendingRetry = false
let _syncDebounceTimer: ReturnType<typeof setTimeout> | null = null
let _accountsHydrated = false
let _lastSyncedAccountCount: number | null = null
let _syncLock: Promise<void> | null = null

let _onlineHandler: (() => void) | null = null
let _syncBC: BroadcastChannel | null = null

async function acquireSyncLock(): Promise<() => void> {
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

export function markAccountsHydrated() {
    _accountsHydrated = true
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

function writeIdentityProfile(id: string, name: string, avatar: string | null): void {
    try { localStorage.setItem(IDENTITY_KEY, JSON.stringify({ id, name, avatar })) } catch {}
}

export interface SyncHistoryEntry {
    id: string
    timestamp: string
    type: 'push' | 'pull' | 'force-push' | 'force-mirror'
    status: 'success' | 'error'
    message: string
    isAuto: boolean
}

interface SyncState {
    auth: {
        id: string
        password: string
        name: string
        avatar: string | null
        isAuthenticated: boolean
    }
    serverUrl: string
    lastSyncedAt: string | null
    lastSyncCheckedAt: string | null
    isSyncing: boolean
    isRefreshingFromCloud: boolean  // true only during the post-unlock pull - separate from write syncs
    isInitialSyncCompleted: boolean // Safety flag to prevent stale devices from pushing before they've pulled
    lastActionTimestamp: number
    lastSeenVersion: string | null
    syncSaltB64: string | null
    lastSyncedCloudEtag: string | null
    serverStremioCredentialedAccounts: string[] | null
    history: SyncHistoryEntry[]
    setLastSeenVersion: (version: string) => void
    addLogEntry: (data: Omit<SyncHistoryEntry, 'id' | 'timestamp'>) => void
    register: (password: string, name?: string) => Promise<void>
    login: (id: string, password: string, isSilent?: boolean, bypassGuard?: boolean, deviceUnlock?: { syncKey: CryptoKey }) => Promise<void>
    logout: () => void
    syncToRemote: (isAuto?: boolean, isDebounced?: boolean, forceFull?: boolean) => Promise<boolean>
    syncFromRemote: (isSilent?: boolean) => Promise<void>
    refreshFromCloud: () => Promise<void>
    forcePushState: () => Promise<void>
    forceMirrorState: () => Promise<void>
    setServerUrl: (url: string) => void
    setDisplayName: (name: string) => void
    setAvatar: (avatar: string | null) => void
    deleteRemoteAccount: () => Promise<void>
    reset: () => void
}

const DEFAULT_SERVER = '/api'

const LEGACY_SYNC_PASSWORD_KEY = 'aioman-sync-password'

export function getSyncApiPath(serverUrl: string | undefined): string {
    const base = (serverUrl || DEFAULT_SERVER).trim().replace(/\/+$/, '')
    if (!base) return DEFAULT_SERVER
    if (!base.startsWith('http')) return base
    return base.endsWith('/api') ? base : `${base}/api`
}

const clearSyncCredentialCaches = () => {
    try { sessionStorage.removeItem(LEGACY_SYNC_PASSWORD_KEY) } catch (e) { if (import.meta.env.DEV) console.error(e) }
    import('@/lib/crypto').then(({ clearSyncKeyCache }) => clearSyncKeyCache()).catch(() => {})
}

async function isDeviceSessionActive(): Promise<boolean> {
    try {
        const { isDeviceAuthActive } = await import('@/lib/device-session')
        return isDeviceAuthActive()
    } catch {
        return false
    }
}

async function getActiveDeviceSyncKey(): Promise<CryptoKey | null> {
    try {
        const { getDeviceSyncKey } = await import('@/lib/device-session')
        return getDeviceSyncKey()
    } catch {
        return null
    }
}

async function deviceUnlockFromSession(): Promise<{ syncKey: CryptoKey } | undefined> {
    const syncKey = await getActiveDeviceSyncKey()
    return syncKey ? { syncKey } : undefined
}

export const useSyncStore = create<SyncState>()(
    persist(
        (set, get) => ({
            auth: {
                id: '',
                password: '',
                name: readIdentityProfile().name,
                avatar: readIdentityProfile().avatar,
                isAuthenticated: false
            },
            serverUrl: '',
            lastSyncedAt: null,
            lastSyncCheckedAt: null,
            isSyncing: false,
            isRefreshingFromCloud: false,
            isInitialSyncCompleted: false,
            lastActionTimestamp: 0,
            lastSeenVersion: null,
            syncSaltB64: null,
            lastSyncedCloudEtag: null,
            serverStremioCredentialedAccounts: null,
            history: [],

            setLastSeenVersion: (version: string) => {
                set({ lastSeenVersion: version })
            },

            addLogEntry: (data: Omit<SyncHistoryEntry, 'id' | 'timestamp'>) => {
                const entry: SyncHistoryEntry = {
                    ...data,
                    id: crypto.randomUUID(),
                    timestamp: new Date().toISOString()
                }
                set(state => ({
                    history: [entry, ...state.history].slice(0, 50)
                }))
            },

            setServerUrl: (url) => set({ serverUrl: url }),

            setDisplayName: (name) => {
                set((state) => ({
                    auth: { ...state.auth, name }
                }))
                writeIdentityProfile(get().auth.id, name, get().auth.avatar ?? null)
                get().syncToRemote(true).catch(e => { if (import.meta.env.DEV) console.error(e) })
            },

            setAvatar: (avatar) => {
                set((state) => ({
                    auth: { ...state.auth, avatar }
                }))
                writeIdentityProfile(get().auth.id, get().auth.name, avatar)
                get().syncToRemote(true).catch(e => { if (import.meta.env.DEV) console.error(e) })
            },

            syncFromRemote: async (isSilent: boolean = true) => {
                const { auth } = get()
                if (!auth.isAuthenticated) return
                if (!auth.password && !(await isDeviceSessionActive())) return
                await get().login(auth.id, auth.password, isSilent, undefined, await deviceUnlockFromSession())
            },

            /**
             * Post-unlock pull: fetches latest cloud state unconditionally.
             * Unlike syncFromRemote(), this bypasses the isSyncing guard because
             * isSyncing protects write/push operations, not read pulls.
             * Sets isRefreshingFromCloud for UI feedback.
             */
            refreshFromCloud: async () => {
                const { auth, isSyncing } = get()
                if (!auth.isAuthenticated || !auth.id) return
                if (!auth.password && !(await isDeviceSessionActive())) return
                if (isSyncing) return

                const releaseSyncLock = await acquireSyncLock()

                set({ isRefreshingFromCloud: true })
                try {
                    await get().login(auth.id, auth.password, true, true, await deviceUnlockFromSession())
                    set({ isInitialSyncCompleted: true })
                } catch (e) {
                    if (import.meta.env.DEV) console.error('[Sync] Post-unlock cloud refresh failed:', e)
                    const message = e instanceof Error ? e.message : 'Unknown sync error'
                    if (message.toLowerCase().includes('decrypt') || message.toLowerCase().includes('password')) {
                        toast({
                            variant: 'destructive',
                            title: 'Sync Error',
                            description: message
                        })
                    } else {
                        toast({
                            variant: 'destructive',
                            title: 'Refresh Failed',
                            description: 'Could not reach sync server. Using local data.'
                        })
                    }
                } finally {
                    set({ isRefreshingFromCloud: false })
                    releaseSyncLock()
                }
            },

            register: async (password: string, name: string = '') => {
                if (password.length < 8) {
                    throw new Error('Password must be at least 8 characters.')
                }

                const newId = crypto.randomUUID()
                const { serverUrl } = get()

                try {
                    const apiPath = getSyncApiPath(serverUrl)
                    const { generateSalt } = await import('@/lib/crypto')
                    const salt = generateSalt()
                    const saltBase64 = btoa(String.fromCharCode(...salt))
                    const syncSalt = crypto.getRandomValues(new Uint8Array(16))
                    const syncSaltB64 = btoa(String.fromCharCode(...syncSalt))

                    const emptyState = {
                        accounts: [],
                        addons: { version: '1.0', savedAddons: [] },
                        profiles: [],
                        failover: [],
                        vault: [],
                        vaultTombstones: [],
                        notes: [],
                        notesTrash: [],
                        watchEvents: [],
                        watchSnapshot: {},
                        watchEventRollups: { byMonth: {}, daysByAccount: {}, foldedThrough: {} },
                        deletedWatchEvents: {},
                        salt: saltBase64,
                        syncedAt: new Date().toISOString()
                    }
                    const syncToken = await deriveSyncToken(password)

                    const res = await resilientFetch(`${apiPath}/sync/${newId}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-sync-password': syncToken
                        },
                        body: JSON.stringify(emptyState)
                    })

                    if (!res.ok) throw new Error("Failed to register account on server.")

                    // Parity Fix: Also initialize the local Master Password using the same password.
                    // If this fails, do not continue into an authenticated-but-unusable session.
                    try {
                        await useAuthStore.getState().setupMasterPassword(password, salt, { resetSyncStore: false })
                    } catch (setupError) {
                        try {
                            const cleanupRes = await resilientFetch(`${apiPath}/sync/${newId}`, {
                                method: 'DELETE',
                                headers: { 'x-sync-password': syncToken }
                            })
                            if (!cleanupRes.ok) throw new Error(`cleanup failed (${cleanupRes.status})`)
                        } catch (cleanupError) {
                            if (import.meta.env.DEV) console.error("Failed to clean up incomplete sync registration:", cleanupError)
                            throw new Error(`Local session setup failed after account reservation. Save this UUID before retrying: ${newId}`)
                        }
                        throw setupError
                    }

                    writeIdentityProfile(newId, name, null)
                    set({
                        auth: { id: newId, password, name, avatar: null, isAuthenticated: true },
                        lastSyncedAt: new Date().toISOString(),
                        isInitialSyncCompleted: true,
                        syncSaltB64,
                    })

                    // Set flag to show post-login reminder (Since the registration dialog is hidden too fast)
                    localStorage.setItem('aiom_show_sync_id_reminder', 'true')
                    await get().syncToRemote(false)

                    toast({ title: "Account Created", description: "Welcome to AIOManager." })
                } catch (e) {
                    toast({ variant: "destructive", title: "Registration Failed", description: (e as Error).message })
                    throw e
                }
            },

            login: async (id: string, password: string, isSilent: boolean = false, bypassGuard: boolean = false, deviceUnlock?: { syncKey: CryptoKey }) => {
                if (get().isSyncing && !bypassGuard) return
                set({ isSyncing: true })
                const { serverUrl } = get()
                const apiPath = getSyncApiPath(serverUrl)
                const pullStart = Date.now()
                trace('sync', 'pull.start', { accountId: id, isSilent })

                try {
                    const pullHeaders: Record<string, string> = { 'x-sync-password': await deriveSyncToken(password) }
                    const storedEtag = get().lastSyncedCloudEtag
                    const sessionUnlocked = !!useAuthStore.getState().encryptionKey
                    if (storedEtag && sessionUnlocked) pullHeaders['If-None-Match'] = storedEtag

                    const res = await resilientFetch(`${apiPath}/sync/${id}`, {
                        headers: pullHeaders
                    })

                    if (res.status === 304) {
                        set({ isInitialSyncCompleted: true, lastSyncCheckedAt: new Date().toISOString() })
                        if (!useAccountStore.getState().hydrated) {
                            await useAccountStore.getState().initialize()
                        }
                        const { useWatchEventStore } = await import('@/store/watchEventStore')
                        if (!useWatchEventStore.getState().initialized) {
                            await useWatchEventStore.getState().load()
                        }
                        setTimeout(() => {
                            import('@/lib/activity-server').then(m => {
                                m.pushCredentialsToServer().catch(() => {})
                                m.fetchAndMergeServerEvents().catch(() => {})
                            }).catch(() => {})
                        }, 2000)
                        setTimeout(() => {
                            import('@/store/account/accountCanonical')
                                .then(({ reconcileInboundCanonical }) => reconcileInboundCanonical())
                                .then(changed => { if (changed) get().syncToRemote(true).catch(() => {}) })
                                .catch(() => {})
                        }, 2500)
                        get().addLogEntry({
                            type: 'pull',
                            status: 'success',
                            message: 'Cloud already up to date.',
                            isAuto: isSilent
                        })
                        trace('sync', 'pull.not_modified', { accountId: id, isSilent, timing: Date.now() - pullStart })
                        return
                    }

                    if (res.status === 401) {
                        let reason = ''
                        try {
                            const body = await res.json() as { reason?: unknown }
                            if (body && typeof body.reason === 'string') reason = body.reason
                        } catch {}
                        if (deviceUnlock && (reason === 'revoked' || reason === 'expired' || reason === 'generation')) {
                            throw Object.assign(new Error('Your remembered sign-in ended. Sign in again to continue.'), { reason })
                        }
                        if (deviceUnlock && reason === 'unknown') {
                            throw Object.assign(new Error('This device is no longer recognized. Sign in again to continue.'), { reason })
                        }
                        throw new Error("Incorrect Password. If you've forgotten it, you may need to reset your account.")
                    }
                    if (res.status === 404) throw new Error("Cloud Account not found. Check the ID or Register a new one.")
                    if (!res.ok) throw new Error(`Cloud Sync Server error (${res.status}). Try again later.`)

                    const text = await res.text()
                    const responseEtag = res.headers.get('etag')
                    if (!text || text.trim() === "") {
                        throw new Error("Server returned an empty response. Your data might not be initialized yet.")
                    }

                    if (text.includes('[object Object]')) {
                        if (import.meta.env.DEV) console.warn("[Sync] Server returned '[object Object]'. Treating as corrupted/empty.")
                        throw new Error("Server returned corrupted data ([object Object]). Reset your account.")
                    }

                    let data: unknown
                    try {
                        const raw = JSON.parse(text) as Record<string, unknown>
                        if (raw.isEncrypted && raw.data) {
                            const { decryptSyncPayload } = await import('@/lib/crypto')
                            let decryptedStr: string
                            let remoteSyncSalt: Uint8Array | undefined
                            if (raw.syncSalt && typeof raw.syncSalt === 'string') {
                                remoteSyncSalt = Uint8Array.from(atob(raw.syncSalt), c => c.charCodeAt(0))
                                if (!get().syncSaltB64) set({ syncSaltB64: raw.syncSalt })
                            }
                            try {
                                decryptedStr = deviceUnlock
                                    ? await import('@/lib/crypto').then(m => m.decryptSyncPayloadWithKey(raw.data as string, deviceUnlock.syncKey))
                                    : await decryptSyncPayload(raw.data as string, password, remoteSyncSalt)
                            } catch {
                                throw new Error("Decryption failed. Wrong password or corrupted cloud data.")
                            }

                            let payloadStr: string
                            try {
                                payloadStr = raw.compressed ? decompressSyncPayload(decryptedStr) : decryptedStr
                            } catch (decompressErr) {
                                if (import.meta.env.DEV) console.error('[Sync] Payload decompression failed — cloud copy is corrupt:', decompressErr)
                                const err = new Error('Cloud data is corrupted (stored payload cannot be decompressed). Sign in on a device that still has your data loaded and sync from there to repair the cloud copy.')
                                ;(err as Error & { corruptPayload?: boolean }).corruptPayload = true
                                throw err
                            }

                            try {
                                data = JSON.parse(payloadStr)

                                // Post-Parse Check: If it PARSED into a literal string "[object Object]", then it's bad.
                                // But if it's a valid object that happens to CONTAIN that string somewhere, we keep it.
                                if (data === '[object Object]') {
                                    if (import.meta.env.DEV) console.warn('[Sync] Decrypted data IS "[object Object]". Discarding.')
                                    data = {}
                                }
                            } catch (parseErr) {
                                if (import.meta.env.DEV) console.error('[Sync] Decrypted payload failed to parse — cloud copy is corrupt. Length:', decryptedStr.length)
                                const err = new Error('Cloud data is corrupted (stored payload is undecodable). Sign in on a device that still has your data loaded and sync from there to repair the cloud copy.')
                                ;(err as Error & { corruptPayload?: boolean }).corruptPayload = true
                                throw err
                            }
                        } else {
                            // Legacy: Plain text
                            data = raw
                        }
                        if (raw.syncedAt && data && typeof data === 'object' && !Array.isArray(data)) {
                            (data as Record<string, unknown>).syncedAt = raw.syncedAt
                        }

                        const d = (data || {}) as Record<string, unknown>
                        const dSettings = (d.settings || {}) as Record<string, unknown>
                        data = {
                            accounts: d.accounts ?? undefined,
                            addons: d.addons || { version: '1.0', savedAddons: [] },
                            profiles: Array.isArray(d.profiles) ? d.profiles : [],
                            failover: d.failover || [],
                            vault: Array.isArray(d.vault) ? d.vault : [],
                            vaultTombstones: Array.isArray(d.vaultTombstones) ? d.vaultTombstones : [],
                            notes: Array.isArray(d.notes) ? d.notes : [],
                            notesTrash: Array.isArray(d.notesTrash) ? d.notesTrash : [],
                            salt: d.salt,
                            name: d.name,
                            syncedAt: d.syncedAt,
                            lastSeenVersion: d.lastSeenVersion || null,
                            settings: d.settings ? {
                                ...dSettings,
                                changelog: dSettings.changelog || []
                            } : { changelog: [] },
                            changelog: Array.isArray(d.changelog) ? d.changelog : [],
                            customThemes: Array.isArray(d.customThemes) ? d.customThemes : [],
                            watchEvents: Array.isArray(d.watchEvents) ? d.watchEvents : [],
                            watchSnapshot: d.watchSnapshot || {},
                            watchEventRollups: (d.watchEventRollups && typeof d.watchEventRollups === 'object') ? d.watchEventRollups : undefined,
                            deletedWatchEvents: (d.deletedWatchEvents && typeof d.deletedWatchEvents === 'object') ? d.deletedWatchEvents : {},
                            apiKeys: d.apiKeys,
                            accountStates: d.accountStates,
                            discoverFavorites: d.discoverFavorites,
                            discoverPrefs: d.discoverPrefs,
                        }

                    } catch (e) {
                        if (import.meta.env.DEV) console.error("[Sync] Decryption/Parsing Error:", e)
                        if ((e as Error & { corruptPayload?: boolean })?.corruptPayload) {
                            throw e
                        }
                        // If it's a JSON parse error (likely from getting HTML instead of JSON), show a better message
                        if (e instanceof SyntaxError) {
                            throw new Error("Invalid server response. Make sure the backend is running correctly.")
                        }
                        throw new Error("Failed to decrypt cloud data. Verify your password.")
                    }

                    // This ensures we can still decrypt local account authKeys for reconciliation
                    // even if the cloud salt differs from the local salt.
                    let preUnlockEncryptionKey = useAuthStore.getState().encryptionKey

                    // If no in-memory key (fresh page load / re-login after corruption),
                    // try to derive one from the local salt + password so we can still
                    // decrypt existing local account authKeys during reconciliation.
                    // Remembered sessions already carry the key; nothing to derive.
                    if (!preUnlockEncryptionKey && !deviceUnlock) {
                        const { loadSalt, deriveKey } = await import('@/lib/crypto')
                        const localSalt = loadSalt()
                        if (localSalt) {
                            try {
                                preUnlockEncryptionKey = await deriveKey(password, localSalt)
                                if (import.meta.env.DEV) console.log('[Sync] Derived pre-unlock key from local salt for reconciliation')
                            } catch (e) {
                                if (import.meta.env.DEV) console.warn('[Sync] Could not derive pre-unlock key from local salt:', e)
                            }
                        }
                    }

                    const cloudSalt = (data as Record<string, unknown>)?.salt as string | undefined
                    let localSaltBase64: string | undefined
                    {
                        const { loadSalt } = await import('@/lib/crypto')
                        const localSalt = loadSalt()
                        if (localSalt) localSaltBase64 = btoa(String.fromCharCode(...localSalt))
                    }
                    const norm = data as Record<string, unknown>
                    const hasEncryptedData =
                        (Array.isArray(norm.accounts) && norm.accounts.length > 0) ||
                        (Array.isArray(norm.vault) && norm.vault.length > 0)
                    const saltPolicy = resolveRestoreSaltPolicy({ cloudSalt, localSalt: localSaltBase64, hasEncryptedData })

                    if (saltPolicy.refuse) {
                        if (bypassGuard) {
                            console.warn('[Sync] No encryption salt recoverable. Generating fresh salt for cloud recovery.')
                        } else {
                            throw new Error("Encryption metadata is missing from this account's cloud backup. Sign in once from the device or browser where you created it to finish setup.")
                        }
                    }

                    let unlockOk = false
                    if (deviceUnlock) {
                        // Remembered session: the vault key was unwrapped locally and injected
                        // before this pull; unlockFromSync would need the password.
                        unlockOk = !!useAuthStore.getState().encryptionKey
                        if (!unlockOk && !isSilent) {
                            throw new Error('Remembered sign-in could not unlock the vault. Sign in again.')
                        }
                    } else {
                        try {
                            const allowGen = saltPolicy.allowGenerate || (saltPolicy.refuse && bypassGuard)
                            await useAuthStore.getState().unlockFromSync(password, saltPolicy.saltToUse, { allowGenerate: allowGen })
                            unlockOk = true
                        } catch (e) {
                            if (import.meta.env.DEV) console.error("Failed to restore session from sync:", e)
                            if (!isSilent) {
                                throw new Error("Could not sign in with this password. (Encryption Mismatch)")
                            }
                            // Silent path: don't attempt data import without an encryption key
                        }
                    }

                    // Guard: skip all encrypted store operations if unlock failed
                    if (!unlockOk) {
                        if (import.meta.env.DEV) console.warn('[Sync] Skipping data import - encryption key not available.')
                        return
                    }
                    const syncData = data as Record<string, unknown>
                    const localLastSync = get().lastSyncedAt
                    const remoteLastSync = syncData.syncedAt as string | undefined

                    const remoteTime = remoteLastSync ? new Date(remoteLastSync).getTime() : 0
                    const localTime = localLastSync ? new Date(localLastSync).getTime() : 0

                    const isLocalNewer = localTime > remoteTime
                    const isRemoteNewer = remoteTime > localTime
                    const isEqual = remoteTime === localTime

                    let decision = 'passive merge'

                    if (syncData.accounts) {
                        const localAccounts = useAccountStore.getState().accounts
                        const remoteAccountsRaw = Array.isArray(syncData.accounts) ? syncData.accounts : (syncData.accounts as Record<string, unknown> | undefined)?.accounts || []
                        const remoteAccounts = remoteAccountsRaw as Record<string, unknown>[]
                        _lastSyncedAccountCount = remoteAccounts.length

                        const hasRemoteData = remoteAccounts.length > 0
                        const hasLocalData = localAccounts.length > 0

                        if (!hasRemoteData && hasLocalData) {
                            decision = 'Seed Cloud (local data exists, cloud is empty)'
                            await useAccountStore.getState().importAccounts(JSON.stringify(syncData), true, 'merge', preUnlockEncryptionKey)
                            setTimeout(() => get().syncToRemote(true), 1500)
                        } else if (hasRemoteData) {
                            if (isRemoteNewer) {
                                decision = 'Adopt Remote (cloud is newer, replace local)'
                                await useAccountStore.getState().importAccounts(JSON.stringify(syncData), true, 'mirror', preUnlockEncryptionKey)
                            } else {
                                decision = 'Merge (equal or local-newer timestamps)'
                                await useAccountStore.getState().importAccounts(JSON.stringify(syncData), true, 'merge', preUnlockEncryptionKey)
                            }
                        }
                    }

                    if (syncData.addons) {
                        const localAddons = Object.keys(useAddonStore.getState().library).length
                        const remoteAddons = Array.isArray(syncData.addons) ? syncData.addons : ((syncData.addons as Record<string, unknown>)?.savedAddons || []) as unknown[]

                        if ((!remoteAddons || remoteAddons.length === 0) && localAddons > 0) {
                            if (import.meta.env.DEV) console.warn(`[Sync] Remote has 0 addons (Safety net triggered). Switching to MERGE + PUSH.`)
                            await useAddonStore.getState().importLibrary(syncData, true, false, true)
                            setTimeout(() => get().syncToRemote(true), 1500)
                        } else if (isLocalNewer) {
                            if (import.meta.env.DEV) console.log("[Sync] Local addons are fresher. Merging & Pushing.")
                            await useAddonStore.getState().importLibrary(syncData, true, false, true)
                            setTimeout(() => get().syncToRemote(true), 2000)
                        } else if (isEqual) {
                            if (import.meta.env.DEV) console.log("[Sync] Addons synchronized. Passive import.")
                            await useAddonStore.getState().importLibrary(syncData, true, true, true)
                        } else {
                            await useAddonStore.getState().importLibrary(syncData, false, true, true)
                        }
                        await useAddonStore.getState().initialize()
                    }
                    if (syncData.profiles && Array.isArray(syncData.profiles)) {
                        await useProfileStore.getState().importProfiles(syncData.profiles)
                    }
                    if (syncData.failover) {
                        const fo = syncData.failover as Record<string, unknown>
                        if (Array.isArray(syncData.failover)) {
                            await useFailoverStore.getState().importRules(syncData.failover, 'merge', true)
                        } else if (typeof syncData.failover === 'object') {
                            if (fo.rules) await useFailoverStore.getState().importRules(fo.rules, 'merge', true)
                            if (fo.webhook) {
                                await useFailoverStore.getState().importWebhook(fo.webhook as import('./failoverStore').WebhookConfig, true)
                            }
                        }
                    }

                    if (syncData.notes && Array.isArray(syncData.notes)) {
                        const { useNotesStore } = await import('@/store/notesStore')
                        await useNotesStore.getState().importNotes(syncData.notes)
                        if (Array.isArray(syncData.notesTrash)) {
                            await useNotesStore.getState().importTrash(syncData.notesTrash)
                        }
                    }
                    if (Array.isArray(syncData.vault) || Array.isArray(syncData.vaultTombstones)) {
                        const { useVaultStore } = await import('./vaultStore')
                        await useVaultStore.getState().initialize()
                        await useVaultStore.getState().importVault((syncData.vault || []) as import('@/types/vault').VaultKey[], (syncData.vaultTombstones || []) as import('./vaultStore').VaultTombstone[])
                    }

                    if (syncData.settings) {
                        applySyncedSettings(syncData.settings as Record<string, unknown>, !isLocalNewer)
                    }

                    {
                        const { useWatchEventStore } = await import('@/store/watchEventStore')
                        const local = useWatchEventStore.getState()
                        const remoteEvents: Record<string, unknown>[] = Array.isArray(syncData.watchEvents) ? syncData.watchEvents as Record<string, unknown>[] : []
                        const remoteDeleted = (syncData.deletedWatchEvents && typeof syncData.deletedWatchEvents === 'object') ? syncData.deletedWatchEvents as Record<string, number> : {}
                        const mergedDeleted: Record<string, number> = { ...local.deletedEventKeys }
                        for (const [k, ts] of Object.entries(remoteDeleted)) {
                            if (!(k in mergedDeleted) || ts > mergedDeleted[k]) mergedDeleted[k] = ts
                        }
                        const merged = new Map<string, Record<string, unknown>>()
                        ;[...remoteEvents, ...local.events as unknown as Record<string, unknown>[]].forEach(e => merged.set(e.id as string, e))
                        const mergedEvents = Array.from(merged.values())
                            .sort((a, b) => (b.event_ts as number) - (a.event_ts as number))
                        const mergedSnapshot = { ...(syncData.watchSnapshot || {} as Record<string, unknown>), ...local.snapshot }
                        const remoteRollups = (syncData.watchEventRollups && typeof syncData.watchEventRollups === 'object')
                            ? syncData.watchEventRollups as import('@/lib/watch-event-rollups').EventRollups
                            : undefined
                        useWatchEventStore.getState().initialize(mergedEvents as unknown as import('@/types/activity').WatchEvent[], mergedSnapshot as Record<string, Record<string, import('@/types/activity').SnapshotItem>>, mergedDeleted, remoteRollups)
                    }

                    if (Array.isArray(syncData.customThemes) && syncData.customThemes.length > 0) {
                        applySyncedSettings({ customThemes: syncData.customThemes }, true)
                    }

                    if (Array.isArray(syncData.discoverFavorites)) {
                        try { localStorage.setItem('aio-discover-favorites', JSON.stringify(syncData.discoverFavorites)) } catch {}
                    }

                    if (syncData.discoverPrefs && typeof syncData.discoverPrefs === 'object') {
                        try { localStorage.setItem('aio-discover-prefs', JSON.stringify(syncData.discoverPrefs)) } catch {}
                    }

                    // Identity is upgrade-only on pull: an empty name/avatar in the cloud
                    // (a stale push from another device) can never erase what this device has.
                    // The local fallback only applies to the SAME account (no cross-account bleed).
                    const localAuth = get().auth
                    const profile = readIdentityProfile()
                    const sameAccount = profile.id === id
                    const fallbackName = sameAccount ? (localAuth.name || profile.name) : ''
                    const fallbackAvatar = sameAccount ? (localAuth.avatar ?? profile.avatar) : null
                    const restoredName = (syncData.name as string) || fallbackName
                    const restoredAvatar = (typeof syncData.avatar === 'string' && syncData.avatar) ? syncData.avatar : fallbackAvatar
                    writeIdentityProfile(id, restoredName, restoredAvatar)
                    set({
                        auth: {
                            id,
                            password,
                            name: restoredName,
                            avatar: restoredAvatar,
                            isAuthenticated: true
                        },
                        lastSyncedAt: (syncData.syncedAt as string) || new Date().toISOString(),
                        lastSyncCheckedAt: new Date().toISOString(),
                        lastSeenVersion: (syncData.lastSeenVersion as string | null) || get().lastSeenVersion,
                        isInitialSyncCompleted: true,
                        lastSyncedCloudEtag: responseEtag ?? null
                    })

                    // Heal a salt-less cloud record only with a definitively-correct salt (a freshly
                    // minted one for an empty account). A device-local fallback for a record that has
                    // data is left for a normal sync to push, so a foreign salt can't corrupt the record.
                    if (saltPolicy.backfill) {
                        setTimeout(() => get().syncToRemote(true), 1500)
                    }

                    get().addLogEntry({
                        type: 'pull',
                        status: 'success',
                        message: `Fetched cloud state. Decision: ${decision}`,
                        isAuto: isSilent
                    })
                    trace('sync', 'pull.success', { accountId: id, isSilent, decision, timing: Date.now() - pullStart })

                    if (!isSilent) {
                        toast({ title: "Login Successful", description: "Data loaded." })
                    }

                    setTimeout(() => {
                        import('@/lib/activity-server').then(async m => {
                            try { await m.pushCredentialsToServer() } catch (e) {
                                const msg = (e as Error).message
                                get().addLogEntry({ type: 'push', status: 'error', message: `Credential push failed: ${msg}`, isAuto: true })
                                console.warn('[Sync] Credential push failed:', e)
                            }
                            m.fetchAndMergeServerEvents().catch(e => {
                                const msg = (e as Error).message
                                get().addLogEntry({ type: 'pull', status: 'error', message: `Server event fetch failed: ${msg}`, isAuto: true })
                                console.warn('[Sync] Server event fetch failed:', e)
                            })
                        }).catch(e => {
                            const msg = (e as Error).message
                            get().addLogEntry({ type: 'push', status: 'error', message: `Activity server import failed: ${msg}`, isAuto: true })
                            console.warn('[Sync] Activity server import failed:', e)
                        })
                    }, 2000)

                    // App-open: fold in any inbound canonical writes (AIOStreams) that landed
                    // while this client was away, then push if a Hub actually changed. Without
                    // a local change to trigger a push, this is what reflects inbound writes.
                    setTimeout(() => {
                        import('@/store/account/accountCanonical')
                            .then(({ reconcileInboundCanonical }) => reconcileInboundCanonical())
                            .then(changed => { if (changed) get().syncToRemote(true) })
                            .catch(() => {})
                    }, 2500)
                } catch (e) {
                    if ((e as Error & { corruptPayload?: boolean })?.corruptPayload && !_corruptRestoreInFlight) {
                        try {
                            const restoreRes = await resilientFetch(`${apiPath}/sync/${id}/restore`, {
                                method: 'POST',
                                headers: { 'x-sync-password': await deriveSyncToken(password) },
                                timeout: 15000,
                            })
                            if (restoreRes.ok) {
                                trace('sync', 'pull.corrupt-restored', { accountId: id })
                                _corruptRestoreInFlight = true
                                try {
                                    return await get().login(id, password, isSilent, bypassGuard, deviceUnlock)
                                } finally {
                                    _corruptRestoreInFlight = false
                                }
                            }
                        } catch (restoreErr) {
                            if (import.meta.env.DEV) console.warn('[Sync] Cloud restore attempt failed:', restoreErr)
                        }
                    }
                    const msg = (e as Error).message
                        ; get().addLogEntry({
                            type: 'pull',
                            status: 'error',
                            message: `Pull Failed: ${msg}`,
                            isAuto: isSilent
                        })
                    trace('sync', 'pull.error', { accountId: id, isSilent, error: msg, timing: Date.now() - pullStart })
                    if (!isSilent) {
                        toast({ variant: "destructive", title: "Login Failed", description: msg })
                    }
                    throw e
                } finally {
                    set({ isSyncing: false })
                }
            },

            logout: async () => {
                if (get().auth.isAuthenticated && get().isInitialSyncCompleted) {
                    // An in-flight push IS pushing the latest state; wiping while it runs
                    // races the serializer against the store reset. Wait it out first.
                    const syncDeadline = Date.now() + 20000
                    while (get().isSyncing && Date.now() < syncDeadline) {
                        await new Promise(r => setTimeout(r, 200))
                    }
                    let pushOk: boolean | undefined
                    try {
                        pushOk = await Promise.race([
                            get().syncToRemote(false, false),
                            new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 20000))
                        ])
                    } catch {}
                    if (pushOk === false || pushOk === undefined) {
                        toast({
                            variant: 'destructive',
                            title: 'Sign-out cancelled',
                            description: 'Your latest data could not be confirmed pushed to the cloud (a sync may still be running), and signing out erases the local copy. Retry in a moment, or export a backup from Settings → Data & Sync first.'
                        })
                        get().addLogEntry({
                            type: 'push',
                            status: 'error',
                            message: 'Sign-out aborted: pre-logout push did not complete (local data preserved).',
                            isAuto: false
                        })
                        return
                    }
                }

                _lastPushedHash = null
                _pendingRetry = false
                _accountsHydrated = false
                if (_syncDebounceTimer) { clearTimeout(_syncDebounceTimer); _syncDebounceTimer = null }
                if (_onlineHandler) { window.removeEventListener('online', _onlineHandler); _onlineHandler = null }
                if (_syncBC) { _syncBC.close(); _syncBC = null }
                clearSyncCredentialCaches()
                import('@/lib/device-session').then(({ deactivateDeviceAuth }) => deactivateDeviceAuth()).catch(() => {})
                import('@/lib/canonical-base').then(({ clearCanonicalBases }) => clearCanonicalBases()).catch(() => {})
                import('@/lib/pmdb-list-publisher').then(({ _invalidateAuthCache }) => _invalidateAuthCache()).catch(() => {})
                import('@/api/hydra-providers').then(({ _clearCanonicalCache }) => _clearCanonicalCache()).catch(() => {})
                set({
                    // Profile (name + avatar) survives sign-out on purpose: the login screen's
                    // Continue strip and avatar are driven from it, like every keep-me-signed-in app.
                    auth: { id: '', password: '', name: get().auth.name, avatar: get().auth.avatar, isAuthenticated: false },
                    lastSyncedAt: null,
                    lastSyncCheckedAt: null,
                    isInitialSyncCompleted: false,
                    lastSyncedCloudEtag: null,
                    serverStremioCredentialedAccounts: null
                })
                _lastSyncedAccountCount = null
                clearRepublishState()

                const { useWatchEventStore } = await import('@/store/watchEventStore')
                await useWatchEventStore.getState().reset()
                await wipeAllData()
                await resetAllStores({ includeSync: false })

                toast({ title: "Logged Out", description: "See you next time." })
            },

            syncToRemote: async (isAuto: boolean = false, isDebounced: boolean = false, forceFull: boolean = false): Promise<boolean> => {
                if (!useAccountStore.getState().hydrated) {
                    await useAccountStore.getState().initialize()
                }
                const { auth, serverUrl, isSyncing, isInitialSyncCompleted } = get()
                const { isLocked } = useAuthStore.getState()
                const hasSessionCredentials = !!auth.password || (await isDeviceSessionActive())
                if (!auth.isAuthenticated || isSyncing || isLocked || !useAccountStore.getState().hydrated || !hasSessionCredentials) {
                    const reason = !auth.isAuthenticated ? 'not signed in' : isSyncing ? 'a sync is in progress' : isLocked ? 'vault is locked' : !hasSessionCredentials ? 'no in-session credentials' : 'account state not hydrated'
                    if (!isAuto) {
                        get().addLogEntry({ type: 'push', status: 'error', message: `Push skipped: ${reason}.`, isAuto: false })
                        trace('sync', 'push.guard-reject', { accountId: auth.id, reason })
                    }
                    return false
                }

                if (!useAccountStore.getState().hydrated) {
                    if (import.meta.env.DEV) console.log("[Sync] Skipping push: account store not hydrated yet")
                    return false
                }

                const { useWatchEventStore } = await import('@/store/watchEventStore')
                if (!useWatchEventStore.getState().initialized) {
                    await useWatchEventStore.getState().load()
                    if (!useWatchEventStore.getState().initialized) {
                        if (isAuto) {
                            if (import.meta.env.DEV) console.log("[Sync] Skipping auto-push: Waiting for watch history hydration")
                            return false
                        }
                        await get().refreshFromCloud()
                        if (!useWatchEventStore.getState().initialized) {
                            if (!isAuto) get().addLogEntry({ type: 'push', status: 'error', message: 'Push skipped: watch history could not be loaded.', isAuto: false })
                            trace('sync', 'push.guard-reject', { accountId: auth.id, reason: 'watch-store-unhydrated' })
                            return false
                        }
                    }
                }

                // SAFETY LOCK: If we haven't successfully synced FROM the cloud yet,
                // we are NOT allowed to sync TO the cloud. This prevents stale clients
                // from overwriting the source of truth with their old local state.
                if (isAuto && (!_accountsHydrated || !isInitialSyncCompleted)) {
                    if (import.meta.env.DEV) console.log("[Sync] Skipping auto-push: Waiting for hydration and initial pull")
                    return false
                }

                set({ isSyncing: true })

                // Server Protection: Strict Debounce check for auto-syncs
                // Instead of dropping, we defer the sync so the *last* change always pushes
                if (isAuto) {
                    if (_syncDebounceTimer) clearTimeout(_syncDebounceTimer)
                    _syncDebounceTimer = setTimeout(() => {
                        _syncDebounceTimer = null
                        get().syncToRemote(false, true)
                    }, 1500)
                    set({ isSyncing: false })
                    return false
                }

                set({ lastActionTimestamp: Date.now() })

                // Fold inbound canonical-store writes (e.g. AIOStreams) into non-Stremio
                // Hubs before we build the push body, so the blob + canonical both reflect
                // the three-way merge. The client is the single merger (D2). isSyncing is
                // already true here, so this cannot re-enter syncToRemote; best-effort, so
                // a failure never blocks the push.
                try {
                    const { reconcileInboundCanonical } = await import('@/store/account/accountCanonical')
                    await reconcileInboundCanonical()
                } catch (e) { if (import.meta.env.DEV) console.error('[Sync] Inbound canonical reconcile failed:', e) }

                const releaseSyncLock = await acquireSyncLock()

                const apiPath = getSyncApiPath(serverUrl)
                const pushStart = Date.now()
                let forceCanonicalRepublish = false

                try {
                    trace('sync', 'push.start', { accountId: auth.id, isAuto })
                    const { loadSalt } = await import('@/lib/crypto')
                    const salt = loadSalt()
                    const saltBase64 = salt ? btoa(String.fromCharCode(...salt)) : undefined

                    const exportedAccounts = await useAccountStore.getState().exportAccountsForSync()
                    const rawAddons = useAddonStore.getState().exportLibrary(true)

                    const safeParse = (val: unknown): Record<string, unknown> => {
                        if (!val) return {}
                        if (typeof val === 'object') return val as Record<string, unknown>
                        if (typeof val === 'string') {
                            if ((val as string).includes('[object Object]')) {
                                if (import.meta.env.DEV) console.warn(`[Sync] Discarding corrupted data checking for [object Object]`)
                                return {}
                            }
                            try {
                                return JSON.parse(val as string) as Record<string, unknown>
                            } catch (e) {
                                if (import.meta.env.DEV) console.error(`[Sync] Failed to parse exported data:`, val.substring(0, 50))
                                return {}
                            }
                        }
                        return {}
                    }

                    const accountCount = Array.isArray(exportedAccounts.accounts) ? exportedAccounts.accounts.length : 0
                    const { shouldBlockEmptyAccountPush } = await import('@/lib/sync-guards')
                    if (shouldBlockEmptyAccountPush({
                        currentAccountCount: accountCount,
                        lastSyncedAccountCount: _lastSyncedAccountCount,
                        isManualPush: !isAuto && !isDebounced,
                    })) {
                        trace('sync', 'push.blocked-empty-accounts', { accountId: auth.id, lastSyncedAccountCount: _lastSyncedAccountCount })
                        console.warn('[Sync] Blocked automatic push of 0 accounts (data-loss guard, issue #34). If you intentionally deleted all accounts, use a manual sync to force it.')
                        throw new Error('Blocked push of 0 accounts: local state contradicts the last synced cloud copy. Restore accounts or trigger a manual sync to force-push.')
                    }
                    if (useVaultStore.getState().isLocked && useAuthStore.getState().encryptionKey) {
                        await useVaultStore.getState().initialize()
                    }
                    const watchExport = useWatchEventStore.getState().export()
                    const state = {
                        ...exportedAccounts,
                        addons: safeParse(rawAddons),
                        failover: {
                            rules: useFailoverStore.getState().rules,
                            webhook: useFailoverStore.getState().webhook
                        },
                        vault: useVaultStore.getState().keys,
                        vaultTombstones: useVaultStore.getState().tombstones,
                        notes: await (await import('@/store/notesStore')).useNotesStore.getState().getAllNotesWithContent(),
                        notesTrash: (await import('@/store/notesStore')).useNotesStore.getState().trash,
                        watchEvents: watchExport.events,
                        watchSnapshot: watchExport.snapshot,
                        watchEventRollups: watchExport.rollups,
                        deletedWatchEvents: watchExport.deletedEvents,
                        salt: saltBase64,
                        name: auth.name,
                        avatar: auth.avatar ?? null,
                        lastSeenVersion: get().lastSeenVersion,
                        customThemes: (() => { try { return JSON.parse(localStorage.getItem('aio-custom-themes') || '[]') } catch { return [] } })(),
                        discoverFavorites: (() => { try { return JSON.parse(localStorage.getItem('aio-discover-favorites') || '[]') } catch { return [] } })(),
                        discoverPrefs: (() => { try { return JSON.parse(localStorage.getItem('aio-discover-prefs') || '{}') } catch { return {} } })(),
                        profiles: useProfileStore.getState().profiles,
                        settings: readSyncedSettings(),
                    }

                    const { encryptSyncPayload } = await import('@/lib/crypto')
                    const stringifiedState = JSON.stringify(state)

                    if (stringifiedState === '[object Object]') {
                        throw new Error('Sync corruption detected: State is not an object.')
                    }

                    const payloadBytes = new TextEncoder().encode(stringifiedState).length
                    if (payloadBytes > 100 * 1024 * 1024) {
                        const mb = (payloadBytes / 1024 / 1024).toFixed(1)
                        console.error(`[Sync] Payload is ${mb}MB - exceeds safe threshold (100MB). Aborting push.`)
                        throw new Error(`Sync payload too large (${mb}MB). Remove some accounts or data.`)
                    }

                    forceCanonicalRepublish = consumeForceFlag()
                    const stateHash = await computeHash(stringifiedState)
                    if (!forceCanonicalRepublish && !forceFull && _lastPushedHash !== null && stateHash === _lastPushedHash) {
                        trace('sync', 'push.skip-unchanged', { accountId: auth.id, isAuto })
                        if (!isAuto && !isDebounced) {
                            get().addLogEntry({ type: 'push', status: 'success', message: 'No local changes to push - checking cloud.', isAuto: false })
                            setTimeout(() => { get().syncFromRemote(true).catch(() => {}) }, 0)
                        }
                        return true
                    }

                    const syncedAtJson = JSON.stringify(new Date().toISOString())
                    const stampedState = stringifiedState === '{}'
                        ? `{"syncedAt":${syncedAtJson}}`
                        : `${stringifiedState.slice(0, -1)},"syncedAt":${syncedAtJson}}`

                    const { syncSaltB64 } = get()
                    const syncSalt = syncSaltB64 ? Uint8Array.from(atob(syncSaltB64), c => c.charCodeAt(0)) : undefined
                    const shouldCompress = stampedState.length > 51200
                    let compressedPayload: string = stampedState
                    let isCompressed = false
                    if (shouldCompress) {
                        try {
                            compressedPayload = compressSyncPayload(stampedState)
                            isCompressed = true
                        } catch {}
                    }
                    let encryptedState: string
                    if (auth.password) {
                        encryptedState = await encryptSyncPayload(compressedPayload, auth.password, syncSalt)
                    } else {
                        const deviceSyncKey = await getActiveDeviceSyncKey()
                        if (!deviceSyncKey) throw new Error('Remembered session lost its sync key. Sign in again.')
                        encryptedState = await import('@/lib/crypto').then(m => m.encryptSyncPayloadWithKey(compressedPayload, deviceSyncKey))
                    }

                    // Canonical addon lists for accounts the server can't read itself. A
                    // server-side Stremio credential (serverStremioCredentialedAccounts, learned
                    // from push/canonical responses) means the server reads Stremio directly;
                    // a client-side-only key does NOT — assuming it does strands the account
                    // in a server-side canonical island. Null = never learned: legacy
                    // assumption. Captured to become the merge base on a CONFIRMED push.
                    const knownServerAccounts = get().serverStremioCredentialedAccounts
                    const { isFoldedHub, clearFoldedHub } = await import('@/lib/folded-hubs')
                    const emptiedHubs: string[] = []
                    const canonicalPayload = useAccountStore.getState().accounts.reduce<Record<string, AddonDescriptor[]>>((map, a) => {
                        if (!serverHasStremioCredential(a.id, knownServerAccounts, !!getStremioAuthKey(a))) {
                            map[a.id] = a.addons || []
                            if (map[a.id].length === 0 && isFoldedHub(a.id)) emptiedHubs.push(a.id)
                        }
                        return map
                    }, {})

                    const res = await resilientFetch(`${apiPath}/sync/${auth.id}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-sync-password': await deriveSyncToken(auth.password)
                        },
                        body: JSON.stringify({
                            data: encryptedState,
                            isEncrypted: true,
                            compressed: isCompressed,
                            syncSalt: syncSaltB64,
                            syncedAt: get().lastSyncedAt,
                            // Hash of the logical state (pre-syncedAt); lets the server skip the
                            // archive/rewrite/apiKeys churn when the content is byte-identical
                            // to what it already holds, since the envelope hash is IV-random.
                            contentHint: (forceCanonicalRepublish || forceFull) ? undefined : stateHash,
                            apiKeys: useAccountStore.getState().accounts.reduce<Record<string, string>>((map, a) => {
                                if (a.apiKey) map[a.id] = a.apiKey
                                return map
                            }, {}),
                            canonicalAddons: canonicalPayload,
                            emptiedHubs,
                        })
                    })

                    if (res.status === 401) {
                        const profile = readIdentityProfile()
                        set({ auth: { id: '', password: '', name: profile.name, avatar: profile.avatar, isAuthenticated: false }, isInitialSyncCompleted: false })
                        clearSyncCredentialCaches()
                        import('@/lib/device-session').then(({ deactivateDeviceAuth }) => deactivateDeviceAuth()).catch(() => {})
                        throw new Error('Sync session expired')
                    }

                    if (res.status === 413) {
                        throw new Error('Sync data was too large for the server to accept (413). If AIOManager sits behind nginx, raise client_max_body_size in its config. Your data is safe locally and will push once the limit is raised.')
                    }

                    if (!res.ok) {
                        const errorData = await res.text().then(t => { try { return JSON.parse(t) } catch { return {} } }).catch(() => ({}))
                        throw new Error(errorData.message || `Server Error: ${res.status}`)
                    }

                    const resData = await res.text().then(t => { try { return JSON.parse(t) } catch { return {} } })

                    if (resData.conflict) {
                        if (import.meta.env.DEV) console.log('[Sync] Server reported conflict. Triggering pull.')
                        import('@/hooks/use-toast').then(({ toast }) => {
                            toast({
                                variant: 'warning',
                                title: 'Cloud was newer',
                                description: 'Your changes were not pushed because another device synced more recently. Pulling the newer state now.',
                            })
                        }).catch(() => {})
                        get().refreshFromCloud().catch(e => { if (import.meta.env.DEV) console.error(e) })
                        return false
                    }

                    _lastPushedHash = stateHash
                    _lastSyncedAccountCount = accountCount
                    import('@/store/account/accountImportExport').then(({ setLastPushedAt }) => setLastPushedAt(Date.now())).catch(() => {})
                    if (typeof resData.contentHash === 'string') {
                        set({ lastSyncedCloudEtag: resData.contentHash })
                    }
                    adoptPushResponseCredentials(forceCanonicalRepublish, resData.serverStremioCredentialedAccounts)
                    for (const hubId of emptiedHubs) clearFoldedHub(hubId)

                    // Advance the merge base ONLY on a confirmed push; base is "what the
                    // server confirmed it received," never "what we hoped to send." If the
                    // push had failed, leaving the base stale would make the next merge
                    // mistake a just-deleted addon for an inbound add and resurrect it.
                    import('@/lib/canonical-base')
                        .then(({ setCanonicalBases }) => setCanonicalBases(canonicalPayload))
                        .catch(() => {})

                    // TRUST THE SERVER CLOCK (Fixes Clock Drift)
                    // If server returns a timestamp, use it. Fallback to local only if missing.
                    const serverTime = resData.syncedAt
                    if (serverTime) {
                        set({ lastSyncedAt: serverTime })
                        if (import.meta.env.DEV) console.log(`[Sync] Synced with server clock: ${serverTime}`)
                    } else {
                        set({ lastSyncedAt: new Date().toISOString() })
                    }

                    get().addLogEntry({
                        type: 'push',
                        status: 'success',
                        message: 'Sync successful',
                        isAuto
                    })
                    trace('sync', 'push.success', { accountId: auth.id, isAuto, bytes: payloadBytes, compressed: isCompressed, timing: Date.now() - pushStart })
                    _pendingRetry = false
                    resetRepublishAttempts()

                    try {
                        const bc = new BroadcastChannel('aio-sync')
                        bc.postMessage({ type: 'sync-complete', timestamp: Date.now() })
                        bc.close()
                    } catch (e) { if (import.meta.env.DEV) console.error(e) }
                    return true
                } catch (e) {
                    const message = (e as Error).message
                    if (import.meta.env.DEV) console.error("Sync error:", apiPath, e)
                    if (isAuto) _pendingRetry = true
                    get().addLogEntry({
                            type: 'push',
                            status: 'error',
                            message: `Push Failed: ${message}`,
                            isAuto
                        })
                    trace('sync', 'push.error', { accountId: auth.id, isAuto, error: message, timing: Date.now() - pushStart })
                    if (!isAuto && !isDebounced && _appReady) {
                        toast({ variant: "destructive", title: "Save Failed", description: message })
                    }
                    return false
                } finally {
                    set({ isSyncing: false })
                    releaseSyncLock()
                }
            },

            forcePushState: async () => {
                const { auth } = get()
                if (!auth.isAuthenticated) {
                    get().addLogEntry({ type: 'force-push', status: 'error', message: 'Force push failed: not signed in.', isAuto: false })
                    return
                }

                const deadline = Date.now() + 20000
                while (get().isSyncing && Date.now() < deadline) {
                    await new Promise(r => setTimeout(r, 200))
                }
                if (get().isSyncing) {
                    get().addLogEntry({ type: 'force-push', status: 'error', message: 'Force push cancelled: another sync stayed in progress for 20s.', isAuto: false })
                    return
                }

                const ok = await get().syncToRemote(false, false, true)
                get().addLogEntry({
                    type: 'force-push',
                    status: ok ? 'success' : 'error',
                    message: ok ? 'Force push completed.' : 'Force push failed — check the push error entry above for the reason.',
                    isAuto: false
                })
            },

            forceMirrorState: async () => {
                const { auth, serverUrl } = get()
                if (!auth.isAuthenticated) return
                if (!auth.password && !(await isDeviceSessionActive())) return
                set({ isSyncing: true })

                const apiPath = getSyncApiPath(serverUrl)

                try {
                    const res = await resilientFetch(`${apiPath}/sync/${auth.id}`, {
                        headers: { 'x-sync-password': await deriveSyncToken(auth.password) }
                    })

                    if (!res.ok) throw new Error(`Cloud Sync Server error (${res.status})`)

                    const text = await res.text()
                    let data: Record<string, unknown>
                    const raw = JSON.parse(text) as Record<string, unknown>

                    if (raw.isEncrypted && raw.data) {
                        const { decryptSyncPayload: decryptPayload } = await import('@/lib/crypto')
                        const remoteSyncSalt = raw.syncSalt && typeof raw.syncSalt === 'string'
                            ? Uint8Array.from(atob(raw.syncSalt), c => c.charCodeAt(0))
                            : undefined
                        let decryptedStr: string
                        if (auth.password) {
                            decryptedStr = await decryptPayload(raw.data as string, auth.password, remoteSyncSalt)
                        } else {
                            const deviceSyncKey = await getActiveDeviceSyncKey()
                            if (!deviceSyncKey) throw new Error('Remembered session lost its sync key. Sign in again.')
                            decryptedStr = await import('@/lib/crypto').then(m => m.decryptSyncPayloadWithKey(raw.data as string, deviceSyncKey))
                        }
                        const payloadStr = raw.compressed ? decompressSyncPayload(decryptedStr) : decryptedStr
                        data = JSON.parse(payloadStr) as Record<string, unknown>
                    } else {
                        data = raw
                    }

                    if (data.accounts) {
                        await useAccountStore.getState().importAccounts(JSON.stringify(data), true, 'mirror')
                    }
                    if (data.addons) {
                        await useAddonStore.getState().importLibrary(data, false, true)
                        await useAddonStore.getState().initialize()
                    }
                    if (data.profiles && Array.isArray(data.profiles)) {
                        await useProfileStore.getState().importProfiles(data.profiles)
                    }
                    if (data.failover) {
                        const strategy = 'mirror'
                        if (Array.isArray(data.failover)) {
                            await useFailoverStore.getState().importRules(data.failover, strategy, true)
                        } else if (typeof data.failover === 'object') {
                            const fo = data.failover as Record<string, unknown>
                            if (fo.rules) await useFailoverStore.getState().importRules(fo.rules, strategy, true)
                            if (fo.webhook) await useFailoverStore.getState().importWebhook(fo.webhook as import('./failoverStore').WebhookConfig, true)
                        }
                    }
                    if (data.settings) {
                        applySyncedSettings(data.settings as Record<string, unknown>, true)
                    }
                    if (data.notes && Array.isArray(data.notes)) {
                        const { useNotesStore } = await import('@/store/notesStore')
                        await useNotesStore.getState().importNotes(data.notes)
                    }
                    if (Array.isArray(data.vault) || Array.isArray(data.vaultTombstones)) {
                        await useVaultStore.getState().initialize()
                        await useVaultStore.getState().importVault((data.vault || []) as import('@/types/vault').VaultKey[], (data.vaultTombstones || []) as import('./vaultStore').VaultTombstone[])
                    }
                    if (Array.isArray(data.watchEvents)) {
                        const { useWatchEventStore } = await import('@/store/watchEventStore')
                        const local = useWatchEventStore.getState()
                        const remoteDeleted = (data.deletedWatchEvents && typeof data.deletedWatchEvents === 'object') ? data.deletedWatchEvents as Record<string, number> : {}
                        const mergedDeleted: Record<string, number> = { ...local.deletedEventKeys }
                        for (const [k, ts] of Object.entries(remoteDeleted)) {
                            if (!(k in mergedDeleted) || ts > mergedDeleted[k]) mergedDeleted[k] = ts
                        }
                        const merged = new Map<string, Record<string, unknown>>()
                        ;[...(data.watchEvents as Record<string, unknown>[]), ...local.events as unknown as Record<string, unknown>[]].forEach(e => merged.set(e.id as string, e))
                        const mergedEvents = Array.from(merged.values()).sort((a, b) => (b.event_ts as number) - (a.event_ts as number))
                        const mergedSnapshot = { ...((data.watchSnapshot || {}) as Record<string, unknown>), ...local.snapshot }
                        useWatchEventStore.getState().initialize(mergedEvents as unknown as import('@/types/activity').WatchEvent[], mergedSnapshot as Record<string, Record<string, import('@/types/activity').SnapshotItem>>, mergedDeleted)
                    }
                    if (Array.isArray(data.customThemes) && data.customThemes.length > 0) {
                        applySyncedSettings({ customThemes: data.customThemes }, true)
                    }
                    if (Array.isArray(data.discoverFavorites)) {
                        try { localStorage.setItem('aio-discover-favorites', JSON.stringify(data.discoverFavorites)) } catch {}
                    }
                    if (data.discoverPrefs && typeof data.discoverPrefs === 'object') {
                        try { localStorage.setItem('aio-discover-prefs', JSON.stringify(data.discoverPrefs)) } catch {}
                    }
                    if (Array.isArray(data.notesTrash)) {
                        const { useNotesStore } = await import('@/store/notesStore')
                        await useNotesStore.getState().importTrash(data.notesTrash)
                    }
                    if (data.lastSeenVersion) {
                        set({ lastSeenVersion: data.lastSeenVersion as string | null })
                    }

                    set({ lastSyncedAt: (data.syncedAt as string) || new Date().toISOString() })

                        ; get().addLogEntry({
                            type: 'force-mirror',
                            status: 'success',
                            message: 'Cloud state mirrored verbatim (bypassed merge)',
                            isAuto: false
                        })

                    toast({ title: "Mirror Complete", description: "Local state replaced by cloud data." })
                } catch (e) {
                    const msg = (e as Error).message
                    toast({ variant: "destructive", title: "Mirror Failed", description: msg })
                        ; get().addLogEntry({
                            type: 'force-mirror',
                            status: 'error',
                            message: `Mirror Failed: ${msg}`,
                            isAuto: false
                        })
                } finally {
                    set({ isSyncing: false })
                }
            },




            deleteRemoteAccount: async () => {
                const { auth, serverUrl } = get()
                if (!auth.isAuthenticated) return
                const apiPath = getSyncApiPath(serverUrl)
                const start = Date.now()
                trace('sync', 'delete.start', { accountId: auth.id })

                try {
                    const res = await resilientFetch(`${apiPath}/sync/${auth.id}`, {
                        method: 'DELETE',
                        headers: { 'x-sync-password': await deriveSyncToken(auth.password) }
                    })

                    if (!res.ok) throw new Error("Failed to delete account from server")
                    trace('sync', 'delete.success', { accountId: auth.id, timing: Date.now() - start })
                    get().logout()
                } catch (e) {
                    trace('sync', 'delete.error', { accountId: auth.id, error: (e as Error)?.message, timing: Date.now() - start })
                    throw e
                }
            },

            reset: () => {
                _accountsHydrated = false
                set({
                    auth: { id: '', password: '', name: '', avatar: null, isAuthenticated: false },
                    serverUrl: '',
                    lastSyncedAt: null,
                    lastSyncCheckedAt: null,
                    isSyncing: false,
                    isRefreshingFromCloud: false,
                    lastActionTimestamp: 0,
                    isInitialSyncCompleted: false,
                    lastSyncedCloudEtag: null,
                    serverStremioCredentialedAccounts: null
                })
                clearRepublishState()
            }
        }),
        {
            name: 'aioman-sync',
            storage: createSafeStorage(),
            partialize: (state) => ({
                auth: {
                    id: state.auth.id,
                    name: state.auth.name,
                    avatar: state.auth.avatar,
                    isAuthenticated: state.auth.isAuthenticated,
                    password: '',
                },
                lastSyncedAt: state.lastSyncedAt,
                serverUrl: state.serverUrl,
                lastActionTimestamp: state.lastActionTimestamp,
                lastSeenVersion: state.lastSeenVersion,
                syncSaltB64: state.syncSaltB64,
                lastSyncedCloudEtag: state.lastSyncedCloudEtag,
                serverStremioCredentialedAccounts: state.serverStremioCredentialedAccounts,
            }),
            merge: (persistedState, currentState) => ({
                ...currentState,
                ...(persistedState as Partial<SyncState>),
                isSyncing: false,
                isRefreshingFromCloud: false,
                isInitialSyncCompleted: false,
            }),
        }
    )
)

if (typeof window !== 'undefined') {
    // Migration: stop storing the raw password (pre-remembered-device sessions).
    try { sessionStorage.removeItem(LEGACY_SYNC_PASSWORD_KEY) } catch {}
    localStorage.removeItem('aio-pending-sync')

    import('@/lib/device-session').then(({ reactivateDeviceSessionIfNeeded }) => reactivateDeviceSessionIfNeeded()).catch(() => {})

    _onlineHandler = () => {
        if (_pendingRetry) {
            _pendingRetry = false
            useSyncStore.getState().syncToRemote(true).catch(() => {})
        }
    }
    window.addEventListener('online', _onlineHandler)

    try {
        _syncBC = new BroadcastChannel('aio-sync')
        _syncBC.onmessage = (event) => {
            if (event.data?.type === 'sync-complete') {
                const state = useSyncStore.getState()
                if (!state.auth.isAuthenticated) return
                const lastSync = state.lastSyncedAt
                if (lastSync && Date.now() - new Date(lastSync).getTime() < 30_000) return
                state.syncFromRemote(true).catch(e => { if (import.meta.env.DEV) console.error(e) })
            }
        }
    } catch (e) { if (import.meta.env.DEV) console.error(e) }
}

bindRepublishHost({
    isAuthenticated: () => useSyncStore.getState().auth.isAuthenticated,
    runRepublish: () => useSyncStore.getState().syncToRemote(false, true),
    getPrevSet: () => useSyncStore.getState().serverStremioCredentialedAccounts,
    setPrevSet: next => useSyncStore.setState({ serverStremioCredentialedAccounts: next }),
    membershipChanged: (prev, next) => canonicalMembershipChanged(useAccountStore.getState().accounts, a => !!getStremioAuthKey(a), prev, next),
    schedule: (fn, delayMs) => setTimeout(fn, delayMs),
    cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
})
