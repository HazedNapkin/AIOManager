import type {
    MetadataSource,
    CandidateSource,
    CanonicalId,
    CanonicalItem,
    ProviderCapability,
} from '../types.ts'
import { proxyFetchJson } from './shared-fetch'

const MDBLIST_PROVIDER_ID = 'mdblist'
const MDBLIST_CAPABILITIES: ReadonlySet<ProviderCapability> = new Set<ProviderCapability>([
    'details',
    'recommendations',
])

interface MdbListTitle {
    id?: number
    title?: string
    name?: string
    release_date?: string
    first_air_date?: string
    poster_path?: string
    backdrop_path?: string
    overview?: string
    genre_ids?: number[]
    vote_average?: number
    vote_count?: number
    rating?: number
    runtime?: number
}

async function mdblistFetch<T>(path: string, signal?: AbortSignal): Promise<T | null> {
    return proxyFetchJson<T>(`mdblist/${path}`, signal)
}

function mapTitleToCanonical(item: MdbListTitle): CanonicalItem {
    const releaseDate = item.release_date || item.first_air_date
    const canonical: CanonicalItem = {
        id: { slug: String(item.id ?? '') },
        title: item.title || item.name || 'Unknown',
        type: item.first_air_date ? 'series' : 'movie',
    }
    if (item.poster_path) canonical.poster = item.poster_path
    if (item.overview) canonical.description = item.overview
    if (typeof item.vote_average === 'number') canonical.voteAverage = item.vote_average
    if (typeof item.vote_count === 'number') canonical.voteCount = item.vote_count
    if (typeof item.rating === 'number') canonical.voteAverage = item.rating
    if (typeof item.runtime === 'number') canonical.runtime = item.runtime
    if (releaseDate && releaseDate.length >= 4) {
        const year = parseInt(releaseDate.slice(0, 4), 10)
        if (Number.isFinite(year)) canonical.year = year
    }
    return canonical
}

export const mdblistAdapter: MetadataSource & Partial<CandidateSource> = {
    providerId: MDBLIST_PROVIDER_ID,
    capabilities: MDBLIST_CAPABILITIES,

    async getDetails(id: CanonicalId, signal?: AbortSignal): Promise<Partial<CanonicalItem> | null> {
        const tmdbId = typeof id.tmdb === 'number' ? id.tmdb : null
        if (!tmdbId) return null
        const data = await mdblistFetch<MdbListTitle>(`titles/tmdb/${tmdbId}`, signal)
        if (!data) return null
        const mapped = mapTitleToCanonical(data)
        return mapped
    },
}
