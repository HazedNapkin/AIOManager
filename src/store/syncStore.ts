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
import { deflateSync, strToU8 } from 'fflate'
import { deriveSyncToken } from '@/lib/crypto'
import { resilientFetch } from '@/lib/api-resilience'
import { decompressSyncPayload } from '@/lib/utils'
import { applySyncedSettings } from '@/lib/synced-settings'
import { resolveRestoreSaltPolicy } from '@/lib/salt-policy'
import { createSafeStorage } from './safe-storage'
import { wipeAllData } from '@/lib/storage-reset'
import { resetAllStores } from '@/lib/store-coordinator'
import { trace } from '@/lib/trace'

// Suppress toasts during initial boot to prevent React "state update on unmounted component" warnings
let _appReady = false
setTimeout(() => { _appReady = true }, 3000)

let _lastPushedHash: string | null = null

async function computeHash(data: string): Promise<string> {
    const encoded = new TextEncoder().encode(data)
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function compressSyncPayload(jsonStr: string): string {
    const bytes = deflateSync(strToU8(jsonStr))
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
}
let _pendingRetry = false
let _syncDebounceTimer: ReturnType<typeof setTimeout> | null = null
let _accountsHydrated = false
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
        isAuthenticated: boolean
    }
    serverUrl: string
    lastSyncedAt: string | null
    isSyncing: boolean
    isRefreshingFromCloud: boolean  // true only during the post-unlock pull - separate from write syncs
    isInitialSyncCompleted: boolean // Safety flag to prevent stale devices from pushing before they've pulled
    lastActionTimestamp: number
    lastSeenVersion: string | null
    syncSaltB64: string | null
    history: SyncHistoryEntry[]
    setLastSeenVersion: (version: string) => void
    addLogEntry: (data: Omit<SyncHistoryEntry, 'id' | 'timestamp'>) => void
    register: (password: string, name?: string) => Promise<void>
    login: (id: string, password: string, isSilent?: boolean, bypassGuard?: boolean) => Promise<void>
    logout: () => void
    syncToRemote: (isAuto?: boolean, isDebounced?: boolean) => Promise<void>
    syncFromRemote: (isSilent?: boolean) => Promise<void>
    refreshFromCloud: () => Promise<void>
    forcePushState: () => Promise<void>
    forceMirrorState: () => Promise<void>
    setServerUrl: (url: string) => void
    setDisplayName: (name: string) => void
    deleteRemoteAccount: () => Promise<void>
    reset: () => void
}

const DEFAULT_SERVER = '/api'

    const SYNC_PASSWORD_KEY = 'aioman-sync-password'

function getSyncApiPath(serverUrl: string | undefined): string {
    const base = (serverUrl || DEFAULT_SERVER).trim().replace(/\/+$/, '')
    if (!base) return DEFAULT_SERVER
    if (!base.startsWith('http')) return base
    return base.endsWith('/api') ? base : `${base}/api`
}

export const savePasswordToSession = (password: string) => {
    try { sessionStorage.setItem(SYNC_PASSWORD_KEY, password) } catch (e) { if (import.meta.env.DEV) console.error(e) }
}

const loadPasswordFromSession = (): string => {
    try { return sessionStorage.getItem(SYNC_PASSWORD_KEY) || '' } catch (e) { if (import.meta.env.DEV) console.error(e); return '' }
}

const clearPasswordFromSession = () => {
    try { sessionStorage.removeItem(SYNC_PASSWORD_KEY) } catch (e) { if (import.meta.env.DEV) console.error(e) }
}

export const useSyncStore = create<SyncState>()(
    persist(
        (set, get) => ({
            auth: {
                id: '',
                password: '',
                name: '',
                isAuthenticated: false
            },
            serverUrl: '',
            lastSyncedAt: null,
            isSyncing: false,
            isRefreshingFromCloud: false,
            isInitialSyncCompleted: false,
            lastActionTimestamp: 0,
            lastSeenVersion: null,
            syncSaltB64: null,
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
                get().syncToRemote(true).catch(e => { if (import.meta.env.DEV) console.error(e) })
            },

            syncFromRemote: async (isSilent: boolean = true) => {
                const { auth } = get()
                if (!auth.isAuthenticated) return
                await get().login(auth.id, auth.password, isSilent)
            },

            /**
             * Post-unlock pull: fetches latest cloud state unconditionally.
             * Unlike syncFromRemote(), this bypasses the isSyncing guard because
             * isSyncing protects write/push operations, not read pulls.
             * Sets isRefreshingFromCloud for UI feedback.
             */
            refreshFromCloud: async () => {
                const { auth, isSyncing } = get()
                if (!auth.isAuthenticated || !auth.id || !auth.password) return
                if (isSyncing) return

                const releaseSyncLock = await acquireSyncLock()

                set({ isRefreshingFromCloud: true })
                try {
                    await get().login(auth.id, auth.password, true, true)
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

                    savePasswordToSession(password)
                    set({
                        auth: { id: newId, password, name, isAuthenticated: true },
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

            login: async (id: string, password: string, isSilent: boolean = false, bypassGuard: boolean = false) => {
                if (get().isSyncing && !bypassGuard) return
                set({ isSyncing: true })
                const { serverUrl } = get()
                const apiPath = getSyncApiPath(serverUrl)
                const pullStart = Date.now()
                trace('sync', 'pull.start', { accountId: id, isSilent })

                try {
                    const res = await resilientFetch(`${apiPath}/sync/${id}`, {
                        headers: { 'x-sync-password': await deriveSyncToken(password) }
                    })

                    if (res.status === 401) throw new Error("Incorrect Password. If you've forgotten it, you may need to reset your account.")
                    if (res.status === 404) throw new Error("Cloud Account not found. Check the ID or Register a new one.")
                    if (!res.ok) throw new Error(`Cloud Sync Server error (${res.status}). Try again later.`)

                    const text = await res.text()
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
                                decryptedStr = await decryptSyncPayload(raw.data as string, password, remoteSyncSalt)
                            } catch {
                                throw new Error("Decryption failed. Wrong password or corrupted cloud data.")
                            }

                            const payloadStr = raw.compressed ? decompressSyncPayload(decryptedStr) : decryptedStr

                            try {
                                data = JSON.parse(payloadStr)

                                // Post-Parse Check: If it PARSED into a literal string "[object Object]", then it's bad.
                                // But if it's a valid object that happens to CONTAIN that string somewhere, we keep it.
                                if (data === '[object Object]') {
                                    if (import.meta.env.DEV) console.warn('[Sync] Decrypted data IS "[object Object]". Discarding.')
                                    data = {}
                                }
                            } catch (parseErr) {
                                if (import.meta.env.DEV) console.error('[Sync] Parsing failed for decrypted string. Length:', decryptedStr.length)
                                throw parseErr // Let the outer catch handle it (which prompts wrong password)
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
                            deletedWatchEvents: (d.deletedWatchEvents && typeof d.deletedWatchEvents === 'object') ? d.deletedWatchEvents : {},
                            apiKeys: d.apiKeys,
                            discoverFavorites: d.discoverFavorites,
                            discoverPrefs: d.discoverPrefs,
                        }

                    } catch (e) {
                        if (import.meta.env.DEV) console.error("[Sync] Decryption/Parsing Error:", e)
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
                    if (!preUnlockEncryptionKey) {
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

                        const hasRemoteData = remoteAccounts.length > 0
                        const hasLocalData = localAccounts.length > 0

                        if (!hasRemoteData && hasLocalData) {
                            decision = 'Seed Cloud (local data exists, cloud is empty)'
                            await useAccountStore.getState().importAccounts(JSON.stringify(syncData), true, 'merge', preUnlockEncryptionKey)
                            setTimeout(() => get().syncToRemote(true), 1500)
                        } else if (isLocalNewer && hasLocalData) {
                            decision = 'Push Local (local is newer)'
                            setTimeout(() => get().syncToRemote(true), 1500)
                        } else if (hasRemoteData) {
                            if (isRemoteNewer) {
                                decision = 'Adopt Remote (cloud is newer, replace local)'
                                await useAccountStore.getState().importAccounts(JSON.stringify(syncData), true, 'mirror', preUnlockEncryptionKey)
                            } else {
                                decision = 'Merge (equal timestamps)'
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
                        useWatchEventStore.getState().initialize(mergedEvents as unknown as import('@/types/activity').WatchEvent[], mergedSnapshot as Record<string, Record<string, import('@/types/activity').SnapshotItem>>, mergedDeleted)
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

                    savePasswordToSession(password)
                    set({
                        auth: { id, password, name: (syncData.name as string) || '', isAuthenticated: true },
                        lastSyncedAt: (syncData.syncedAt as string) || new Date().toISOString(),
                        lastSeenVersion: (syncData.lastSeenVersion as string | null) || get().lastSeenVersion,
                        isInitialSyncCompleted: true
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
                if (get().auth.isAuthenticated && get().isInitialSyncCompleted && !get().isSyncing) {
                    try {
                        await Promise.race([
                            get().syncToRemote(true, false),
                            new Promise(resolve => setTimeout(resolve, 5000))
                        ])
                    } catch {}
                }

                _lastPushedHash = null
                _pendingRetry = false
                _accountsHydrated = false
                if (_syncDebounceTimer) { clearTimeout(_syncDebounceTimer); _syncDebounceTimer = null }
                if (_onlineHandler) { window.removeEventListener('online', _onlineHandler); _onlineHandler = null }
                if (_syncBC) { _syncBC.close(); _syncBC = null }
                clearPasswordFromSession()
                import('@/lib/canonical-base').then(({ clearCanonicalBases }) => clearCanonicalBases()).catch(() => {})
                set({
                    auth: { id: '', password: '', name: '', isAuthenticated: false },
                    lastSyncedAt: null,
                    isInitialSyncCompleted: false
                })

                const { useWatchEventStore } = await import('@/store/watchEventStore')
                await useWatchEventStore.getState().reset()
                await wipeAllData()
                await resetAllStores({ includeSync: false })

                toast({ title: "Logged Out", description: "See you next time." })
            },

            syncToRemote: async (isAuto: boolean = false, isDebounced: boolean = false) => {
                const { auth, serverUrl, isSyncing, isInitialSyncCompleted } = get()
                const { isLocked } = useAuthStore.getState()
                if (!auth.isAuthenticated || isSyncing || isLocked) return

                const { useWatchEventStore } = await import('@/store/watchEventStore')
                if (!useWatchEventStore.getState().initialized) {
                    if (isAuto) {
                        if (import.meta.env.DEV) console.log("[Sync] Skipping auto-push: Waiting for watch history hydration")
                        return
                    }
                    await get().refreshFromCloud()
                    if (!useWatchEventStore.getState().initialized) {
                        if (import.meta.env.DEV) console.log("[Sync] Push cancelled: watch history is not hydrated")
                        return
                    }
                }

                // SAFETY LOCK: If we haven't successfully synced FROM the cloud yet, 
                // we are NOT allowed to sync TO the cloud. This prevents stale clients 
                // from overwriting the source of truth with their old local state.
                if (isAuto && (!_accountsHydrated || !isInitialSyncCompleted)) {
                    if (import.meta.env.DEV) console.log("[Sync] Skipping auto-push: Waiting for hydration and initial pull")
                    return
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
                    return
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

                try {
                    trace('sync', 'push.start', { accountId: auth.id, isAuto })
                    const { loadSalt } = await import('@/lib/crypto')
                    const salt = loadSalt()
                    const saltBase64 = salt ? btoa(String.fromCharCode(...salt)) : undefined

                    const rawAccounts = await useAccountStore.getState().exportAccounts(true)
                    const rawAddons = useAddonStore.getState().exportLibrary()

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

                    const exportedAccounts = safeParse(rawAccounts)
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
                        deletedWatchEvents: watchExport.deletedEvents,
                        salt: saltBase64,
                        name: auth.name,
                        syncedAt: new Date().toISOString(),
                        lastSeenVersion: get().lastSeenVersion,
                        customThemes: (() => { try { return JSON.parse(localStorage.getItem('aio-custom-themes') || '[]') } catch { return [] } })(),
                        discoverFavorites: (() => { try { return JSON.parse(localStorage.getItem('aio-discover-favorites') || '[]') } catch { return [] } })(),
                        discoverPrefs: (() => { try { return JSON.parse(localStorage.getItem('aio-discover-prefs') || '{}') } catch { return {} } })(),
                    }

                    const { encryptSyncPayload } = await import('@/lib/crypto')
                    const stringifiedState = JSON.stringify(state)

                    if (stringifiedState === '[object Object]') {
                        throw new Error('Sync corruption detected: State is not an object.')
                    }

                    const payloadBytes = new TextEncoder().encode(stringifiedState).length
                    if (payloadBytes > 12 * 1024 * 1024) {
                        const mb = (payloadBytes / 1024 / 1024).toFixed(1)
                        console.error(`[Sync] Payload is ${mb}MB - exceeds safe threshold (12MB). Aborting push.`)
                        throw new Error(`Sync payload too large (${mb}MB). Remove some accounts or data.`)
                    }

                    const stateHash = await computeHash(stringifiedState)
                    if (_lastPushedHash !== null && stateHash === _lastPushedHash) {
                        return
                    }

                    const { syncSaltB64 } = get()
                    const syncSalt = syncSaltB64 ? Uint8Array.from(atob(syncSaltB64), c => c.charCodeAt(0)) : undefined
                    const shouldCompress = stringifiedState.length > 51200
                    let compressedPayload: string = stringifiedState
                    let isCompressed = false
                    if (shouldCompress) {
                        try {
                            compressedPayload = compressSyncPayload(stringifiedState)
                            isCompressed = true
                        } catch {}
                    }
                    const encryptedState = await encryptSyncPayload(compressedPayload, auth.password, syncSalt)

                    // Canonical addon lists for Hubs the server can't otherwise read
                    // (no Stremio authKey; Nuvio-only or local-only). Stremio accounts are
                    // already server-readable and served Stremio-first, so they're excluded:
                    // minimises both new server-side exposure and sync payload size. Captured
                    // so it can become the merge base on a CONFIRMED push (see success branch).
                    const canonicalPayload = useAccountStore.getState().accounts.reduce<Record<string, AddonDescriptor[]>>((map, a) => {
                        if (!getStremioAuthKey(a)) map[a.id] = a.addons || []
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
                            apiKeys: useAccountStore.getState().accounts.reduce<Record<string, string>>((map, a) => {
                                if (a.apiKey) map[a.id] = a.apiKey
                                return map
                            }, {}),
                            canonicalAddons: canonicalPayload,
                        })
                    })

                    if (res.status === 401) {
                        set({ auth: { id: '', password: '', name: '', isAuthenticated: false }, isInitialSyncCompleted: false })
                        clearPasswordFromSession()
                        throw new Error('Sync session expired')
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
                        return
                    }

                    _lastPushedHash = stateHash

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

                    try {
                        const bc = new BroadcastChannel('aio-sync')
                        bc.postMessage({ type: 'sync-complete', timestamp: Date.now() })
                        bc.close()
                    } catch (e) { if (import.meta.env.DEV) console.error(e) }
                } catch (e) {
                    const message = (e as Error).message
                    if (import.meta.env.DEV) console.error("Sync error:", apiPath, e)
                    if (isAuto) _pendingRetry = true
                        ; get().addLogEntry({
                            type: 'push',
                            status: 'error',
                            message: `Push Failed: ${message}`,
                            isAuto
                        })
                    trace('sync', 'push.error', { accountId: auth.id, isAuto, error: message, timing: Date.now() - pushStart })
                    if (!isAuto && !isDebounced && _appReady) {
                        toast({ variant: "destructive", title: "Save Failed", description: message })
                    }
                } finally {
                    set({ isSyncing: false })
                    releaseSyncLock()
                }
            },

            forcePushState: async () => {
                const { auth } = get()
                if (!auth.isAuthenticated) return

                set({ lastActionTimestamp: Date.now() + 10000 })

                    ; get().addLogEntry({
                        type: 'force-push',
                        status: 'success',
                        message: 'Force push initiated (timestamp inflated)',
                        isAuto: false
                    })

                await get().syncToRemote(false)
            },

            forceMirrorState: async () => {
                const { auth, serverUrl } = get()
                if (!auth.isAuthenticated) return
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
                        const decryptedStr = await decryptPayload(raw.data as string, auth.password, remoteSyncSalt)
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
                    auth: { id: '', password: '', name: '', isAuthenticated: false },
                    serverUrl: '',
                    lastSyncedAt: null,
                    isSyncing: false,
                    isRefreshingFromCloud: false,
                    lastActionTimestamp: 0,
                    isInitialSyncCompleted: false
                })
            }
        }),
        {
            name: 'aioman-sync',
            storage: createSafeStorage(),
            partialize: (state) => ({
                auth: {
                    id: state.auth.id,
                    name: state.auth.name,
                    isAuthenticated: state.auth.isAuthenticated,
                    password: '',
                },
                lastSyncedAt: state.lastSyncedAt,
                serverUrl: state.serverUrl,
                lastActionTimestamp: state.lastActionTimestamp,
                lastSeenVersion: state.lastSeenVersion,
                syncSaltB64: state.syncSaltB64,
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
    const restorePassword = () => {
        const state = useSyncStore.getState()
        if (state.auth.isAuthenticated && !state.auth.password) {
            const savedPassword = loadPasswordFromSession()
            if (savedPassword) {
                useSyncStore.setState({ auth: { ...state.auth, password: savedPassword } })
            }
        }
    }
    restorePassword()
    localStorage.removeItem('aio-pending-sync')

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
