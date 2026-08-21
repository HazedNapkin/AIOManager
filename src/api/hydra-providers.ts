import { resilientFetch } from '@/lib/api-resilience'
import { useSyncStore, getSyncApiPath } from '@/store/syncStore'
import { deriveSyncToken } from '@/lib/crypto'
import type { HydraStatus } from '@/types/provider'
import type { AddonDescriptor } from '@/types/addon'

export interface CanonicalEntry {
    addons: AddonDescriptor[]
    updatedAt: number
}

async function getAuthHeaders(): Promise<Record<string, string>> {
    const { auth } = useSyncStore.getState()
    return {
        'Content-Type': 'application/json',
        'x-sync-user': auth.id,
        'x-sync-password': await deriveSyncToken(auth.password),
    }
}

export async function testHydraEndpoint(
    baseUrl: string,
    authType: string,
    authHeader: string,
    authValue: string,
): Promise<HydraStatus> {
    const base = getSyncApiPath(useSyncStore.getState().serverUrl)
    const res = await resilientFetch(`${base}/providers/hydra/test`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ baseUrl, authType, authHeader, authValue }),
        timeout: 15000,
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(body.error || `Test failed (${res.status})`)
    }
    return res.json()
}

export async function storeConnectionCredential(
    accountId: string,
    connectionId: string,
    credential: string | Record<string, unknown>,
    credentialType?: string,
): Promise<void> {
    const base = getSyncApiPath(useSyncStore.getState().serverUrl)
    const res = await resilientFetch(`${base}/providers/connections/${connectionId}/credentials`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ accountId, credential, credentialType }),
        timeout: 10000,
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(body.error || 'Failed to store credentials')
    }
}

export async function nuvioAuth(
    email: string,
    password: string,
    publishableKey?: string,
    baseUrl?: string,
): Promise<{ tokens: { accessToken: string; refreshToken: string; expiresAt: number }; profiles: Array<{ id: string; name: string }> }> {
    const base = getSyncApiPath(useSyncStore.getState().serverUrl)
    const res = await resilientFetch(`${base}/providers/nuvio/auth`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ email, password, publishableKey, baseUrl }),
        timeout: 15000,
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(body.error || `Authentication failed (${res.status})`)
    }
    return res.json()
}

export async function realstreamAuth(
    email: string,
    password: string,
    baseUrl?: string,
): Promise<{ tokens: { accessToken: string; userId: string | null; expiresAt: number } }> {
    const base = getSyncApiPath(useSyncStore.getState().serverUrl)
    const res = await resilientFetch(`${base}/providers/realstream/auth`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ email, password, baseUrl }),
        timeout: 15000,
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(body.error || `Authentication failed (${res.status})`)
    }
    return res.json()
}

export async function nuvioSignup(
    email: string,
    password: string,
    publishableKey?: string,
    baseUrl?: string,
): Promise<{ tokens: { accessToken: string; refreshToken: string; expiresAt: number }; profiles: Array<{ id: string; name: string }> }> {
    const base = getSyncApiPath(useSyncStore.getState().serverUrl)
    const res = await resilientFetch(`${base}/providers/nuvio/signup`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ email, password, publishableKey, baseUrl }),
        timeout: 20000,
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(body.error || `Sign up failed (${res.status})`)
    }
    return res.json()
}

export async function realstreamSignup(
    email: string,
    password: string,
    name?: string,
    baseUrl?: string,
): Promise<{ tokens: { accessToken: string; userId: string | null; expiresAt: number } }> {
    const base = getSyncApiPath(useSyncStore.getState().serverUrl)
    const res = await resilientFetch(`${base}/providers/realstream/signup`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ email, password, name, baseUrl }),
        timeout: 20000,
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(body.error || `Sign up failed (${res.status})`)
    }
    return res.json()
}

let canonicalCache: { canonical: Record<string, CanonicalEntry>; serverStremioCredentialedAccounts: string[] | null; etag: string | null } | null = null

export function _clearCanonicalCache() {
    canonicalCache = null
}

export interface CanonicalFetchResult {
    canonical: Record<string, CanonicalEntry>
    serverStremioCredentialedAccounts: string[] | null
}

/**
 * Read the server-readable canonical addon lists this sync user owns, keyed by account,
 * plus which accounts the server can read via a stored Stremio credential. Used by the
 * inbound reconcile to detect external (e.g. AIOStreams) writes before a push.
 * Best-effort: returns empty values on any failure so it never blocks a sync.
 */
export async function fetchCanonical(): Promise<CanonicalFetchResult> {
    const base = getSyncApiPath(useSyncStore.getState().serverUrl)
    const headers = await getAuthHeaders()
    if (canonicalCache?.etag) headers['If-None-Match'] = canonicalCache.etag
    const res = await resilientFetch(`${base}/providers/canonical`, {
        headers,
        timeout: 10000,
    })
    if (res.status === 304 && canonicalCache) {
        return { canonical: canonicalCache.canonical, serverStremioCredentialedAccounts: canonicalCache.serverStremioCredentialedAccounts }
    }
    if (!res.ok) return { canonical: {}, serverStremioCredentialedAccounts: null }
    const body = await res.json().catch(() => ({}))
    const canonical = (body.canonical || {}) as Record<string, CanonicalEntry>
    const serverStremioCredentialedAccounts = Array.isArray(body.serverStremioCredentialedAccounts) ? body.serverStremioCredentialedAccounts as string[] : null
    canonicalCache = { canonical, serverStremioCredentialedAccounts, etag: res.headers.get('etag') }
    return { canonical, serverStremioCredentialedAccounts }
}

export interface HydraSubscriber {
    name: string
    logo: string | null
    created_at: number
    last_seen_at: number
}

export async function fetchSubscribers(accountId: string): Promise<HydraSubscriber[]> {
    const base = getSyncApiPath(useSyncStore.getState().serverUrl)
    const res = await resilientFetch(`${base}/providers/subscribers/${accountId}`, {
        headers: await getAuthHeaders(),
        timeout: 10000,
    })
    if (!res.ok) return []
    const body = await res.json().catch(() => ({}))
    return Array.isArray(body.subscribers) ? body.subscribers : []
}

export async function deleteSubscriber(accountId: string, name: string): Promise<void> {
    const base = getSyncApiPath(useSyncStore.getState().serverUrl)
    const res = await resilientFetch(`${base}/providers/subscribers/${accountId}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ name }),
        timeout: 10000,
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(body.error || `Failed to remove subscriber (${res.status})`)
    }
}

export async function deleteConnectionCredential(
    _accountId: string,
    connectionId: string,
): Promise<void> {
    const base = getSyncApiPath(useSyncStore.getState().serverUrl)
    const res = await resilientFetch(`${base}/providers/connections/${connectionId}/credentials`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        timeout: 10000,
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(body.error || 'Failed to delete credentials')
    }
}
