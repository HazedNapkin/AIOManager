import { create } from 'zustand'
import { useAccountStore, persistAccounts, acquireSyncMutex } from './accountStore'
import { getConnectionStates } from '@/api/connection'
import type { Connection, ConnectionStatus } from '@/types/connection'
import { isAddonConnection } from '@/types/connection'
import type { Account } from '@/types/account'
import { toast } from '@/hooks/use-toast'
import { triggerSync } from '@/lib/sync-trigger'
import { canApplyMediaReadFailure, type MediaReadSession } from '@/lib/jellyfin/connection-health'
import { stremioAuthKeyMirrorAfterRemoval, stremioConnectionsOf } from '@/lib/connection-identity'
import { noteStremioCanonicalRepoint, noteStremioLoginsRemoved } from '@/lib/stremio-repoint'

/**
 * Canonical Stremio identity transitions: returns the demoted canonical connection id
 * (native stored logins only — a legacy authKey-only account has no identity to move)
 * so the caller can migrate the demoted login's bare-scope history and notify the server.
 * The canonical "changed" only when a DIFFERENT stored login takes it over.
 */
function demotedStremioCanonical(account: Account, nextPrimaryConnectionId: string | undefined, removedConnectionId?: string): string | undefined {
    const nativeLogins = stremioConnectionsOf(account.connections).filter(c => c.id !== removedConnectionId)
    const prevCanonicalId = stremioConnectionsOf(account.connections)
        .find(c => c.id === account.primaryConnectionId)?.id
        ?? stremioConnectionsOf(account.connections)[0]?.id
    if (!prevCanonicalId) return undefined
    if (prevCanonicalId === removedConnectionId) {
        // Removal-promotion: the demoted login is the removed canonical itself.
        return nativeLogins.length > 0 ? prevCanonicalId : undefined
    }
    const nextCanonicalId = nativeLogins.find(c => c.id === nextPrimaryConnectionId)?.id
    return nextCanonicalId && nextCanonicalId !== prevCanonicalId ? prevCanonicalId : undefined
}

function applyStremioCanonicalTransition(accountId: string, demotedConnectionId: string | undefined, promotedConnectionId: string | undefined, loginsRemaining: number, removedCanonicalConnectionId?: string) {
    if (demotedConnectionId) {
        import('./watchEventStore').then(({ useWatchEventStore }) => {
            useWatchEventStore.getState().migrateCanonicalScope(accountId, demotedConnectionId, promotedConnectionId)
        }).catch(() => { })
        noteStremioCanonicalRepoint(accountId, demotedConnectionId)
    } else if (loginsRemaining === 0) {
        noteStremioLoginsRemoved(accountId, removedCanonicalConnectionId)
    }
}

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

    addConnection: (accountId: string, connection: Omit<Connection, 'id' | 'lastSync' | 'lastKnownAddonCount' | 'consecutiveFailures'>, options?: { assertCurrent?: () => void }) => Promise<void>
    removeConnection: (accountId: string, connectionId: string) => Promise<void>
    updateConnection: (accountId: string, connectionId: string, updates: Partial<Connection>, mediaReadSession?: MediaReadSession) => Promise<void>
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

async function updateAccount(accountId: string, updater: (account: Account) => Account, assertCurrent?: () => void) {
    const release = await acquireSyncMutex(accountId)
    try {
        assertCurrent?.()
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

    addConnection: async (accountId, partial, options) => {
        options?.assertCurrent?.()
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

        if (connection.platform === 'stremio' && connection.credentials?.authKey) {
            // A login added right after a last-login removal must never let the pending
            // removal revoke it: convert the unsynced note into a re-point (migrate the
            // old history) before this login's first credential sync.
            const { convertPendingLoginsRemovedToRepoint } = await import('@/lib/stremio-repoint')
            convertPendingLoginsRemovedToRepoint(accountId)
        }

        await updateAccount(accountId, account => {
            // Multiplicity: every completed sign-in appends its own connection, so one
            // local account can manage several remote logins on the same platform. The
            // canonical addon connection is never displaced — the first addon
            // connection stays primary and later logins bind as secondaries.
            return {
                ...account,
                connections: [...(account.connections || []), connection],
                primaryConnectionId: account.primaryConnectionId || (isAddonConnection(connection) ? connection.id : undefined),
            }
        }, options?.assertCurrent)
        options?.assertCurrent?.()

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
        // Stremio removals delete the per-connection server row too (the canonical
        // account-level row has no connection id, so it is never caught by this delete —
        // the next credentials sync re-points it at the surviving canonical login).
        if (conn?.platform !== 'jellyfin' && (conn?.connectionType === 'hydra-outbound' || conn?.platform === 'nuvio' || conn?.platform === 'realstream' || conn?.platform === 'stremio')) {
            import('@/api/hydra-providers').then(({ deleteConnectionCredential }) => {
                deleteConnectionCredential(accountId, connectionId).catch(() => {})
            })
        }
        const { invalidateConnectionCache } = await import('@/lib/connection-discovery')
        invalidateConnectionCache(connectionId)
        const isStremioRemoval = conn?.platform === 'stremio' || connectionId === `${accountId}:stremio`
        // Canonical transition (removal-promotion): compute BEFORE the state update so
        // the previous canonical is still visible, apply AFTER it succeeded.
        const survivingConnections = (account?.connections || []).filter(c => c.id !== connectionId)
        const demotedId = isStremioRemoval && account
            ? demotedStremioCanonical(account, survivingConnections.find(isAddonConnection)?.id, connectionId)
            : undefined
        const promotedId = demotedId && survivingConnections.some(c => c.platform === 'stremio')
            ? (survivingConnections.find(c => c.id === account?.primaryConnectionId)?.platform === 'stremio'
                ? survivingConnections.find(c => c.id === account?.primaryConnectionId)?.id
                : stremioConnectionsOf(survivingConnections)[0]?.id)
            : undefined
        let loginsRemaining = -1
        await updateAccount(accountId, account => {
            const connections = (account.connections || []).filter(c => c.id !== connectionId)
            const primaryConnectionId = account.primaryConnectionId === connectionId
                ? connections.find(isAddonConnection)?.id
                : account.primaryConnectionId
            if (isStremioRemoval) loginsRemaining = stremioConnectionsOf(connections).length
            return {
                ...account,
                connections,
                primaryConnectionId,
                // account.authKey is the legacy mirror of the CANONICAL Stremio login:
                // unlinking a secondary login must not clear it, and unlinking the
                // canonical one re-points it at the surviving canonical login instead
                // of orphaning the account's session.
                ...(isStremioRemoval ? {
                    authKey: stremioAuthKeyMirrorAfterRemoval({
                        connections: account.connections,
                        removedConnectionId: connectionId,
                        primaryConnectionId,
                        previousAuthKey: account.authKey,
                    }),
                } : {}),
            }
        })
        if (isStremioRemoval && loginsRemaining >= 0) {
            const removedCanonicalId = account?.primaryConnectionId === connectionId || demotedId === connectionId
                ? connectionId
                : stremioConnectionsOf(account?.connections || []).find(c => c.id === account?.primaryConnectionId)?.id ?? stremioConnectionsOf(account?.connections || [])[0]?.id
            applyStremioCanonicalTransition(accountId, demotedId, promotedId, loginsRemaining, removedCanonicalId)
        }
        if (conn) triggerSync()
    },

    updateConnection: async (accountId, connectionId, updates, mediaReadSession) => {
        let matched = false
        await updateAccount(accountId, account => ({
            ...account,
            connections: (account.connections || []).map(c => {
                if (c.id !== connectionId) return c
                if (mediaReadSession && !canApplyMediaReadFailure(c, mediaReadSession)) return c
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
        const accountBefore = useAccountStore.getState().accounts.find(a => a.id === accountId)
        let demotedId: string | undefined
        await updateAccount(accountId, account => {
            const primaryConnectionId = account.connections?.some(c => c.id === connectionId && isAddonConnection(c))
                ? connectionId : account.primaryConnectionId
            changed = primaryConnectionId !== account.primaryConnectionId
            return { ...account, primaryConnectionId }
        })
        if (changed && accountBefore && accountBefore.primaryConnectionId !== connectionId) {
            // Primary switched: if the stremio canonical moved to a different stored
            // login, migrate the demoted login's bare-scope history and notify the server.
            demotedId = demotedStremioCanonical(accountBefore, connectionId)
            const promotedIsStremio = stremioConnectionsOf(accountBefore.connections).some(c => c.id === connectionId)
            if (demotedId) applyStremioCanonicalTransition(accountId, demotedId, promotedIsStremio ? connectionId : undefined, stremioConnectionsOf(accountBefore.connections).length)
        }
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
            // Reconnecting is not an explicit reinstall of a deleted addon.
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
