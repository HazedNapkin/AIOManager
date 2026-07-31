const RESOLVER_CACHE_MAX = 500
const resolverCache = new Map<string, { tmdbId: number; mediaType: 'movie' | 'tv' } | null>()

async function getAuthHeaders(): Promise<Record<string, string>> {
    try {
        const [{ useSyncStore }, { deriveSyncToken }] = await Promise.all([
            import('@/store/syncStore'),
            import('@/lib/crypto'),
        ])
        const auth = useSyncStore.getState().auth
        if (!auth.isAuthenticated) return {}
        return {
            'x-sync-user': auth.id,
            'x-sync-password': await deriveSyncToken(auth.password),
        }
    } catch {
        return {}
    }
}

function cacheSet(imdbId: string, value: { tmdbId: number; mediaType: 'movie' | 'tv' } | null) {
    if (resolverCache.size >= RESOLVER_CACHE_MAX) resolverCache.clear()
    resolverCache.set(imdbId, value)
}

export async function resolveTmdbId(imdbId: string): Promise<{ tmdbId: number; mediaType: 'movie' | 'tv' } | null> {
    if (!imdbId || !imdbId.startsWith('tt')) {
        return null
    }

    const cached = resolverCache.get(imdbId)
    if (cached !== undefined) {
        return cached
    }

    try {
        const headers = await getAuthHeaders()
        const res = await fetch(`/api/metadata/tmdb/find/${imdbId}?external_source=imdb_id`, { headers })

        if (!res.ok) {
            cacheSet(imdbId, null)
            return null
        }

        const data = await res.json()

        if (data?.movie_results?.[0]?.id) {
            const result = { tmdbId: data.movie_results[0].id, mediaType: 'movie' as const }
            cacheSet(imdbId, result)
            return result
        }

        if (data?.tv_results?.[0]?.id) {
            const result = { tmdbId: data.tv_results[0].id, mediaType: 'tv' as const }
            cacheSet(imdbId, result)
            return result
        }

        cacheSet(imdbId, null)
        return null
    } catch {
        cacheSet(imdbId, null)
        return null
    }
}

export function _invalidateResolverCache(): void {
    resolverCache.clear()
}
