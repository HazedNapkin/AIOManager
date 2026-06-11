import { triggerSync } from '@/lib/sync-trigger'
import {
    getAddons,
    updateAddons,
    fetchAddonManifest as apiFetchAddonManifest,
} from '@/api/addons'
import { mergeAddons, normalizeAddonUrl } from '@/lib/utils'
import { filterResurrected, reconcileTombstones } from '@/lib/addon-tombstones'
import { useAuthStore } from '@/store/authStore'
import { AddonDescriptor } from '@/types/addon'
import { CinemetaManifest } from '@/types/cinemeta'
import { isCinemetaAddon, detectAllPatches, applyCinemetaConfiguration } from '@/lib/cinemeta-utils'
import { syncManager } from '@/lib/sync/syncManager'
import { getEffectiveManifest } from '@/lib/addon-utils'
import { getCachedManifest, setCachedManifest } from '@/lib/manifest-cache'
import {
    getCachedAuthKey,
    getEncryptionKey,
    sanitizeAddonManifest,
    isAuthExpiredError,
    isTransientSyncError,
    refreshAuthKeyFromStoredPassword,
    applyAutopilotAddonFlags,
    needsDisabledAddonIdentityRepair,
    getAccountById,
    persistAccounts,
    syncMutexes,
    getAccountAuthKey,
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
        syncAccount(id, forceRefresh).catch(() => {})
    }, SYNC_DEBOUNCE_MS))
}

export async function syncAccount(id: string, forceRefresh = false) {
    const store = await getStore()
    if (!useAuthStore.getState().encryptionKey) return
    while (syncMutexes.has(id)) {
        await syncMutexes.get(id)
    }
    let resolveMutex!: () => void
    syncMutexes.set(id, new Promise<void>((r) => { resolveMutex = r }))
    store.setState({ loading: true, error: null })
    try {
        const account = getAccountById(store.getState().accounts, id)
        if (!account) throw new Error('Account not found')
        let finalAddons = account.addons
        let updatedAccount = account
        let failedReadConnIds = new Set<string>()
        const stremioConn = account.connections?.find(c => c.platform === 'stremio')
        const stremioEnabled = !account.connections?.length || stremioConn?.enabled !== false
        const accountAuthKey = getAccountAuthKey(account)
        if (accountAuthKey && stremioEnabled) {
            let currentAccount = account
            const encryptionKey = getEncryptionKey()
            let authKey = await getCachedAuthKey(accountAuthKey, encryptionKey)
            let authKeyRefreshed = false
            let addons: AddonDescriptor[]
            try {
                addons = await getAddons(authKey, currentAccount.id)
            } catch (error) {
                if (!isAuthExpiredError(error)) throw error
                const refreshed = await refreshAuthKeyFromStoredPassword(currentAccount, encryptionKey).catch((refreshError) => {
                    if (import.meta.env.DEV) console.warn('[Account] Stored credential refresh failed:', refreshError)
                    return null
                })
                if (!refreshed) throw error
                currentAccount = refreshed.account
                authKey = refreshed.authKey
                authKeyRefreshed = true
                addons = await getAddons(authKey, currentAccount.id)
            }

            const normalizedAddons = addons
                .filter(a => !syncManager.isPendingRemoval(currentAccount.id, a.transportUrl))
                .map((addon) => ({
                    ...addon,
                    manifest: sanitizeAddonManifest(addon.manifest, addon.transportUrl),
                }))

            // Drop addons the user deleted (and hasn't re-added) so the Stremio collection can't
            // resurrect them. Local-present addons are never filtered, so re-adds are safe.
            const survivingRemote = filterResurrected(normalizedAddons, currentAccount.addons, currentAccount.deletedAddons)
            const mergedAddons = mergeAddons(currentAccount.addons, survivingRemote)

            store.setState({ loading: true })

            const localManifestByUrl = new Map<string, AddonDescriptor['manifest']>()
            for (const a of currentAccount.addons) {
                if (a.manifest?.name && a.manifest.name !== 'Unknown Addon') {
                    localManifestByUrl.set(normalizeAddonUrl(a.transportUrl), a.manifest)
                }
            }

            const repairedAddons = await Promise.all(
                mergedAddons.map(async (addon) => {
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

                        if (!manifestRaw) {
                            const { manifest } = await apiFetchAddonManifest(
                                addon.transportUrl,
                                currentAccount.id
                            )
                            manifestRaw = manifest
                            setCachedManifest(addon.transportUrl, manifestRaw)
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
                        const stremioManifest = addon.manifest
                        if (stremioManifest && repairedManifest) {
                            const { getHostnameIdentifier } = await import('@/lib/addon-identifier')
                            const hostFallback = getHostnameIdentifier(addon.transportUrl)

                            if (stremioManifest.name &&
                                stremioManifest.name !== repairedManifest.name &&
                                stremioManifest.name !== hostFallback) {
                                if (import.meta.env.DEV) console.log(`[Sync] Detected custom name for "${repairedManifest.name}": "${stremioManifest.name}"`)
                                metadata.customName = stremioManifest.name
                            }
                            if (stremioManifest.logo && stremioManifest.logo !== repairedManifest.logo) {
                                if (import.meta.env.DEV) console.log(`[Sync] Detected custom logo for "${repairedManifest.name}"`)
                                metadata.customLogo = stremioManifest.logo
                            }
                            const isFallbackDesc = (s: string) => s.startsWith('Addon from ') && (s.includes(hostFallback) || addon.transportUrl.includes(s.split('Addon from ')[1] || '____'))
                            if (stremioManifest.description &&
                                stremioManifest.description !== repairedManifest.description &&
                                !isFallbackDesc(stremioManifest.description)) {
                                if (import.meta.env.DEV) console.log(`[Sync] Detected custom description for "${repairedManifest.name}"`)
                                metadata.customDescription = stremioManifest.description
                            }
                        }

                        const finalManifest = getEffectiveManifest({ ...addon, manifest: repairedManifest, metadata })
                        return { ...addon, manifest: finalManifest, metadata }
                    } catch (e) {
                        if (import.meta.env.DEV) console.warn(`[Sync] Failed to baseline ${addon.manifest?.name || 'addon'}:`, e)
                        return { ...addon, manifest: sanitizeAddonManifest(addon.manifest, addon.transportUrl) }
                    }
                })
            )

            const autopilotResult = await applyAutopilotAddonFlags(currentAccount.id, repairedAddons)
            finalAddons = autopilotResult.addons

            const { absorbConnectionAddons } = await import('@/lib/connection-discovery')
            const { addons: absorbedAddons, failedReadConnIds: absorbFailed, changed: discoveryChanged } = await absorbConnectionAddons({ ...currentAccount, addons: finalAddons }, id)
            failedReadConnIds = absorbFailed
            if (discoveryChanged) {
                finalAddons = absorbedAddons
            }

            if (forceRefresh || autopilotResult.changed || discoveryChanged) {
                await updateAddons(authKey, finalAddons, currentAccount.id, { previousCollection: currentAccount.addons })
            }

            const addonsChanged = JSON.stringify(currentAccount.addons) !== JSON.stringify(finalAddons)
            let updatedProfiles = currentAccount.profiles
            if (currentAccount.activeProfileId && updatedProfiles) {
                updatedProfiles = updatedProfiles.map(p =>
                    p.id === currentAccount.activeProfileId
                        ? { ...p, addons: structuredClone(finalAddons) }
                        : p
                )
            }
            updatedAccount = {
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
                        c.enabled ? { ...c, lastSync: syncNow } : c
                    ),
                }
            }

            const accounts = store.getState().accounts.map((acc) => (acc.id === id ? updatedAccount : acc))
            store.setState({ accounts })

            if (addonsChanged || authKeyRefreshed || discoveryChanged) {
                persistAccounts(accounts)
            }

            triggerSync()

            const { useAddonStore } = await import('@/store/addonStore')
            await useAddonStore.getState().syncAccountState(id, getAccountAuthKey(currentAccount), finalAddons).catch(e => { if (import.meta.env.DEV) console.error(e) })
        } else if (account.connections?.some(c => c.enabled)) {
            const { absorbConnectionAddons } = await import('@/lib/connection-discovery')
            const absorb = await absorbConnectionAddons(account, id)
            failedReadConnIds = absorb.failedReadConnIds
            let pushAddons = account.addons
            if (absorb.changed) {
                pushAddons = absorb.addons
                const { useAddonStore } = await import('@/store/addonStore')
                await useAddonStore.getState().syncAccountState(id, getAccountAuthKey(account), pushAddons).catch(e => { if (import.meta.env.DEV) console.error(e) })
            }
            const autopilotResult = await applyAutopilotAddonFlags(id, pushAddons)
            if (autopilotResult.changed) {
                pushAddons = autopilotResult.addons
                const { useAddonStore } = await import('@/store/addonStore')
                await useAddonStore.getState().syncAccountState(id, getAccountAuthKey(account), pushAddons).catch(e => { if (import.meta.env.DEV) console.error(e) })
            }
            finalAddons = pushAddons
            const syncNow = Date.now()
            updatedAccount = {
                ...account,
                addons: pushAddons,
                deletedAddons: reconcileTombstones(account.deletedAddons, pushAddons),
                lastSync: new Date(),
                status: 'active' as const,
                ...(account.connections?.length ? {
                    connections: account.connections.map(c =>
                        c.enabled ? { ...c, lastSync: syncNow } : c
                    ),
                } : {}),
            }
            const accounts = store.getState().accounts.map((acc) => (acc.id === id ? updatedAccount : acc))
            store.setState({ accounts })
            persistAccounts(accounts)
        }

        if (updatedAccount.connections?.some(c => c.enabled)) {
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
                    }).catch(() => {})
                }
            } catch (e) {
                if (import.meta.env.DEV) console.warn('[Account] Multi-connection reconciler push failed:', e)
            }
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to sync account'
        const isExpired = isAuthExpiredError(error)
        const accounts = store.getState().accounts.map((acc) =>
            acc.id === id ? { ...acc, status: isExpired ? 'expired' as const : 'error' as const } : acc
        )
        store.setState({ accounts, error: message })
        persistAccounts(accounts)

        throw error
    } finally {
        store.setState({ loading: false })
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

    store.setState({ loading: true, error: null })
    const accounts = store.getState().accounts
    let hasAnyChange = false

    const BATCH_SIZE = 5
    const syncOne = async (account: typeof accounts[0]) => {
        if (syncMutexes.has(account.id)) return
        if (!getAccountAuthKey(account) && !account.connections?.some(c => c.enabled && c.platform !== 'stremio')) return
        const stremioConn = account.connections?.find(c => c.platform === 'stremio')
        if (account.connections?.length && stremioConn?.enabled === false) return

        // Circuit breaker: skip accounts where ALL non-Stremio connections are expired
        // Prevents hammering external auth endpoints (Supabase rate-limits to 6 req/min)
        const nonStremioConnections = account.connections?.filter(c => c.platform !== 'stremio' && c.enabled) || []
        const allNonStremioExpired = nonStremioConnections.length > 0 && nonStremioConnections.every(c => c.status === 'expired')
        if (allNonStremioExpired) {
            if (import.meta.env.DEV) console.log(`[Account] syncAllAccounts skipping ${account.id}: all non-Stremio connections expired`)
            return
        }

        let resolveMutex!: () => void
        syncMutexes.set(account.id, new Promise<void>((r) => { resolveMutex = r }))
        try {
            const encryptionKey = getEncryptionKey()
            let accountForSync = account
            const accountAuthKey = getAccountAuthKey(accountForSync)

            if (!accountAuthKey) {
                const { absorbConnectionAddons } = await import('@/lib/connection-discovery')
                const absorb = await absorbConnectionAddons(accountForSync, account.id)
                let pushAddons = accountForSync.addons
                if (absorb.changed) {
                    pushAddons = absorb.addons
                    const { useAddonStore } = await import('@/store/addonStore')
                    await useAddonStore.getState().syncAccountState(account.id, getAccountAuthKey(accountForSync), pushAddons).catch(e => { if (import.meta.env.DEV) console.error(e) })
                }
                const autopilotPush = await applyAutopilotAddonFlags(account.id, pushAddons)
                if (autopilotPush.changed) {
                    pushAddons = autopilotPush.addons
                    const { useAddonStore } = await import('@/store/addonStore')
                    await useAddonStore.getState().syncAccountState(account.id, getAccountAuthKey(accountForSync), pushAddons).catch(e => { if (import.meta.env.DEV) console.error(e) })
                }
                if (accountForSync.connections?.some(c => c.enabled)) {
                    const { triggerReconciliation } = await import('@/api/connection')
                    const pushConnections = (accountForSync.connections || []).filter(c => !absorb.failedReadConnIds.has(c.id))
                    const reconcileResult = await triggerReconciliation(accountForSync.id, accountForSync.primaryConnectionId, pushConnections, pushAddons)
                    if (reconcileResult.connectionStates && Object.keys(reconcileResult.connectionStates).length > 0) {
                        import('@/store/connectionStore').then(({ useConnectionStore }) => {
                            useConnectionStore.setState(s => ({
                                connectionStates: {
                                    ...s.connectionStates,
                                    [account.id]: { ...(s.connectionStates[account.id] || {}), ...reconcileResult.connectionStates },
                                },
                            }))
                        }).catch(() => {})
                    }
                }
                hasAnyChange = true
                store.setState(state => ({
                    accounts: state.accounts.map(acc => acc.id === account.id ? { ...acc, addons: pushAddons, deletedAddons: reconcileTombstones(acc.deletedAddons, pushAddons), lastSync: new Date(), status: 'active' as const } : acc)
                }))
                return
            }

            let authKey = await getCachedAuthKey(accountAuthKey, encryptionKey)
            let addons: AddonDescriptor[]
            try {
                addons = await getAddons(authKey, accountForSync.id)
            } catch (error) {
                if (!isAuthExpiredError(error)) throw error
                const refreshed = await refreshAuthKeyFromStoredPassword(accountForSync, encryptionKey).catch((refreshError) => {
                    if (import.meta.env.DEV) console.warn('[Account] Stored credential refresh failed:', refreshError)
                    return null
                })
                if (!refreshed) throw error
                accountForSync = refreshed.account
                authKey = refreshed.authKey
                hasAnyChange = true
                addons = await getAddons(authKey, accountForSync.id)
            }

            const normalizedAddons = addons.map((addon) => ({
                ...addon,
                manifest: sanitizeAddonManifest(addon.manifest, addon.transportUrl),
            }))

            const survivingRemote = filterResurrected(normalizedAddons, accountForSync.addons, accountForSync.deletedAddons)
            const mergedAddons = mergeAddons(accountForSync.addons, survivingRemote)

            const effectiveAddons = await Promise.all(mergedAddons.map(async (addon) => {
                if (isCinemetaAddon(addon)) return addon

                if (needsDisabledAddonIdentityRepair(addon)) {
                    try {
                        const fetched = await apiFetchAddonManifest(addon.transportUrl, accountForSync.id, true)
                        const repairedManifest = sanitizeAddonManifest(fetched.manifest, addon.transportUrl)
                        return {
                            ...addon,
                            manifest: getEffectiveManifest({ ...addon, manifest: repairedManifest }),
                        }
                    } catch (error) {
                        if (import.meta.env.DEV) console.warn(`[Sync] Failed to repair disabled addon identity for ${addon.transportUrl}:`, error)
                    }
                }

                return {
                    ...addon,
                    manifest: getEffectiveManifest(addon)
                }
            }))

            const autopilotResult = await applyAutopilotAddonFlags(account.id, effectiveAddons)
            let pushAddons = autopilotResult.addons
            const addonsChanged = JSON.stringify(accountForSync.addons) !== JSON.stringify(pushAddons)

            if (addonsChanged) hasAnyChange = true

            const { absorbConnectionAddons } = await import('@/lib/connection-discovery')
            const absorb = await absorbConnectionAddons({ ...accountForSync, addons: pushAddons }, accountForSync.id)
            if (absorb.changed) {
                pushAddons = absorb.addons
                hasAnyChange = true
            }

            if (autopilotResult.changed || absorb.changed) {
                await updateAddons(authKey, pushAddons, accountForSync.id, { previousCollection: accountForSync.addons })
            }

            let updatedProfiles = accountForSync.profiles
            if (accountForSync.activeProfileId && updatedProfiles) {
                updatedProfiles = updatedProfiles.map(p =>
                    p.id === accountForSync.activeProfileId
                        ? { ...p, addons: structuredClone(pushAddons) }
                        : p
                )
            }

            store.setState(state => ({
                accounts: state.accounts.map(acc => acc.id === accountForSync.id ? {
                    ...accountForSync, addons: pushAddons, profiles: updatedProfiles, deletedAddons: reconcileTombstones(accountForSync.deletedAddons, pushAddons), lastSync: new Date(), status: 'active' as const,
                } : acc)
            }))

            const { useAddonStore } = await import('@/store/addonStore')
            await useAddonStore.getState().syncAccountState(accountForSync.id, getAccountAuthKey(accountForSync), pushAddons).catch(e => { if (import.meta.env.DEV) console.error(e) })

            if (accountForSync.connections?.some(c => c.enabled)) {
                try {
                    const { triggerReconciliation } = await import('@/api/connection')
                    const pushConnections = (accountForSync.connections || []).filter(c => !absorb.failedReadConnIds.has(c.id))
                    await triggerReconciliation(accountForSync.id, accountForSync.primaryConnectionId, pushConnections, pushAddons)
                } catch (e) {
                    if (import.meta.env.DEV) console.warn('[Account] Multi-connection reconciler push failed:', e)
                }
            }
        } catch (error: unknown) {
            if (isTransientSyncError(error)) return
            const isExpired = isAuthExpiredError(error)
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
        store.setState({ loading: false })
        _syncAllRunning = false
    }
}

export async function repairAccount(id: string) {
    const store = await getStore()
    return store.getState().syncAccount(id, true)
}
