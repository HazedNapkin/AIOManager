const TOKEN_BUFFER_MS = 5 * 60 * 1000
const DEFAULT_TTL_MS = 60 * 60 * 1000

interface CachedNuvioToken {
    accessToken: string
    profileId: string | null
    expiresAt: number
}

const cache = new Map<string, CachedNuvioToken>()

export function getCachedNuvioToken(connectionId: string): CachedNuvioToken | null {
    const entry = cache.get(connectionId)
    if (!entry) return null
    if (Date.now() > entry.expiresAt - TOKEN_BUFFER_MS) {
        cache.delete(connectionId)
        return null
    }
    return entry
}

export function setCachedNuvioToken(connectionId: string, token: { accessToken: string; profileId?: string | null; expiresAt?: number }) {
    if (!token?.accessToken) return
    cache.set(connectionId, {
        accessToken: token.accessToken,
        profileId: token.profileId ?? null,
        expiresAt: token.expiresAt ?? Date.now() + DEFAULT_TTL_MS,
    })
}

export function invalidateNuvioToken(connectionId: string) {
    cache.delete(connectionId)
}
