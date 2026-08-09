import { useSyncStore } from '@/store/syncStore'
import { deriveSyncToken } from '@/lib/crypto'

async function authHeaders(): Promise<Record<string, string>> {
    const auth = useSyncStore.getState().auth
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (auth.isAuthenticated) {
        headers['x-sync-user'] = auth.id
        headers['x-sync-password'] = await deriveSyncToken(auth.password)
    }
    return headers
}

export interface CatalogToken {
    scope: 'household' | 'account'
    accountId: string | null
    url: string
}

export async function getHouseholdCatalogUrl(): Promise<string | null> {
    try {
        const res = await fetch('/api/catalog/install-url', { headers: await authHeaders() })
        if (!res.ok) return null
        const json = await res.json()
        return json.url ?? null
    } catch {
        return null
    }
}

export async function getAccountCatalogUrl(accountId: string, accountName?: string): Promise<string | null> {
    try {
        const res = await fetch('/api/catalog/account-url', {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({ accountId, accountName }),
        })
        if (!res.ok) return null
        const json = await res.json()
        return json.url ?? null
    } catch {
        return null
    }
}

export async function getAllCatalogUrls(): Promise<{ household: string; accounts: Array<{ accountId: string; accountName?: string; url: string }> } | null> {
    try {
        const res = await fetch('/api/catalog/all-urls', { headers: await authHeaders() })
        if (!res.ok) return null
        return await res.json()
    } catch {
        return null
    }
}

export async function getCatalogTokens(): Promise<CatalogToken[]> {
    try {
        const res = await fetch('/api/catalog/tokens', { headers: await authHeaders() })
        if (!res.ok) return []
        const json = await res.json()
        return json.tokens ?? []
    } catch {
        return []
    }
}

export async function clearCatalogData(): Promise<boolean> {
    try {
        const res = await fetch('/api/catalog/clear', {
            method: 'DELETE',
            headers: await authHeaders(),
        })
        return res.ok
    } catch {
        return false
    }
}

export interface PublishRailItem {
    id: string
    type: string
    name: string
    poster?: string
    score?: number
    reason?: string
}

export interface PublishRail {
    catalogType: string
    scope: 'household' | 'account'
    accountId?: string
    items: PublishRailItem[]
}

export async function addToWatchlist(itemId: string, type: string, name?: string, poster?: string, accountId?: string): Promise<boolean> {
    try {
        const res = await fetch('/api/catalog/watchlist/add', {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({ itemId, type, name, poster, accountId }),
        })
        return res.ok
    } catch {
        return false
    }
}

export async function removeFromWatchlist(itemId: string, accountId?: string): Promise<boolean> {
    try {
        const res = await fetch('/api/catalog/watchlist/remove', {
            method: 'DELETE',
            headers: await authHeaders(),
            body: JSON.stringify({ itemId, accountId }),
        })
        return res.ok
    } catch {
        return false
    }
}

export async function getWatchlist(accountId?: string): Promise<Array<{ itemId: string; type: string; name?: string; poster?: string; addedAt?: number }>> {
    try {
        const params = accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''
        const res = await fetch(`/api/catalog/watchlist${params}`, { headers: await authHeaders() })
        if (!res.ok) return []
        const json = await res.json()
        return json.items ?? []
    } catch {
        return []
    }
}

export async function publishRecommendations(rails: PublishRail[]): Promise<boolean> {
    if (rails.length === 0) return false
    try {
        const res = await fetch('/api/catalog/publish-recommendations', {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({ rails }),
        })
        return res.ok
    } catch {
        return false
    }
}

export interface CustomCatalog {
    id: string
    name: string
    type: string
    filters: Record<string, unknown>
}

export async function listCustomCatalogs(): Promise<CustomCatalog[]> {
    try {
        const res = await fetch('/api/catalog/custom', { headers: await authHeaders() })
        if (!res.ok) return []
        const json = await res.json()
        return json.catalogs ?? []
    } catch {
        return []
    }
}

export async function createCustomCatalog(name: string, type: string, filters: Record<string, unknown>): Promise<{ id: string }> {
    const res = await fetch('/api/catalog/custom', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ name, type, filters }),
    })
    if (!res.ok) throw new Error('Failed to create custom catalog')
    const json = await res.json()
    return { id: json.id }
}

export async function deleteCustomCatalog(id: string): Promise<boolean> {
    try {
        const res = await fetch(`/api/catalog/custom/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: await authHeaders(),
        })
        return res.ok
    } catch {
        return false
    }
}
