import { create } from 'zustand'
import { useAccountStore, persistAccounts, acquireSyncMutex } from './accountStore'
import { getConnectionStates } from '@/api/connection'
import type { Connection, ConnectionStatus } from '@/types/connection'
import { isAddonConnection } from '@/types/connection'
import type { Account } from '@/types/account'
import { toast } from '@/hooks/use-toast'
import { triggerSync } from '@/lib/sync-trigger'

interface ConnectionStateEntry {
    consecutiveFailures: number
    lastError: string | null
    lastErrorAt: number | null
    lastSync: number
    status: ConnectionStatus
    skipCyclesRemaining: number
}

interface ConnectionStore {
    connectionStates: Record<string, Record<string, ConnectionStateEntry>>
    isSyncing: string | null

    addConnection: (accountId: string, connection: Omit<Connection, 'id' | 'lastSync' | 'lastKnownAddonCount' | 'consecutiveFailures'>) => Promise<void>
    removeConnection: (accountId: string, connectionId: string) => Promise<void>
    updateConnection: (accountId: string, connectionId: string, updates: Partial<Connection>) => Promise<void>
    setPrimaryConnection: (accountId: string, connectionId: string) => Promise<void>
    toggleConnection: (accountId: string, connectionId: string) => Promise<void>
    syncConnections: (accountId: string) => Promise<void>
    refreshConnectionStates: (accountId: string) => Promise<void>
}

const safeUUID = () => {
    try { return crypto.randomUUID() } catch {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })
    }
}

async function updateAccount(accountId: string, updater: (account: Account) => Account) {
    const release = await acquireSyncMutex(accountId)
    try {
        const { accounts } = useAccountStore.getState()
        const updated = accounts.map(a => a.id === accountId ? updater(a) : a)
        useAccountStore.setState({ accounts: updated })
        persistAccounts(updated)
    } finally {
        release()
    }
}

// Fields that change the encrypted sync envelope. Background health writes
// (status/lastSync/error counters) must not re-push it; structural changes must.
const ENVELOPE_FIELDS = new Set([
    'platform', 'connectionType', 'driverType', 'enabled', 'credentials', 'profileMapping',
    'capabilities', 'pluginList', 'driverConfig', 'displayName', 'mediaServer',
])

const touchesEnvelope = (updates: Partial<Connection>) => Object.keys(updates).some(key => ENVELOPE_FIELDS.has(key))

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
    connectionStates: {},
    isSyncing: null,

    addConnection: async (accountId, partial) => {
        // Media credentials are sealed browser-only with no server-side copy, so the save
        // only counts when the account actually exists. Never toast success into a void.
        if (partial.platform === 'jellyfin' && !useAccountStore.getState().accounts.some(a => a.id === accountId)) {
            throw new Error('This account no longer exists. Reload and add the media connection again.')
        }
        const connection: Connection = {
            id: safeUUID(),
            platform: partial.platform,
            connectionType: partial.connectionType || partial.driverType || 'native',
            enabled: partial.enabled ?? true,
            status: partial.status ?? 'active',
            credentials: partial.credentials,
            profileMapping: partial.profileMapping,
            lastSync: 0,
            lastKnownAddonCount: 0,
            capabilities: partial.capabilities ?? ['addons'],
            consecutiveFailures: 0,
            pluginList: partial.pluginList,
            driverConfig: partial.driverConfig,
            displayName: partial.displayName,
            mediaServer: partial.mediaServer,
        }

        if (connection.platform !== 'jellyfin' && connection.connectionType === 'hydra-outbound' && connection.driverConfig?.baseUrl) {
            const { storeConnectionCredential } = await import('@/api/hydra-providers')
            const bundle = {
                authValue: connection.credentials?.apiKey || '',
                baseUrl: connection.driverConfig.baseUrl,
                authType: connection.driverConfig.authType,
                authHeader: connection.driverConfig.authHeader,
                enabled: connection.enabled,
            }
            storeConnectionCredential(accountId, connection.id, bundle, 'hydra').catch(() => {
                toast({ variant: 'destructive', title: 'Connection credential save failed', description: 'The connection will work until page reload.' })
            })
        }

        if (connection.platform === 'nuvio' && connection.credentials?.accessToken) {
            const { storeConnectionCredential } = await import('@/api/hydra-providers')
            const bundle = {
                accessToken: connection.credentials.accessToken,
                refreshToken: connection.credentials.refreshToken,
                expiresAt: connection.credentials.expiresAt,
                profileId: connection.credentials.profileId || null,
                baseUrl: connection.credentials?.baseUrl || null,
                publishableKey: connection.credentials?.publishableKey || null,
            }
            await storeConnectionCredential(accountId, connection.id, bundle, 'nuvio').catch(() => {
                toast({ variant: 'destructive', title: 'Connection credential save failed', description: 'The connection will work until page reload.' })
            })
        }

        if (connection.platform === 'realstream' && connection.credentials?.accessToken) {
            const { storeConnectionCredential } = await import('@/api/hydra-providers')
            const bundle = {
                accessToken: connection.credentials.accessToken,
                userId: connection.credentials.userId || null,
                expiresAt: connection.credentials.expiresAt,
                baseUrl: connection.credentials.baseUrl || null,
                email: connection.credentials.email || null,
                password: connection.credentials.password || null,
            }
            await storeConnectionCredential(accountId, connection.id, bundle, 'realstream').catch(() => {
                toast({ variant: 'destructive', title: 'Connection credential save failed', description: 'The connection will work until page reload.' })
            })
        }

        let duplicateFound = false
        let duplicateId = ''
        await updateAccount(accountId, account => {
            const existing = partial.platform === 'jellyfin' ? undefined : (account.connections || []).find(c => c.platform === partial.platform)
            if (existing) {
                duplicateFound = true
                duplicateId = existing.id
                return account
            }
            return {
                ...account,
                connections: [...(account.connections || []), connection],
                primaryConnectionId: account.primaryConnectionId || (isAddonConnection(connection) ? connection.id : undefined),
            }
        })
        if (duplicateFound) {
            const { invalidateConnectionCache } = await import('@/lib/connection-discovery')
            invalidateConnectionCache(duplicateId)
            const { updateConnection } = get()
            updateConnection(accountId, duplicateId, { ...partial, status: 'active' })
            return
        }

        if (connection.platform === 'jellyfin'
            && !useAccountStore.getState().accounts.find(a => a.id === accountId)?.connections?.some(c => c.id === connection.id)) {
            throw new Error('This account no longer exists. Reload and add the media connection again.')
        }

        toast({ title: `${connection.platform} connection added` })

        // Structural connection changes belong in the encrypted sync envelope. Media
        // connections never enter the addon reconciliation below (isAddonConnection).
        triggerSync()

        if (connection.enabled && isAddonConnection(connection)) {
            import('./accountStore').then(({ useAccountStore }) => {
                useAccountStore.getState().syncAccount(accountId).catch(() => {})
            })
        }
    },

    removeConnection: async (accountId, connectionId) => {
        const { accounts } = useAccountStore.getState()
        const account = accounts.find(a => a.id === accountId)
        const conn = account?.connections?.find(c => c.id === connectionId)
        if (conn?.platform !== 'jellyfin' && (conn?.connectionType === 'hydra-outbound' || conn?.platform === 'nuvio' || conn?.platform === 'realstream')) {
            import('@/api/hydra-providers').then(({ deleteConnectionCredential }) => {
                deleteConnectionCredential(accountId, connectionId).catch(() => {})
            })
        }
        const { invalidateConnectionCache } = await import('@/lib/connection-discovery')
        invalidateConnectionCache(connectionId)
        const isStremioRemoval = conn?.platform === 'stremio' || connectionId === `${accountId}:stremio`
        await updateAccount(accountId, account => {
            const connections = (account.connections || []).filter(c => c.id !== connectionId)
            const primaryConnectionId = account.primaryConnectionId === connectionId
                ? connections.find(isAddonConnection)?.id
                : account.primaryConnectionId
            return {
                ...account,
                connections,
                primaryConnectionId,
                ...(isStremioRemoval ? { authKey: '' } : {}),
            }
        })
        if (conn) triggerSync()
    },

    updateConnection: async (accountId, connectionId, updates) => {
        let matched = false
        await updateAccount(accountId, account => ({
            ...account,
            connections: (account.connections || []).map(c => {
                if (c.id !== connectionId) return c
                matched = true
                return { ...c, ...updates }
            }),
        }))
        if (!matched && (updates.mediaServer || updates.credentials?.jellyfin)) {
            throw new Error('This media connection no longer exists. Add a new connection instead.')
        }
        if (matched && touchesEnvelope(updates)) triggerSync()
    },

    setPrimaryConnection: async (accountId, connectionId) => {
        let changed = false
        await updateAccount(accountId, account => {
            const primaryConnectionId = account.connections?.some(c => c.id === connectionId && isAddonConnection(c))
                ? connectionId : account.primaryConnectionId
            changed = primaryConnectionId !== account.primaryConnectionId
            return { ...account, primaryConnectionId }
        })
        if (changed) triggerSync()
    },

    toggleConnection: async (accountId, connectionId) => {
        let wasEnabled: boolean | undefined
        await updateAccount(accountId, account => {
            wasEnabled = account.connections?.find(c => c.id === connectionId)?.enabled
            return {
                ...account,
                connections: (account.connections || []).map(c =>
                    c.id === connectionId ? { ...c, enabled: !c.enabled } : c
                ),
            }
        })
        const toggled = useAccountStore.getState().accounts.find(a => a.id === accountId)?.connections?.find(c => c.id === connectionId)
        if (toggled?.platform !== 'jellyfin' && toggled?.connectionType === 'hydra-outbound' && toggled.driverConfig?.baseUrl) {
            const { storeConnectionCredential } = await import('@/api/hydra-providers')
            storeConnectionCredential(accountId, connectionId, {
                authValue: toggled.credentials?.apiKey || '',
                baseUrl: toggled.driverConfig.baseUrl,
                authType: toggled.driverConfig.authType,
                authHeader: toggled.driverConfig.authHeader,
                enabled: toggled.enabled,
            }, 'hydra').catch(() => {})
        }
        // The enabled flag is part of the encrypted envelope for every platform.
        if (toggled) triggerSync()
        if (wasEnabled === false && toggled && isAddonConnection(toggled)) {
            try {
                const acct = useAccountStore.getState().accounts.find(a => a.id === accountId)
                if (acct) {
                    const { discoverFromConnections } = await import('@/lib/connection-discovery')
                    const { discovered } = await discoverFromConnections(acct, accountId)
                    const urls = discovered.filter(d => d.connectionId === connectionId).map(d => d.transportUrl)
                    if (urls.length > 0) {
                        const { reconcileTombstones } = await import('@/lib/addon-tombstones')
                        await updateAccount(accountId, account => ({
                            ...account,
                            deletedAddons: reconcileTombstones(account.deletedAddons, urls.map(u => ({ transportUrl: u }))),
                        }))
                    }
                }
            } catch {}
            import('./account/accountSync').then(({ scheduleSyncAccount }) => {
                scheduleSyncAccount(accountId)
            })
            import('./account/accountAddonOps').then(({ pushToConnections }) => {
                pushToConnections(accountId).catch(() => {})
            })
        }
    },

    syncConnections: async (accountId) => {
        if (get().isSyncing === accountId) return
        set({ isSyncing: accountId })

        try {
            const { useAccountStore } = await import('./accountStore')
            await useAccountStore.getState().syncAccount(accountId, true)
            await get().refreshConnectionStates(accountId)
            const { useSyncStore } = await import('./syncStore')
            useSyncStore.setState({ lastSyncedAt: new Date().toISOString() })
        } catch (err) {
            toast({ title: 'Sync failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' })
        } finally {
            set({ isSyncing: null })
        }
    },

    refreshConnectionStates: async (accountId) => {
        try {
            const states = await getConnectionStates(accountId)
            set(state => ({
                connectionStates: {
                    ...state.connectionStates,
                    [accountId]: states,
                },
            }))
        } catch {}
    },
}))
