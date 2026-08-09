import { tmdbAdapter } from '../api/metadata/adapters/tmdb.ts'

export interface TrailerResult {
    youTubeId: string
    source: 'cinemeta' | 'tmdb'
}

export interface TrailerResolverInput {
    cinemetaTrailers?: Array<{ source?: string }> | null
    imdbId?: string
    type?: string
    tmdbDetails?: { trailerYouTubeId?: string } | null
}

export function resolveTrailer(input: TrailerResolverInput): TrailerResult | null {
    const trailers = Array.isArray(input?.cinemetaTrailers) ? input.cinemetaTrailers : null
    if (trailers && trailers.length > 0) {
        const source = trailers[0]?.source
        if (typeof source === 'string' && source.trim().length > 0) {
            return { youTubeId: source, source: 'cinemeta' }
        }
    }
    const tmdbTrailer = input?.tmdbDetails?.trailerYouTubeId
    if (typeof tmdbTrailer === 'string' && tmdbTrailer.trim().length > 0) {
        return { youTubeId: tmdbTrailer, source: 'tmdb' }
    }
    return null
}

export async function resolveTrailerAsync(params: {
    imdbId: string
    type?: string
    cinemetaMeta?: { trailers?: Array<{ source?: string }> } | null
}): Promise<TrailerResult | null> {
    const cinemetaResult = resolveTrailer({ cinemetaTrailers: params?.cinemetaMeta?.trailers ?? null })
    if (cinemetaResult) return cinemetaResult

    const imdbId = params?.imdbId
    if (!imdbId || !imdbId.trim()) return null

    try {
        if (!tmdbAdapter.getDetails) return null
        const details = await tmdbAdapter.getDetails(
            { imdb: imdbId, slug: imdbId },
            AbortSignal.timeout(8000)
        )
        if (!details) return null
        return resolveTrailer({ tmdbDetails: details })
    } catch {
        return null
    }
}
