import type {
    CandidateSource,
    CanonicalId,
    CanonicalItem,
    MetadataSource,
    ProviderCapability,
} from '../types.ts'

const ANILIST_PROVIDER_ID = 'anilist'
const ANILIST_CAPABILITIES: ReadonlySet<ProviderCapability> = new Set<ProviderCapability>([
    'recommendations',
    'details',
])
const ANILIST_ENDPOINT = 'https://graphql.anilist.co'

interface AniListMedia {
    id: number
    idMal?: number
    title?: { romaji?: string; english?: string; native?: string }
    coverImage?: { large?: string; extraLarge?: string }
    bannerImage?: string
    description?: string
    genres?: string[]
    averageScore?: number
    popularity?: number
    season?: string
    seasonYear?: number
    startDate?: { year?: number }
    format?: string
    episodes?: number
    duration?: number
    recommendations?: {
        nodes?: Array<{
            mediaRecommendation?: AniListMedia
        }>
    }
}

interface AniListResponse {
    data?: Record<string, unknown>
    errors?: Array<{ message: string }>
}

async function anilistQuery(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<AniListResponse | null> {
    try {
        const res = await fetch(ANILIST_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query, variables }),
            signal,
        })
        if (!res.ok) return null
        return (await res.json()) as AniListResponse
    } catch {
        return null
    }
}

function mapMediaToCanonical(media: AniListMedia): CanonicalItem {
    const title = media.title?.english || media.title?.romaji || media.title?.native || 'Unknown'
    const item: CanonicalItem = {
        id: { anilist: media.id, slug: `anilist:${media.id}` },
        title,
        type: 'anime',
    }
    if (media.idMal) item.id.mal = media.idMal
    if (media.coverImage?.extraLarge) item.poster = media.coverImage.extraLarge
    else if (media.coverImage?.large) item.poster = media.coverImage.large
    if (media.bannerImage) item.backdrop = media.bannerImage
    if (media.description) item.description = media.description.replace(/<[^>]+>/g, '')
    if (media.genres && media.genres.length > 0) item.genres = media.genres
    if (typeof media.averageScore === 'number') {
        item.voteAverage = media.averageScore / 10
    }
    if (typeof media.popularity === 'number') item.voteCount = media.popularity
    const year = media.seasonYear || media.startDate?.year
    if (year) item.year = year
    if (media.format === 'MOVIE') item.type = 'movie'
    return item
}

export async function searchAniListByTitle(title: string, signal?: AbortSignal): Promise<AniListMedia | null> {
    const query = `
        query ($search: String) {
            Media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
                id idMal format
                title { romaji english native }
                coverImage { large extraLarge }
                genres averageScore popularity
                startDate { year } seasonYear
            }
        }`
    const res = await anilistQuery(query, { search: title }, signal)
    if (!res?.data?.Media) return null
    return res.data.Media as unknown as AniListMedia
}

export async function isAniListTitle(title: string, signal?: AbortSignal): Promise<boolean> {
    const media = await searchAniListByTitle(title, signal)
    return media !== null
}

export async function getAniListRecommendations(title: string, signal?: AbortSignal, maxItems = 20): Promise<CanonicalItem[]> {
    const query = `
        query ($search: String) {
            Media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
                recommendations(sort: RATING_DESC, perPage: ${maxItems}) {
                    nodes {
                        mediaRecommendation {
                            id idMal format
                            title { romaji english native }
                            coverImage { large extraLarge }
                            genres averageScore popularity
                            startDate { year } seasonYear
                        }
                    }
                }
            }
        }`
    const res = await anilistQuery(query, { search: title }, signal)
    const media = res?.data?.Media as unknown as { recommendations?: { nodes?: Array<{ mediaRecommendation?: AniListMedia }> } } | undefined
    if (!media?.recommendations?.nodes) return []
    const items: CanonicalItem[] = []
    for (const node of media.recommendations.nodes) {
        if (node.mediaRecommendation) items.push(mapMediaToCanonical(node.mediaRecommendation))
    }
    return items
}

export const anilistAdapter: MetadataSource & Partial<CandidateSource> = {
    providerId: ANILIST_PROVIDER_ID,
    capabilities: ANILIST_CAPABILITIES,

    async getDetails(id: CanonicalId, signal?: AbortSignal): Promise<Partial<CanonicalItem> | null> {
        if (typeof id.anilist !== 'number') return null
        const query = `
            query ($id: Int) {
                Media(id: $id, type: ANIME) {
                    id idMal format episodes duration
                    title { romaji english native }
                    coverImage { large extraLarge }
                    bannerImage description genres averageScore popularity
                    startDate { year } seasonYear season
                }
            }`
        const res = await anilistQuery(query, { id: id.anilist }, signal)
        if (!res?.data?.Media) return null
        return mapMediaToCanonical(res.data.Media as unknown as AniListMedia)
    },

    async *getRecommendations(seed: CanonicalItem, signal?: AbortSignal): AsyncIterable<CanonicalItem> {
        const title = seed.title
        if (!title) return
        const recs = await getAniListRecommendations(title, signal)
        for (const item of recs) {
            if (signal?.aborted) return
            yield item
        }
    },
}
