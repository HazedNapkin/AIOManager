import type { CanonicalId, CanonicalItem, MetadataSource, ProviderCapability } from '../types.ts'
import { proxyFetchJson } from './shared-fetch.ts'

const PMDB_PROVIDER_ID = 'pmdb'
const PMDB_CAPABILITIES: ReadonlySet<ProviderCapability> = new Set(['details'])

interface PmdbRatingEntry {
    user_id?: string
    rating?: number
    rated_at?: string
}

interface PmdbRatingsResponse {
    ratings?: PmdbRatingEntry[]
    average_score?: number
}

interface PmdbMapping {
    tmdbId?: number
    imdbId?: string
    tvdbId?: number
    malId?: number
}

async function pmdbFetch<T>(path: string, signal?: AbortSignal): Promise<T | null> {
    return proxyFetchJson<T>(`pmdb/${path}`, signal)
}

function getTmdbId(id: CanonicalId): number | null {
    if (typeof id.tmdb === 'number' && id.tmdb > 0) return id.tmdb
    return null
}

export const pmdbAdapter: MetadataSource = {
    providerId: PMDB_PROVIDER_ID,
    capabilities: PMDB_CAPABILITIES,

    async getDetails(id: CanonicalId, signal?: AbortSignal): Promise<Partial<CanonicalItem> | null> {
        const tmdbId = getTmdbId(id)
        if (!tmdbId) return null

        const data = await pmdbFetch<PmdbRatingsResponse>(
            `ratings?tmdb_id=${tmdbId}&media_type=movie`,
            signal
        )
        if (!data) return null

        const partial: Partial<CanonicalItem> = {}
        if (typeof data.average_score === 'number') {
            partial.voteAverage = data.average_score
        }
        if (Array.isArray(data.ratings)) {
            partial.voteCount = data.ratings.length
        }
        return Object.keys(partial).length > 0 ? partial : null
    },
}

export async function resolveImdbFromTmdb(
    tmdbId: number,
    signal?: AbortSignal
): Promise<string | null> {
    const mapping = await pmdbFetch<PmdbMapping | PmdbMapping[]>(
        `mappings/lookup?tmdb_id=${tmdbId}`,
        signal
    )
    if (!mapping) return null
    const m = Array.isArray(mapping) ? mapping[0] : mapping
    return m?.imdbId ?? null
}

export async function resolveTmdbFromImdb(
    imdbId: string,
    signal?: AbortSignal
): Promise<number | null> {
    const mapping = await pmdbFetch<PmdbMapping | PmdbMapping[]>(
        `mappings/lookup?imdb_id=${encodeURIComponent(imdbId)}`,
        signal
    )
    if (!mapping) return null
    const m = Array.isArray(mapping) ? mapping[0] : mapping
    return m?.tmdbId ?? null
}

export async function getPmdbRating(
    tmdbId: number,
    signal?: AbortSignal,
    mediaType?: string
): Promise<{ rating: number; voteCount: number } | null> {
    const mt = mediaType ?? 'movie'
    const data = await pmdbFetch<PmdbRatingsResponse>(
        `ratings?tmdb_id=${tmdbId}&media_type=${mt}`,
        signal
    )
    if (!data) return null
    const score = typeof data.average_score === 'number' ? data.average_score : 0
    const voteCount = Array.isArray(data.ratings) ? data.ratings.length : 0
    if (score === 0 && voteCount === 0) return null
    return { rating: score, voteCount }
}
