import type {
    MetadataSource,
    CanonicalId,
    CanonicalItem,
    ProviderCapability,
} from '../types.ts'
import { proxyFetchJson } from './shared-fetch'

const TVDB_PROVIDER_ID = 'tvdb'
const TVDB_CAPABILITIES: ReadonlySet<ProviderCapability> = new Set<ProviderCapability>([
    'details',
])

interface TvdbSeries {
    id?: string | number
    name?: string
    overview?: string
    image?: string
    score?: number
    runtime?: string
    genre?: string[]
    firstAired?: string
    status?: string
    episodes?: Array<{
        id: number
        name?: string
        aired?: string
        runtime?: number
        image?: string
    }>
}

async function tvdbFetch<T>(path: string, signal?: AbortSignal): Promise<T | null> {
    return proxyFetchJson<T>(`tvdb/${path}`, signal)
}

export const tvdbAdapter: MetadataSource = {
    providerId: TVDB_PROVIDER_ID,
    capabilities: TVDB_CAPABILITIES,

    async getDetails(id: CanonicalId, signal?: AbortSignal): Promise<Partial<CanonicalItem> | null> {
        const tvdbId = typeof id.tvdb === 'number' ? id.tvdb : null
        if (!tvdbId) {
            if (id.imdb) {
                const data = await tvdbFetch<{ data?: Array<{ id: string }> }>(
                    `search?imdbId=${encodeURIComponent(id.imdb)}`,
                    signal
                )
                const first = data?.data?.[0]
                if (!first?.id) return null
                const series = await tvdbFetch<{ data?: TvdbSeries }>(
                    `series/${first.id}`,
                    signal
                )
                if (!series?.data) return null
                return mapSeries(series.data)
            }
            return null
        }
        const data = await tvdbFetch<{ data?: TvdbSeries }>(`series/${tvdbId}`, signal)
        if (!data?.data) return null
        return mapSeries(data.data)
    },

    async getEpisodes(id: CanonicalId, _season: number, signal?: AbortSignal): Promise<
        Array<{ id: string; season: number; episode: number; title?: string; overview?: string; thumbnail?: string; airDate?: string }>
    > {
        const tvdbId = typeof id.tvdb === 'number' ? id.tvdb : null
        if (!tvdbId) return []
        const data = await tvdbFetch<{ data?: { episodes?: TvdbSeries['episodes'] } }>(
            `series/${tvdbId}/episodes`,
            signal
        )
        if (!data?.data?.episodes) return []
        return data.data.episodes.map(ep => ({
            id: String(ep.id),
            season: 0,
            episode: 0,
            title: ep.name,
            overview: undefined,
            thumbnail: ep.image,
            airDate: ep.aired,
        }))
    },
}

function mapSeries(s: TvdbSeries): Partial<CanonicalItem> {
    const partial: Partial<CanonicalItem> = {
        title: s.name,
        type: 'series',
        description: s.overview,
    }
    if (s.image) partial.poster = s.image
    if (typeof s.score === 'number') partial.voteAverage = s.score
    if (s.genre && s.genre.length > 0) partial.genres = s.genre
    if (s.firstAired && s.firstAired.length >= 4) {
        const year = parseInt(s.firstAired.slice(0, 4), 10)
        if (Number.isFinite(year)) partial.year = year
    }
    return partial
}
