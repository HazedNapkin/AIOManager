import { resilientFetch } from '@/lib/api-resilience'
import { useSyncStore } from '@/store/syncStore'
import { deriveSyncToken } from '@/lib/crypto'
import type { Connection } from '@/types/connection'
import type { AddonDescriptor } from '@/types/addon'

async function getAuthHeaders(): Promise<Record<string, string>> {
    const { auth } = useSyncStore.getState()
    if (!auth?.id || !auth?.password) throw new Error('Not authenticated')
    return {
        'Content-Type': 'application/json',
        'x-sync-user': auth.id,
        'x-sync-password': await deriveSyncToken(auth.password),
    }
}

function getServerUrl(): string {
    return useSyncStore.getState().serverUrl || '/api'
}

export interface ReconcileResult {
    synced: boolean
    changes: Array<{
        type: 'addition' | 'removal_primary' | 'restore'
        url: string
        platform: string
        primary: boolean
    }>
    connectionStates: Record<string, ConnectionState>
}

export interface ConnectionState {
    consecutiveFailures: number
    lastError: string | null
    lastErrorAt: number | null
    lastSync: number
    status: 'active' | 'expired' | 'error' | 'degraded'
    skipCyclesRemaining: number
}

export async function triggerReconciliation(
    accountId: string,
    primaryConnectionId?: string,
    connections?: Connection[],
    addons?: AddonDescriptor[],
    options?: { allowCollectionShrink?: boolean },
): Promise<ReconcileResult> {
    const base = getServerUrl().replace(/\/+$/, '')
    const sanitizedConnections = connections?.map(({ credentials: _creds, ...rest }) => rest)
    const res = await resilientFetch(`${base}/providers/sync/${accountId}`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ primaryConnectionId, connections: sanitizedConnections, addons, allowCollectionShrink: options?.allowCollectionShrink === true }),
        timeout: 30000,
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(body.error || `Sync failed (${res.status})`)
    }
    return res.json()
}

export async function fetchConnectionToken(
    accountId: string,
    connectionId: string,
    platform: string,
): Promise<{ accessToken: string; expiresAt: number; profileId: string | null }> {
    const base = getServerUrl().replace(/\/+$/, '')
    const res = await resilientFetch(`${base}/providers/connections/${connectionId}/token`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ accountId, platform }),
        timeout: 10000,
    })
    if (!res.ok) {
        const err = new Error(res.status === 401 ? 'Session expired, re-authenticate this connection' : `Token fetch failed (${res.status})`)
        ;(err as { isAuthError?: boolean }).isAuthError = res.status === 401
        throw err
    }
    return res.json()
}

export async function setConnectionProfile(
    connectionId: string,
    profileId: string,
): Promise<void> {
    const base = getServerUrl().replace(/\/+$/, '')
    const res = await resilientFetch(`${base}/providers/connections/${connectionId}/profile`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ profileId }),
        timeout: 15000,
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(body.error || `Profile switch failed (${res.status})`)
    }
}

export async function getConnectionStates(accountId: string): Promise<Record<string, ConnectionState>> {
    const base = getServerUrl().replace(/\/+$/, '')
    const res = await resilientFetch(`${base}/providers/status/${accountId}`, {
        headers: await getAuthHeaders(),
        timeout: 10000,
    })
    if (res.status === 401) {
        const err = new Error('Session expired')
        ;(err as { isAuthError?: boolean }).isAuthError = true
        throw err
    }
    if (!res.ok) return {}
    const body = await res.json()
    return body.connectionStates || {}
}
