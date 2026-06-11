import { create } from 'zustand'
import { useAccountStore, persistAccounts, acquireSyncMutex } from './accountStore'
import { getConnectionStates } from '@/api/connection'
import type { Connection, ConnectionStatus } from '@/types/connection'
import type { StremioAccount } from '@/types/account'
import { toast } from '@/hooks/use-toast'

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

    addConnection: (accountId: string, connection: Omit<Connection, 'id' | 'lastSync' | 'lastKnownAddonCount' | 'consecutiveFailures'>) => void
    removeConnection: (accountId: string, connectionId: string) => void
    updateConnection: (accountId: string, connectionId: string, updates: Partial<Connection>) => void
    setPrimaryConnection: (accountId: string, connectionId: string) => void
    toggleConnection: (accountId: string, connectionId: string) => void
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

// Holds the per-account mutex so a connection-CRUD write can't be clobbered by an in-flight addon
// op that snapshotted the account before its await. Re-reads accounts inside the lock.
async function updateAccount(accountId: string, updater: (account: StremioAccount) => StremioAccount) {
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

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
    connectionStates: {},
    isSyncing: null,

    addConnection: async (accountId, partial) => {
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
        }

        if (connection.connectionType === 'hydra-outbound' && connection.credentials?.apiKey) {
            const { storeConnectionCredential } = await import('@/api/hydra-providers')
            storeConnectionCredential(accountId, connection.id, connection.credentials.apiKey, 'hydra').catch(() => {})
        }

        if (connection.platform === 'nuvio' && connection.credentials?.accessToken) {
            const { storeConnectionCredential } = await import('@/api/hydra-providers')
            const bundle = {
                accessToken: connection.credentials.accessToken,
                refreshToken: connection.credentials.refreshToken,
                expiresAt: connection.credentials.expiresAt,
                profileId: connection.credentials.profileId || null,
            }
            await storeConnectionCredential(accountId, connection.id, bundle, 'nuvio').catch(() => {})
        }

        if (connection.platform === 'realstream' && connection.credentials?.accessToken) {
            const { storeConnectionCredential } = await import('@/api/hydra-providers')
            const bundle = {
                accessToken: connection.credentials.accessToken,
                userId: connection.credentials.userId || null,
                expiresAt: connection.credentials.expiresAt,
                baseUrl: connection.credentials.baseUrl || null,
                // email+password stored server-encrypted at rest so the server can re-authenticate silently
                // if the token expires while the app is closed (full server-side custody).
                email: connection.credentials.email || null,
                password: connection.credentials.password || null,
            }
            await storeConnectionCredential(accountId, connection.id, bundle, 'realstream').catch(() => {})
        }

        await updateAccount(accountId, account => ({
            ...account,
            connections: [...(account.connections || []), connection],
            primaryConnectionId: account.primaryConnectionId || connection.id,
        }))

        toast({ title: `${connection.platform} connection added` })

        if (connection.enabled) {
            import('./accountStore').then(({ useAccountStore }) => {
                useAccountStore.getState().syncAccount(accountId).catch(() => {})
            })
        }
    },

    removeConnection: async (accountId, connectionId) => {
        const { accounts } = useAccountStore.getState()
        const account = accounts.find(a => a.id === accountId)
        const conn = account?.connections?.find(c => c.id === connectionId)
        if (conn?.connectionType === 'hydra-outbound' || conn?.platform === 'nuvio' || conn?.platform === 'realstream') {
            import('@/api/hydra-providers').then(({ deleteConnectionCredential }) => {
                deleteConnectionCredential(accountId, connectionId).catch(() => {})
            })
        }
        await updateAccount(accountId, account => {
            const connections = (account.connections || []).filter(c => c.id !== connectionId)
            const primaryConnectionId = account.primaryConnectionId === connectionId
                ? connections[0]?.id
                : account.primaryConnectionId
            return { ...account, connections, primaryConnectionId }
        })
    },

    updateConnection: async (accountId, connectionId, updates) => {
        await updateAccount(accountId, account => ({
            ...account,
            connections: (account.connections || []).map(c =>
                c.id === connectionId ? { ...c, ...updates } : c
            ),
        }))
    },

    setPrimaryConnection: async (accountId, connectionId) => {
        await updateAccount(accountId, account => ({
            ...account,
            primaryConnectionId: connectionId,
        }))
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
        if (wasEnabled === false) {
            // Debounced: rapid connection toggles coalesce into a single sync round.
            import('./account/accountSync').then(({ scheduleSyncAccount }) => {
                scheduleSyncAccount(accountId)
            })
        }
    },

    syncConnections: async (accountId) => {
        if (get().isSyncing === accountId) return
        set({ isSyncing: accountId })

        try {
            const { useAccountStore } = await import('./accountStore')
            await useAccountStore.getState().syncAccount(accountId)
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
        } catch { /* best-effort refresh; stale states are acceptable */ }
    },
}))
