export interface DetailItem {
    itemId: string
    type: string
    name?: string
    poster?: string
    genres?: string[]
    firstWatched?: Date
    season?: number
    episode?: number
    year?: number
    voteAverage?: number
    description?: string
    backdrop?: string
    accountId?: string
}

export interface TmdbFindResponse {
    movie_results?: Array<{ id: number }>
    tv_results?: Array<{ id: number }>
}

export interface TmdbPersonSearchResponse {
    results?: Array<{ id: number; name?: string; profile_path?: string }>
}

export interface TmdbPersonCreditsResponse {
    profile_path?: string
    name?: string
    biography?: string
    birthday?: string
    deathday?: string
    place_of_birth?: string
    known_for_department?: string
    combined_credits?: {
        cast?: Array<Record<string, unknown>>
        crew?: Array<Record<string, unknown>>
    }
}

export interface FilmographyItem {
    id: string
    title: string
    poster?: string
    year?: number
    type: 'movie' | 'series' | 'anime'
    character?: string
    job?: string
    voteAverage?: number
}
