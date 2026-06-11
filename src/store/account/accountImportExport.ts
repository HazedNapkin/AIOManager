import { mergeAddons } from '@/lib/utils'
import { mergeTombstones, filterResurrected, reconcileTombstones } from '@/lib/addon-tombstones'
import { readSyncedSettings } from '@/lib/synced-settings'
import { decrypt, encrypt } from '@/lib/crypto'
import { AddonDescriptor, AddonManifest } from '@/types/addon'
import { StremioAccount } from '@/types/account'
import type { Connection } from '@/types/connection'
import { useProfileStore } from '@/store/profileStore'
import localforage from 'localforage'
import { triggerSync } from '@/lib/sync-trigger'
import { toast } from '@/hooks/use-toast'
import { applySyncedSettings } from '@/lib/synced-settings'
import {
    getEncryptionKey,
    sanitizeAddonManifest,
    safeUUID,
    persistAccounts,
    acquireSyncMutex,
    STORAGE_KEY,
    CHANGELOG_KEY,
    BACKUP_KEY,
} from '../accountStore'
import type { AccountStore } from '../accountStore'

type StoreRef = { getState: () => AccountStore; setState: (partial: Partial<AccountStore> | ((state: AccountStore) => Partial<AccountStore>)) => void }

async function getStore(): Promise<StoreRef> {
    const { useAccountStore } = await import('../accountStore')
    return useAccountStore
}

// Incoming connections carry metadata only (credentials live server-side), so local credentials
// must be preserved on the merge.
function mergeConnections(
    local: Connection[] | undefined,
    incoming: Partial<Connection>[] | undefined,
    mode: 'merge' | 'mirror',
): Connection[] | undefined {
    if (!incoming) return local
    const localById = new Map((local || []).map(c => [c.id, c]))
    const merged: Connection[] = incoming
        .filter(inc => inc.id && inc.platform)
        .map(inc => {
            const existing = localById.get(inc.id as string)
            return {
                status: 'active',
                lastSync: 0,
                lastKnownAddonCount: 0,
                consecutiveFailures: 0,
                ...(existing || {}),
                ...inc,
                credentials: existing?.credentials ?? {},
            } as Connection
        })
    if (mode === 'merge') {
        const incomingIds = new Set(merged.map(c => c.id))
        for (const c of local || []) {
            if (!incomingIds.has(c.id)) merged.push(c)
        }
    }
    return merged
}

export async function exportAccounts(includeCredentialsValue: boolean) {
    const store = await getStore()
    try {
        const manifestMap: Record<string, AddonDescriptor['manifest']> = {}
        const getManifestKey = (m: AddonDescriptor['manifest']) => `${m.id}:${m.version}`

        const processAddons = (addons: AddonDescriptor[]) => {
            return addons.map((addon: AddonDescriptor) => {
                const sanitized = sanitizeAddonManifest(addon.manifest, addon.transportUrl)
                const key = getManifestKey(sanitized)
                if (!manifestMap[key]) manifestMap[key] = sanitized
                return {
                    transportUrl: addon.transportUrl,
                    transportName: addon.transportName,
                    manifestId: key,
                    flags: addon.flags,
                    metadata: addon.metadata,
                    catalogOverrides: addon.catalogOverrides,
                    syncToLibrary: addon.syncToLibrary,
                    note: addon.note,
                }
            })
        }

        const exportedAccounts = await Promise.all(
            store.getState().accounts.map(async (acc) => ({
                id: acc.id,
                name: acc.name,
                email: acc.email,
                authKey: includeCredentialsValue ? await decrypt(acc.authKey, getEncryptionKey()!) : undefined,
                password:
                    includeCredentialsValue && acc.password
                        ? await decrypt(acc.password, getEncryptionKey()!)
                        : undefined,
                accentColor: acc.accentColor,
                emoji: acc.emoji,
                note: acc.note,
                profiles: acc.profiles,
                activeProfileId: acc.activeProfileId,
                deletedAddons: acc.deletedAddons,
                addons: processAddons(acc.addons),
                // metadata only; credentials live server-side in server_credentials
                connections: (acc.connections || []).map(c => ({
                    id: c.id,
                    platform: c.platform,
                    connectionType: c.connectionType,
                    driverType: c.driverType,
                    enabled: c.enabled,
                    profileMapping: c.profileMapping,
                    capabilities: c.capabilities,
                    pluginList: c.pluginList,
                    driverConfig: c.driverConfig,
                    displayName: c.displayName,
                })),
                primaryConnectionId: acc.primaryConnectionId,
                apiKey: acc.apiKey,
                hideLastWatched: acc.hideLastWatched,
            }))
        )
        const { useVaultStore } = await import('@/store/vaultStore')
        if (useVaultStore.getState().isLocked) {
            const { useAuthStore } = await import('@/store/authStore')
            if (useAuthStore.getState().encryptionKey) {
                await useVaultStore.getState().initialize()
            }
        }

        const data: Record<string, unknown> = {
            version: '2.0.0',
            exportedAt: new Date().toISOString(),
            manifests: manifestMap,
            accounts: exportedAccounts,
            profiles: useProfileStore.getState().profiles.map((p) => ({
                ...p,
                createdAt: new Date(p.createdAt).toISOString(),
                updatedAt: new Date(p.updatedAt).toISOString(),
            })),
            identity: {
                name: (await import('@/store/syncStore')).useSyncStore.getState().auth.name,
            },
            addons: JSON.parse((await import('@/store/addonStore')).useAddonStore.getState().exportLibrary()),
            accountStates: (await import('@/store/addonStore')).useAddonStore.getState().accountStates,
            failover: {
                rules: (await import('@/store/failoverStore')).useFailoverStore.getState().rules,
                webhook: (await import('@/store/failoverStore')).useFailoverStore.getState().webhook
            },
            settings: readSyncedSettings(),
            changelog: store.getState().changelog.slice(0, 100),
            vault: useVaultStore.getState().keys,
            vaultTombstones: useVaultStore.getState().tombstones,
            watchEvents: (await import('@/store/watchEventStore')).useWatchEventStore.getState().events,
            watchSnapshot: (await import('@/store/watchEventStore')).useWatchEventStore.getState().snapshot,
            customThemes: (() => { try { return JSON.parse(localStorage.getItem('aio-custom-themes') || '[]') } catch { return [] } })(),
            accountTombstones: store.getState().tombstones,
        }

        return JSON.stringify(data, null, 2)
    } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to export accounts:', error)
        throw error
    }
}

export async function importAccounts(json: string, isSilent = false, mode: 'merge' | 'mirror' = 'merge', localDecryptionKey?: CryptoKey | null) {
    const store = await getStore()
    store.setState({ loading: true, error: null })
    let mutexReleases: Array<() => void> = []
    try {
        mutexReleases = await Promise.all(store.getState().accounts.map(a => acquireSyncMutex(a.id)))
        let data: Record<string, unknown>
        if (!json) throw new Error('No data provided to import')
        try {
            data = typeof json === 'object' ? (json as Record<string, unknown>) : JSON.parse(json) as Record<string, unknown>
        } catch (e) {
            throw new Error('Invalid JSON format for import')
        }

        const manifestMap = (data.manifests || {}) as Record<string, unknown>

        const { useAddonStore } = await import('@/store/addonStore')
        await useAddonStore.getState().importLibrary(data as Record<string, unknown>, mode === 'merge', false, true)

        if (data.accountStates) {
            await useAddonStore.getState().importAccountStates(data.accountStates as Record<string, import('@/types/saved-addon').AccountAddonState>)
        }

        const { useFailoverStore } = await import('@/store/failoverStore')
        await useFailoverStore.getState().importRules(data, mode)

        const { useProfileStore } = await import('@/store/profileStore')
        let scavengedProfiles = data.profiles || data['stremio-manager:profiles']
        if (scavengedProfiles && !Array.isArray(scavengedProfiles) && typeof scavengedProfiles === 'object') {
            scavengedProfiles = Object.values(scavengedProfiles)
        }
        if (Array.isArray(scavengedProfiles) && scavengedProfiles.length > 0) {
            await useProfileStore.getState().importProfiles(scavengedProfiles)
        }

        if (data.settings) {
            applySyncedSettings(data.settings, mode === 'mirror')
        }

        if (Array.isArray(data.customThemes) && data.customThemes.length > 0) {
            applySyncedSettings({ customThemes: data.customThemes }, true)
        }

        if (Array.isArray(data.accountTombstones)) {
            const local = store.getState().tombstones
            const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
            const tsMap = new Map<string, { id: string; deletedAt: number }>()
            ;[...(data.accountTombstones as { id: string; deletedAt: number }[]), ...local].forEach(t => {
                if (t.deletedAt < cutoff) return
                const existing = tsMap.get(t.id)
                if (!existing || t.deletedAt > existing.deletedAt) tsMap.set(t.id, t)
            })
            store.getState().saveTombstones(Array.from(tsMap.values()))
        }

        if (Array.isArray(data.vault) || Array.isArray(data.vaultTombstones)) {
            const { useVaultStore } = await import('@/store/vaultStore')
            await useVaultStore.getState().initialize()
            await useVaultStore.getState().importVault((data.vault || []) as import('@/types/vault').VaultKey[], (data.vaultTombstones || []) as import('@/store/vaultStore').VaultTombstone[])
        }

        if (Array.isArray(data.changelog) && data.changelog.length > 0) {
            const existing = store.getState().changelog
            const merged = [...data.changelog]
            for (const entry of existing) {
                if (!merged.find(e => e.id === entry.id)) merged.push(entry)
            }
            const sorted = merged.sort((a, b) =>
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            ).slice(0, 100)
            store.setState({ changelog: sorted })
            localforage.setItem(CHANGELOG_KEY, sorted).catch(e => { if (import.meta.env.DEV) console.error(e) })
        }

        if (Array.isArray(data.watchEvents) && data.watchEvents.length > 0) {
            const { useWatchEventStore } = await import('@/store/watchEventStore')
            const current = useWatchEventStore.getState().events
            const currentIds = new Set(current.map(e => e.id))
            const incomingEvents = data.watchEvents as Record<string, unknown>[]
            const newEvents = incomingEvents.filter((e) => !currentIds.has(e.id as string))
            if (newEvents.length > 0) {
                const merged = [...current, ...newEvents] as Record<string, unknown>[]
                const deduped = Array.from(new Map(merged.map((e) => [e.id as string, e])).values())
                const sorted = deduped.sort((a, b) => ((b as Record<string, unknown>).event_ts as number) - ((a as Record<string, unknown>).event_ts as number))
                const snapshot = data.watchSnapshot || useWatchEventStore.getState().snapshot
                useWatchEventStore.getState().initialize(sorted as unknown as import('@/types/activity').WatchEvent[], snapshot as Record<string, Record<string, import('@/types/activity').SnapshotItem>>)
            }
        }

        let accountsToImport = data.accounts || []
        if (!Array.isArray(accountsToImport) && typeof accountsToImport === 'object') {
            accountsToImport = (accountsToImport as Record<string, unknown>).accounts as unknown[] || []
        }

        if (!Array.isArray(accountsToImport)) accountsToImport = []

        const normalizedAccounts = (accountsToImport as Record<string, unknown>[]).map((acc) => {
            return {
                id: (acc.id as string) || safeUUID(),
                name: (acc.name as string) || 'Imported Account',
                email: acc.email as string,
                rawKey: (acc.authKey as string) || '',
                password: acc.password as string | undefined,
                note: acc.note as string | undefined,
                profiles: acc.profiles as import('@/types/account').AccountProfile[] | undefined,
                activeProfileId: acc.activeProfileId as string | undefined,
                deletedAddons: acc.deletedAddons as Record<string, number> | undefined,
                addons: Array.isArray(acc.addons)
                    ? (acc.addons as Record<string, unknown>[]).map((ad: Record<string, unknown>) => ({
                        transportUrl: String(ad.transportUrl || ''),
                        transportName: ad.transportName as string | undefined,
                        manifestId: String(ad.manifestId || ''),
                        installedAt: ad.installedAt as string | undefined,
                        flags: ad.flags as AddonDescriptor['flags'],
                        note: typeof ad.note === 'string' ? ad.note.slice(0, 10000) : undefined,
                        metadata: ad.metadata as AddonDescriptor['metadata'],
                        catalogOverrides: ad.catalogOverrides as AddonDescriptor['catalogOverrides'],
                        syncToLibrary: ad.syncToLibrary as boolean | undefined,
                        manifest: sanitizeAddonManifest((ad.manifest || manifestMap[ad.manifestId as string]) as AddonManifest, ad.transportUrl as string | undefined),
                    }))
                    : [],
                accentColor: acc.accentColor as string | undefined,
                emoji: acc.emoji as string | undefined,
                connections: acc.connections as Partial<Connection>[] | undefined,
                primaryConnectionId: acc.primaryConnectionId as string | undefined,
                hideLastWatched: acc.hideLastWatched as boolean | undefined,
                apiKey: acc.apiKey as string | undefined,
                lastSync: new Date(),
                status: 'active' as const,
            }
        })

        const readEncryptionKey = localDecryptionKey ?? getEncryptionKey()
        const writeEncryptionKey = getEncryptionKey()
        const currentAccounts = [...store.getState().accounts]

        const localDecrypted = await Promise.all(
            currentAccounts.map(async (acc) => {
                let password: string | undefined
                try {
                    if (acc.password) password = await decrypt(acc.password, readEncryptionKey)
                } catch {
                    password = undefined
                }
                try {
                    return { id: acc.id, key: await decrypt(acc.authKey, readEncryptionKey), password }
                } catch (e) {
                    return { id: acc.id, key: null, password }
                }
            })
        )
        const localSecretsById = new Map(localDecrypted.map((entry) => [entry.id, entry]))

        const migrateLocalAccountSecrets = async (account: StremioAccount): Promise<StremioAccount> => {
            if (!localDecryptionKey) return account
            const secrets = localSecretsById.get(account.id)
            if (!secrets?.key) return account
            return {
                ...account,
                authKey: await encrypt(secrets.key, writeEncryptionKey),
                password: secrets.password ? await encrypt(secrets.password, writeEncryptionKey) : account.password,
            }
        }

        const reconciledAccounts: StremioAccount[] = []
        const processedLocalIds = new Set<string>()
        const tombstoneIds = new Set(store.getState().tombstones.map(t => t.id))

        for (const ra of normalizedAccounts) {
            if (tombstoneIds.has(ra.id)) continue
            let matchedAccount = currentAccounts.find((a) => a.id === ra.id)

            if (!matchedAccount && ra.rawKey) {
                const found = localDecrypted.find((ld) => ld.key === ra.rawKey && !tombstoneIds.has(ld.id))
                if (found) matchedAccount = currentAccounts.find((a) => a.id === found.id)
            }

            if (!matchedAccount && ra.email) {
                matchedAccount = currentAccounts.find(
                    (a) => a.email?.toLowerCase() === ra.email?.toLowerCase()
                )
            }

            if (matchedAccount) {
                const matchedSecrets = localSecretsById.get(matchedAccount.id)
                const mergedAuthKey = ra.rawKey || matchedSecrets?.key
                const mergedPassword = ra.password !== undefined ? ra.password : matchedSecrets?.password
                const updated: StremioAccount = {
                    ...matchedAccount,
                    name: ra.name || matchedAccount.name,
                    authKey: mergedAuthKey
                        ? await encrypt(mergedAuthKey, writeEncryptionKey)
                        : matchedAccount.authKey,
                    password: mergedPassword
                        ? await encrypt(mergedPassword, writeEncryptionKey)
                        : matchedAccount.password,
                    accentColor: ra.accentColor || matchedAccount.accentColor,
                    emoji: ra.emoji || matchedAccount.emoji,
                    note: ra.note ?? matchedAccount.note,
                    hideLastWatched: ra.hideLastWatched ?? matchedAccount.hideLastWatched,
                    apiKey: ra.apiKey ?? matchedAccount.apiKey,
                    profiles: matchedAccount.profiles?.length ? matchedAccount.profiles : (ra.profiles?.length ? ra.profiles : matchedAccount.profiles),
                    activeProfileId: matchedAccount.activeProfileId ?? ra.activeProfileId,
                    ...(() => {
                        // Union both devices' tombstones, suppress resurrected addons (a delete on
                        // either device wins), then self-heal the set against the merged result.
                        const tombstones = mergeTombstones(matchedAccount.deletedAddons, ra.deletedAddons)
                        const mergedAddons = mode === 'mirror'
                            ? filterResurrected(ra.addons, [], tombstones)
                            : mergeAddons(matchedAccount.addons, filterResurrected(ra.addons, matchedAccount.addons, tombstones))
                        return { addons: mergedAddons, deletedAddons: reconcileTombstones(tombstones, mergedAddons) }
                    })(),
                    connections: mergeConnections(matchedAccount.connections, ra.connections, mode) ?? matchedAccount.connections,
                    primaryConnectionId: ra.primaryConnectionId ?? matchedAccount.primaryConnectionId,
                    lastSync: ra.lastSync || new Date(),
                    status: 'active' as const,
                }
                reconciledAccounts.push(updated)
                processedLocalIds.add(matchedAccount.id)
            } else {
                const importedTombstones = mergeTombstones(undefined, ra.deletedAddons)
                const importedAddons = filterResurrected(ra.addons, [], importedTombstones)
                const importedAccount = {
                    ...ra,
                    addons: importedAddons,
                    deletedAddons: reconcileTombstones(importedTombstones, importedAddons),
                    authKey: await encrypt(ra.rawKey, writeEncryptionKey),
                    password: ra.password ? await encrypt(ra.password, writeEncryptionKey) : undefined,
                    connections: mergeConnections(undefined, ra.connections, mode),
                } as StremioAccount
                reconciledAccounts.push(importedAccount)
            }
        }

        const localOnlyAccounts =
            mode === 'mirror'
                ? []
                : await Promise.all(
                    currentAccounts
                        .filter((a) => !processedLocalIds.has(a.id))
                        .map(migrateLocalAccountSecrets)
                )

        if (mode === 'mirror') {
            var finalAccounts = reconciledAccounts
        } else {
            const reconciledById = new Map(reconciledAccounts.map(a => [a.id, a]))
            const localById = new Map(localOnlyAccounts.map(a => [a.id, a]))
            const seenIds = new Set<string>()
            const ordered: typeof currentAccounts = []
            for (const existing of currentAccounts) {
                const id = existing.id
                seenIds.add(id)
                const reconciled = reconciledById.get(id)
                const local = localById.get(id)
                if (reconciled) ordered.push(reconciled)
                else if (local) ordered.push(local)
                else ordered.push(existing)
            }
            for (const acc of reconciledAccounts) {
                if (!seenIds.has(acc.id)) { ordered.push(acc); seenIds.add(acc.id) }
            }
            for (const acc of localOnlyAccounts) {
                if (!seenIds.has(acc.id)) { ordered.push(acc); seenIds.add(acc.id) }
            }
            var finalAccounts = ordered
        }

        if (currentAccounts.length > 0 && finalAccounts.length < currentAccounts.length) {
            if (import.meta.env.DEV) console.warn(`[Import] Would reduce accounts from ${currentAccounts.length} to ${finalAccounts.length}. Aborting write and pushing local state.`)
            setTimeout(() => triggerSync(), 500)
            store.setState({ loading: false })
            return
        }

        if (finalAccounts.length === 0) {
            const backup = await localforage.getItem<StremioAccount[]>(BACKUP_KEY)
            if (backup && backup.length > 0) {
                if (import.meta.env.DEV) console.warn(`[Import] Final accounts would be empty but backup has ${backup.length}. Restoring from backup.`)
                const restoredBackup = localDecryptionKey
                    ? await Promise.all(backup.map(async (account) => {
                        try {
                            const rawAuthKey = await decrypt(account.authKey, readEncryptionKey)
                            const rawPassword = account.password ? await decrypt(account.password, readEncryptionKey).catch(() => undefined) : undefined
                            return {
                                ...account,
                                authKey: await encrypt(rawAuthKey, writeEncryptionKey),
                                password: rawPassword ? await encrypt(rawPassword, writeEncryptionKey) : account.password,
                            }
                        } catch {
                            return account
                        }
                    }))
                    : backup
                store.setState({ accounts: restoredBackup })
                await localforage.setItem(STORAGE_KEY, restoredBackup)
                setTimeout(() => triggerSync(), 500)
                store.setState({ loading: false })
                return
            }
        }

        if (finalAccounts.length > 0) {
            const diskData = await localforage.getItem<StremioAccount[]>(STORAGE_KEY)
            if (diskData && Array.isArray(diskData) && diskData.length > 0) {
                await localforage.setItem(BACKUP_KEY, diskData)
            }
        }

        const apiKeysMap = data.apiKeys as Record<string, string> | undefined
        if (apiKeysMap && typeof apiKeysMap === 'object') {
            finalAccounts = finalAccounts.map(a => ({
                ...a,
                apiKey: apiKeysMap[a.id] || a.apiKey,
            }))
        }

        store.setState({ accounts: finalAccounts })
        persistAccounts(finalAccounts)

        if (!isSilent) {
            triggerSync()
            toast({ title: 'Import Successful' })
        }
        store.getState().syncAllAccounts().catch(e => { if (import.meta.env.DEV) console.error(e) })
    } catch (error) {
        store.setState({ error: (error as Error).message })
        throw error
    } finally {
        mutexReleases.forEach(release => release())
        store.setState({ loading: false })
    }
}
