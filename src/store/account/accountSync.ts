import { triggerSync } from '@/lib/sync-trigger'
import {
    getAddons,
    updateAddons,
    fetchAddonManifest as apiFetchAddonManifest,
} from '@/api/addons'
import { mergeAddons, normalizeAddonUrl } from '@/lib/utils'
import { filterResurrected, reconcileTombstones } from '@/lib/addon-tombstones'
import { trace } from '@/lib/trace'
import { useAuthStore } from '@/store/authStore'
import { AddonDescriptor } from '@/types/addon'
import type { Account } from '@/types/account'
import { CinemetaManifest } from '@/types/cinemeta'
import { isCinemetaAddon, detectAllPatches, applyCinemetaConfiguration } from '@/lib/cinemeta-utils'
import { syncManager } from '@/lib/sync/syncManager'
import { getEffectiveManifest } from '@/lib/addon-utils'
import { inferCustomMetadata } from '@/lib/addon-custom-metadata'
import { getCachedManifest, setCachedManifest, recordManifestFetchFailure, shouldSkipManifestFetch, hydrateManifestCache } from '@/lib/manifest-cache'
import {
    getCachedAuthKey,
    getEncryptionKey,
    sanitizeAddonManifest,
    isAuthError,
    isTransientSyncError,
    refreshAuthKeyFromStoredPassword,
    applyAutopilotAddonFlags,
    needsDisabledAddonIdentityRepair,
    getAccountById,
    persistAccounts,
    syncMutexes,
    getStremioAuthKey,
    setAccountLoading,
    clearAccountLoading,
    setAccountsLoading,
    clearAllAccountLoading,
} from '../accountStore'
import type { AccountStore } from '../accountStore'

type StoreRef = { getState: () => AccountStore; setState: (partial: Partial<AccountStore> | ((state: AccountStore) => Partial<AccountStore>)) => void }

async function getStore(): Promise<StoreRef> {
    const { useAccountStore } = await import('../accountStore')
    return useAccountStore
}

let _syncAllRunning = false

// Per-account debounce: rapid sequential triggers (toggle, addon op, etc.) coalesce into one sync.
const _pendingSyncs = new Map<string, ReturnType<typeof setTimeout>>()
const SYNC_DEBOUNCE_MS = 800

/**
 * Schedule a debounced syncAccount for state-change-triggered syncs.
 * Multiple calls within SYNC_DEBOUNCE_MS for the same account collapse into one.
 * For user-initiated (manual) syncs call syncAccount() directly.
 */
export function scheduleSyncAccount(id: string, forceRefresh = false): void {
    const existing = _pendingSyncs.get(id)
    if (existing) clearTimeout(existing)
    _pendingSyncs.set(id, setTimeout(() => {
        _pendingSyncs.delete(id)
        syncAccount(id, forceRefresh).catch(() => { })
    }, SYNC_DEBOUNCE_MS))
}

export function mergeRemoteIntoHub(account: Account, remoteAddons: AddonDescriptor[], forceRefresh = false): AddonDescriptor[] {
    trace('sync.merge', 'enter', { accountId: account.id, remote: remoteAddons.length, local: account.addons.length, forceRefresh })
    const normalizedAddons = remoteAddons
        .filter(a => !syncManager.isPendingRemoval(account.id, a.transportUrl))
        .map((addon) => ({
            ...addon,
            manifest: sanitizeAddonManifest(addon.manifest, addon.transportUrl),
        }))

    const survivingRemote = filterResurrected(normalizedAddons, account.addons, account.deletedAddons)
    trace('sync.merge', 'post-tombstone', { accountId: account.id, afterTombstone: survivingRemote.length, stripped: normalizedAddons.length - survivingRemote.length })
    const survivingUrls = new Set(survivingRemote.map(a => normalizeAddonUrl(a.transportUrl)))
    const strippedByTombstone = normalizedAddons
        .filter(a => !survivingUrls.has(normalizeAddonUrl(a.transportUrl)))
        .map(a => ({ id: a.manifest?.id || '?', url: (a.transportUrl || '').slice(-48) }))
    trace('mergeRemoteIntoHub', 'tombstone-filter', {
        accountId: account.id,
        forceRefresh,
        remote: normalizedAddons.length,
        local: (account.addons || []).length,
        surviving: survivingRemote.length,
        tombstoneCount: Object.keys(account.deletedAddons || {}).length,
        strippedByTombstone,
    })
    // Hub-canonical: passive read is additive; only an explicit forceRefresh adopts platform removals.
    const out = mergeAddons(account.addons, survivingRemote, { keepMissingLocal: !forceRefresh })
    trace('sync.merge', 'result', { accountId: account.id, out: out.length, keepMissingLocal: !forceRefresh })
    return out
}

async function repairAndFlag(
    account: Account,
    addons: AddonDescriptor[],
    forceRefresh: boolean,
): Promise<AddonDescriptor[]> {
    const localManifestByUrl = new Map<string, AddonDescriptor['manifest']>()
    for (const a of account.addons) {
        if (a.manifest?.name && a.manifest.name !== 'Unknown Addon') {
            localManifestByUrl.set(normalizeAddonUrl(a.transportUrl), a.manifest)
        }
    }

    const repairedAddons = await Promise.all(
        addons.map(async (addon) => {
            try {
                const v = (addon.manifest?.version || '').replace(/^v/, '')
                const isBroken = !addon.manifest?.name ||
                    addon.manifest.name === 'Unknown Addon' ||
                    v === '0.0.0' ||
                    v === '' ||
                    !addon.manifest.resources ||
                    addon.manifest.resources.length === 0 ||
                    needsDisabledAddonIdentityRepair(addon)

                if (!forceRefresh && addon.manifest && addon.manifest.id && !isBroken) {
                    if (isCinemetaAddon(addon) && !addon.metadata?.cinemetaConfig) {
                        const detected = detectAllPatches(addon.manifest as CinemetaManifest)
                        if (detected.searchArtifactsPatched || detected.standardCatalogsPatched || detected.metaResourcePatched) {
                            return {
                                ...addon,
                                metadata: {
                                    ...(addon.metadata || {}),
                                    cinemetaConfig: {
                                        removeSearchArtifacts: detected.searchArtifactsPatched,
                                        removeStandardCatalogs: detected.standardCatalogsPatched,
                                        removeMetaResource: detected.metaResourcePatched,
                                    }
                                }
                            }
                        }
                    }
                    return addon
                }

                let cinemetaPatches = null
                if (isCinemetaAddon(addon)) {
                    cinemetaPatches = detectAllPatches(addon.manifest as CinemetaManifest)
                }

                let manifestRaw = null
                const cached = getCachedManifest(addon.transportUrl)
                if (cached) {
                    manifestRaw = cached
                } else if (isBroken && !forceRefresh) {
                    const localManifest = localManifestByUrl.get(normalizeAddonUrl(addon.transportUrl))
                    if (localManifest) {
                        manifestRaw = localManifest
                    }
                }

                if (!manifestRaw && !forceRefresh && shouldSkipManifestFetch(addon.transportUrl)) {
                    manifestRaw = localManifestByUrl.get(normalizeAddonUrl(addon.transportUrl)) || addon.manifest
                }

                if (!manifestRaw) {
                    try {
                        const { manifest } = await apiFetchAddonManifest(
                            addon.transportUrl,
                            account.id
                        )
                        manifestRaw = manifest
                        setCachedManifest(addon.transportUrl, manifestRaw)
                    } catch (err) {
                        recordManifestFetchFailure(addon.transportUrl)
                        throw err
                    }
                }

                const metadata = { ...(addon.metadata || {}) }

                let repairedManifest = sanitizeAddonManifest(manifestRaw, addon.transportUrl)

                if (metadata.cinemetaConfig) {
                    repairedManifest = applyCinemetaConfiguration(repairedManifest as CinemetaManifest, metadata.cinemetaConfig) as AddonDescriptor['manifest']
                } else if (cinemetaPatches && (
                    cinemetaPatches.searchArtifactsPatched ||
                    cinemetaPatches.standardCatalogsPatched ||
                    cinemetaPatches.metaResourcePatched
                )) {
                    const config = {
                        removeSearchArtifacts: cinemetaPatches.searchArtifactsPatched,
                        removeStandardCatalogs: cinemetaPatches.standardCatalogsPatched,
                        removeMetaResource: cinemetaPatches.metaResourcePatched,
                    }
                    repairedManifest = applyCinemetaConfiguration(repairedManifest as CinemetaManifest, config) as AddonDescriptor['manifest']
                    metadata.cinemetaConfig = config
                }
                const finalMetadata = inferCustomMetadata(metadata, addon.manifest, repairedManifest, addon.transportUrl)

                const finalManifest = getEffectiveManifest({ ...addon, manifest: repairedManifest, metadata: finalMetadata })
                return { ...addon, manifest: finalManifest, metadata: finalMetadata }
            } catch (e) {
                if (import.meta.env.DEV) console.warn(`[Sync] Failed to baseline ${addon.manifest?.name || 'addon'}:`, e)
                const sanitized = sanitizeAddonManifest(addon.manifest, addon.transportUrl)
                const finalManifest = getEffectiveManifest({ ...addon, manifest: sanitized })
                return { ...addon, manifest: finalManifest }
            }
        })
    )

    const autopilotResult = await applyAutopilotAddonFlags(account.id, repairedAddons)
    return autopilotResult.addons
}

interface SyncCoreResult {
    changed: boolean
    authKeyRefreshed: boolean
}

async function syncAccountCore(id: string, forceRefresh: boolean): Promise<SyncCoreResult> {
    const store = await getStore()
    const account = getAccountById(store.getState().accounts, id)
    if (!account) throw new Error('Account not found')

    const stremioConn = account.connections?.find(c => c.platform === 'stremio')
    const stremioEnabled = !account.connections?.length || stremioConn?.enabled !== false
    const accountAuthKey = getStremioAuthKey(account)
    const useStremio = !!accountAuthKey && stremioEnabled

    let currentAccount = account
    let authKeyRefreshed = false
    let stremioAuthKey: string | undefined
    let finalAddons: AddonDescriptor[]

    trace('sync.core', 'start', { accountId: id, useStremio, hasConnections: !!currentAccount.connections?.some(c => c.enabled) })

    if (useStremio) {
        const encryptionKey = getEncryptionKey()
        let authKey = await getCachedAuthKey(accountAuthKey, encryptionKey)
        let remoteAddons: AddonDescriptor[]
        try {
            remoteAddons = await getAddons(authKey, currentAccount.id)
        } catch (error) {
            if (!isAuthError(error)) throw error
            const refreshed = await refreshAuthKeyFromStoredPassword(currentAccount, encryptionKey).catch((refreshError) => {
                if (import.meta.env.DEV) console.warn('[Account] Stored credential refresh failed:', refreshError)
                return null
            })
            if (!refreshed) throw error
            currentAccount = refreshed.account
            authKey = refreshed.authKey
            authKeyRefreshed = true
            remoteAddons = await getAddons(authKey, currentAccount.id)
        }
        stremioAuthKey = authKey
        trace('sync.core', 'read', { accountId: id, remote: remoteAddons.length })
        if (!useAuthStore.getState().encryptionKey) return { changed: false, authKeyRefreshed }
        const merged = mergeRemoteIntoHub(currentAccount, remoteAddons, forceRefresh)
        finalAddons = await repairAndFlag(currentAccount, merged, forceRefresh)
    } else {
        finalAddons = await repairAndFlag(currentAccount, currentAccount.addons, forceRefresh)
    }
    if (!useAuthStore.getState().encryptionKey) return { changed: false, authKeyRefreshed }

    let failedReadConnIds = new Set<string>()
    let discoveryChanged = false
    if (currentAccount.connections?.some(c => c.enabled)) {
        const { absorbConnectionAddons } = await import('@/lib/connection-discovery')
        const absorb = await absorbConnectionAddons({ ...currentAccount, addons: finalAddons }, id)
        if (!useAuthStore.getState().encryptionKey) return { changed: false, authKeyRefreshed }
        failedReadConnIds = absorb.failedReadConnIds
        if (absorb.changed) {
            finalAddons = absorb.addons
            discoveryChanged = true
        }
    }

    trace('sync.core', 'discovery', { accountId: id, changed: discoveryChanged, final: finalAddons.length })

    const addonsChanged = JSON.stringify(currentAccount.addons) !== JSON.stringify(finalAddons)
    trace('sync.core', 'flags', { accountId: id, addonsChanged, discoveryChanged, forceRefresh })
    let updatedProfiles = currentAccount.profiles
    if (currentAccount.activeProfileId && updatedProfiles) {
        updatedProfiles = updatedProfiles.map(p =>
            p.id === currentAccount.activeProfileId
                ? { ...p, addons: structuredClone(finalAddons) }
                : p
        )
    }
    let updatedAccount: Account = {
        ...currentAccount,
        addons: finalAddons,
        profiles: updatedProfiles,
        deletedAddons: reconcileTombstones(currentAccount.deletedAddons, finalAddons),
        lastSync: new Date(),
        status: 'active' as const,
    }
    const syncNow = Date.now()
    if (updatedAccount.connections?.length) {
        updatedAccount = {
            ...updatedAccount,
            connections: updatedAccount.connections.map(c =>
                c.enabled ? { ...c, lastSync: syncNow, status: 'active' as const } : c
            ),
        }
    }

    const accounts = store.getState().accounts.map((acc) => (acc.id === id ? updatedAccount : acc))
    store.setState({ accounts })
    if (addonsChanged || authKeyRefreshed || discoveryChanged) {
        persistAccounts(accounts)
    }

    const { useAddonStore } = await import('@/store/addonStore')
    await useAddonStore.getState().syncAccountState(id, getStremioAuthKey(currentAccount), finalAddons).catch(e => { if (import.meta.env.DEV) console.error(e) })
    if (!useAuthStore.getState().encryptionKey) return { changed: addonsChanged || discoveryChanged || authKeyRefreshed, authKeyRefreshed }

    const pushPromises: Promise<void>[] = []
    trace('sync.core', 'writeback-gate', { accountId: id, willPushStremio: !!(useStremio && stremioAuthKey && (forceRefresh || discoveryChanged)), reason: forceRefresh ? 'forceRefresh' : discoveryChanged ? 'discoveryChanged' : 'passive-skip' })
    if (useStremio && stremioAuthKey && (forceRefresh || discoveryChanged)) {
        pushPromises.push(
            updateAddons(stremioAuthKey, finalAddons, currentAccount.id, { previousCollection: currentAccount.addons })
                .catch(err => { if (!isTransientSyncError(err)) throw err })
        )
    }

    trace('sync.core', 'push-connections-gate', { accountId: id, willPush: !!(forceRefresh || discoveryChanged) })
    if ((forceRefresh || discoveryChanged) && updatedAccount.connections?.some(c => c.enabled)) {
        pushPromises.push(
            (async () => {
                try {
                    const { triggerReconciliation } = await import('@/api/connection')
                    const pushConnections = (updatedAccount.connections || []).filter(c => !failedReadConnIds.has(c.id))
                    const reconcileResult = await triggerReconciliation(id, updatedAccount.primaryConnectionId, pushConnections, finalAddons)
                    if (reconcileResult.connectionStates && Object.keys(reconcileResult.connectionStates).length > 0) {
                        import('@/store/connectionStore').then(({ useConnectionStore }) => {
                            useConnectionStore.setState(s => ({
                                connectionStates: {
                                    ...s.connectionStates,
                                    [id]: { ...(s.connectionStates[id] || {}), ...reconcileResult.connectionStates },
                                },
                            }))
                        }).catch(() => { })
                    }
                } catch (e) {
                    if (import.meta.env.DEV) console.warn('[Account] Multi-connection reconciler push failed:', e)
                }
            })()
        )
    }

    await Promise.all(pushPromises)

    return { changed: addonsChanged || discoveryChanged || authKeyRefreshed, authKeyRefreshed }
}

export async function syncAccount(id: string, forceRefresh = false) {
    const store = await getStore()
    if (!useAuthStore.getState().encryptionKey) return

    while (syncMutexes.has(id)) {
        await syncMutexes.get(id)
    }
    let resolveMutex!: () => void
    syncMutexes.set(id, new Promise<void>((r) => { resolveMutex = r }))
    store.setState({ error: null })
    setAccountLoading(id)
    try {
        await syncAccountCore(id, forceRefresh)
        triggerSync()
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to sync account'
        const isExpired = isAuthError(error)
        const accounts = store.getState().accounts.map((acc) =>
            acc.id === id ? { ...acc, status: isExpired ? 'expired' as const : 'error' as const } : acc
        )
        store.setState({ accounts, error: message })
        persistAccounts(accounts)
        throw error
    } finally {
        clearAccountLoading(id)
        resolveMutex()
        syncMutexes.delete(id)
    }
}

export async function syncAllAccounts(silent = false) {
    const store = await getStore()
    if (_syncAllRunning) {
        if (import.meta.env.DEV) console.log(`[Account] syncAllAccounts skipped - already running`)
        return
    }
    _syncAllRunning = true
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { _syncAllRunning = false; return }
    if (!useAuthStore.getState().encryptionKey) { _syncAllRunning = false; return }

    await hydrateManifestCache()

    store.setState({ error: null })
    const accounts = store.getState().accounts
    setAccountsLoading(accounts.map(a => a.id))
    let hasAnyChange = false

    const BATCH_SIZE = 5
    const syncOne = async (account: typeof accounts[0]) => {
        if (syncMutexes.has(account.id)) return
        const hasAnyEnabledConnection = account.connections?.some(c => c.enabled)
        const hasRootAuthKey = !!getStremioAuthKey(account)
        if (!hasAnyEnabledConnection && !hasRootAuthKey) return

        const nonStremioConnections = account.connections?.filter(c => c.platform !== 'stremio' && c.enabled) || []
        const allNonStremioExpired = nonStremioConnections.length > 0 && nonStremioConnections.every(c => c.status === 'expired')
        if (allNonStremioExpired) {
            if (import.meta.env.DEV) console.log(`[Account] syncAllAccounts skipping ${account.id}: all non-Stremio connections expired`)
            return
        }

        let resolveMutex!: () => void
        syncMutexes.set(account.id, new Promise<void>((r) => { resolveMutex = r }))
        try {
            const result = await syncAccountCore(account.id, false)
            if (result.changed) hasAnyChange = true
        } catch (error: unknown) {
            if (isTransientSyncError(error)) return
            const isExpired = isAuthError(error)
            store.setState(state => ({
                accounts: state.accounts.map(acc =>
                    acc.id === account.id ? { ...acc, status: isExpired ? 'expired' as const : 'error' as const } : acc
                )
            }))
            hasAnyChange = true
        } finally {
            resolveMutex()
            syncMutexes.delete(account.id)
        }
    }

    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
        await Promise.all(accounts.slice(i, i + BATCH_SIZE).map(syncOne))
    }

    try {
        if (hasAnyChange) {
            persistAccounts(store.getState().accounts)
        }

        if (!silent && hasAnyChange) {
            triggerSync()
        }
    } finally {
        clearAllAccountLoading()
        _syncAllRunning = false
    }
}

export async function repairAccount(id: string) {
    const store = await getStore()
    return store.getState().syncAccount(id, true)
}
