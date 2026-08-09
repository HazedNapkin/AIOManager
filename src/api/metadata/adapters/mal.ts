import type {
    CandidateSource,
    CanonicalId,
    CanonicalItem,
    MetadataSource,
    ProviderCapability,
} from '../types.ts'

const MAL_PROVIDER_ID = 'mal'
const MAL_CAPABILITIES: ReadonlySet<ProviderCapability> = new Set<ProviderCapability>([
    'recommendations',
    'details',
    'search',
])
const MAL_ENDPOINT = 'https://api.myanimelist.net/v2'

interface MalAnime {
    id: number
    title: string
    main_picture?: { large?: string; medium?: string }
    synopsis?: string
    genres?: Array<{ id: number; name: string }>
    mean?: number
    popularity?: number
    rank?: number
    start_date?: string
    end_date?: string
    media_type?: string
    num_episodes?: number
    status?: string
    recommendations?: Array<{ node: MalAnime }>
}

let cachedClientId: string | null = null

async function getClientId(): Promise<string | null> {
    if (cachedClientId) return cachedClientId
    try {
        const { getMetadataKeyValue } = await import('@/lib/metadata-keys')
        const key = await getMetadataKeyValue('mal')
        if (key) {
            cachedClientId = key
            return key
        }
    } catch {
    }
    return null
}

export function clearMalKeyCache() {
    cachedClientId = null
}

async function malGet(path: string, signal?: AbortSignal): Promise<any | null> {
    const clientId = await getClientId()
    if (!clientId) return null
    try {
        const res = await fetch(`${MAL_ENDPOINT}${path}`, {
            headers: { 'X-MAL-Client-ID': clientId },
            signal,
        })
        if (res.status === 401 || res.status === 403) {
            clearMalKeyCache()
            return null
        }
        if (!res.ok) return null
        return await res.json()
    } catch {
        return null
    }
}

function mapAnimeToCanonical(anime: MalAnime): CanonicalItem {
    const title = anime.title || 'Unknown'
    const item: CanonicalItem = {
        id: { mal: anime.id, slug: `mal:${anime.id}` },
        title,
        type: anime.media_type === 'movie' ? 'movie' : 'anime',
    }
    if (anime.main_picture?.large) item.poster = anime.main_picture.large
    else if (anime.main_picture?.medium) item.poster = anime.main_picture.medium
    if (anime.synopsis) item.description = anime.synopsis
    if (anime.genres && anime.genres.length > 0) {
        item.genres = anime.genres.map(g => g.name)
    }
    if (typeof anime.mean === 'number') item.voteAverage = anime.mean / 10
    if (typeof anime.popularity === 'number') item.voteCount = anime.popularity
    if (anime.start_date) {
        const year = parseInt(anime.start_date.substring(0, 4), 10)
        if (!isNaN(year)) item.year = year
        item.releaseDate = anime.start_date
    }
    if (typeof anime.num_episodes === 'number' && anime.num_episodes > 0) {
        item.runtime = anime.num_episodes
    }
    return item
}

export async function searchMalByTitle(title: string, signal?: AbortSignal): Promise<MalAnime | null> {
    const data = await malGet(`/anime?q=${encodeURIComponent(title)}&limit=1&fields=id,title,main_picture,synopsis,genres,mean,popularity,start_date,media_type,num_episodes`, signal)
    if (!data?.data?.[0]?.node) return null
    return data.data[0].node
}

export async function getMalRecommendations(malId: number, signal?: AbortSignal, maxItems = 20): Promise<CanonicalItem[]> {
    const data = await malGet(`/anime/${malId}/recommendations?limit=${maxItems}`, signal)
    if (!data?.data) return []
    const items: CanonicalItem[] = []
    for (const entry of data.data) {
        const node = entry?.node
        if (node) {
            const detail = await malGet(`/anime/${node.id}?fields=id,title,main_picture,genres,mean,popularity,start_date,media_type`, signal)
            if (detail) items.push(mapAnimeToCanonical(detail))
            else items.push(mapAnimeToCanonical(node))
        }
    }
    return items
}

export const malAdapter: MetadataSource & Partial<CandidateSource> = {
    providerId: MAL_PROVIDER_ID,
    capabilities: MAL_CAPABILITIES,

    async getDetails(id: CanonicalId, signal?: AbortSignal): Promise<Partial<CanonicalItem> | null> {
        if (typeof id.mal !== 'number') return null
        const data = await malGet(`/anime/${id.mal}?fields=id,title,main_picture,synopsis,genres,mean,popularity,start_date,media_type,num_episodes,status`, signal)
        if (!data) return null
        return mapAnimeToCanonical(data as MalAnime)
    },

    async *getRecommendations(seed: CanonicalItem, signal?: AbortSignal): AsyncIterable<CanonicalItem> {
        const malId = seed.id.mal
        if (!malId) {
            const searchResult = await searchMalByTitle(seed.title, signal)
            if (!searchResult?.id) return
            const recs = await getMalRecommendations(searchResult.id, signal)
            for (const item of recs) {
                if (signal?.aborted) return
                yield item
            }
            return
        }
        const recs = await getMalRecommendations(malId, signal)
        for (const item of recs) {
            if (signal?.aborted) return
            yield item
        }
    },
}
