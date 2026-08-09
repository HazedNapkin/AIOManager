import type {
    CandidateSource,
    CanonicalId,
    CanonicalItem,
    ContentType,
    Episode,
    MetadataSource,
    ProviderCapability,
} from '../types.ts'
import type { CinemetaMeta } from '@/lib/activity-utils'

const TMDB_PROVIDER_ID = 'tmdb'

const TMDB_CAPABILITIES: ReadonlySet<ProviderCapability> = new Set<ProviderCapability>([
    'recommendations',
    'similar',
    'details',
    'episodes',
])

const TMDB_GENRES: Readonly<Record<number, string>> = {
    28: 'Action',
    12: 'Adventure',
    16: 'Animation',
    35: 'Comedy',
    80: 'Crime',
    99: 'Documentary',
    18: 'Drama',
    10751: 'Family',
    14: 'Fantasy',
    36: 'History',
    27: 'Horror',
    10402: 'Music',
    9648: 'Mystery',
    10749: 'Romance',
    878: 'Science Fiction',
    10770: 'TV Movie',
    53: 'Thriller',
    10752: 'War',
    37: 'Western',
    10759: 'Action & Adventure',
    10762: 'Kids',
    10763: 'News',
    10764: 'Reality',
    10765: 'Sci-Fi & Fantasy',
    10766: 'Soap',
    10767: 'Talk',
    10768: 'War & Politics',
}

const GENRE_NAME_TO_ID: Readonly<Record<string, number>> = (() => {
    const map: Record<string, number> = {}
    for (const [id, name] of Object.entries(TMDB_GENRES)) {
        const key = name.toLowerCase()
        if (!(key in map)) map[key] = Number(id)
    }
    return map
})()

const TV_GENRE_IDS = new Set([10759, 16, 35, 80, 99, 18, 10751, 10762, 9648, 10763, 10764, 10765, 10766, 10767, 10768])

const MOVIE_GENRE_IDS = new Set([28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 10770, 53, 10752, 37])

function genreNamesToIds(names: string[], mediaType: TmdbMediaType): number[] {
    const allowed = mediaType === 'tv' ? TV_GENRE_IDS : MOVIE_GENRE_IDS
    const ids: number[] = []
    for (const name of names) {
        const id = GENRE_NAME_TO_ID[name.toLowerCase().trim()]
        if (typeof id === 'number' && allowed.has(id)) ids.push(id)
    }
    return ids
}

export async function* discoverByGenre(
    genres: string[],
    mediaType: TmdbMediaType,
    signal?: AbortSignal
): AsyncIterable<CanonicalItem> {
    const genreIds = genreNamesToIds(genres, mediaType)
    if (genreIds.length === 0) return
    const withGenres = genreIds.slice(0, 3).join(',')
    const basePath = `discover/${mediaType}?with_genres=${withGenres}&sort_by=popularity.desc&vote_count.gte=50`
    yield* iterPaged(basePath, mediaType, signal)
}

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

interface TmdbGenre {
    id: number
    name: string
}

interface TmdbVideo {
    key: string
    site: string
    type: string
    name?: string
    official?: boolean
}

interface TmdbVideosPayload {
    results?: TmdbVideo[]
}

interface TmdbCastMember {
    id: number
    name?: string
    character?: string
    profile_path?: string | null
    order?: number
    roles?: Array<{ character?: string }>
    jobs?: Array<{ job?: string }>
    department?: string
}

interface TmdbCreditsPayload {
    cast?: TmdbCastMember[]
    crew?: Array<{ id: number; name?: string; job?: string; profile_path?: string | null; department?: string; jobs?: Array<{ job?: string }> }>
}

interface TmdbDetailsPayload {
    id: number
    title?: string
    name?: string
    poster_path?: string | null
    backdrop_path?: string | null
    overview?: string
    genres?: TmdbGenre[]
    runtime?: number
    episode_run_time?: number[]
    release_date?: string
    first_air_date?: string
    vote_average?: number
    vote_count?: number
    videos?: TmdbVideosPayload
    imdb_id?: string
    credits?: TmdbCreditsPayload
}

interface TmdbListItem {
    id: number
    title?: string
    name?: string
    poster_path?: string | null
    backdrop_path?: string | null
    release_date?: string
    first_air_date?: string
    vote_average?: number
    vote_count?: number
    genre_ids?: number[]
}

interface TmdbPagedPayload {
    page?: number
    total_pages?: number
    results?: TmdbListItem[]
}

interface TmdbEpisodePayload {
    episode_number: number
    name?: string
    overview?: string
    air_date?: string
    still_path?: string | null
}

interface TmdbSeasonPayload {
    episodes?: TmdbEpisodePayload[]
}

interface TmdbFindPayload {
    movie_results?: TmdbListItem[]
    tv_results?: TmdbListItem[]
}

type TmdbMediaType = 'movie' | 'tv'

async function getAuthHeaders(): Promise<Record<string, string>> {
    try {
        const { useSyncStore } = await import('@/store/syncStore')
        const { deriveSyncToken } = await import('@/lib/crypto')
        const auth = useSyncStore.getState().auth
        if (!auth?.isAuthenticated) {
            if (import.meta.env?.DEV) console.warn('[TMDB] No auth session found')
            return {}
        }
        return {
            'x-sync-user': auth.id,
            'x-sync-password': await deriveSyncToken(auth.password),
        }
    } catch (err) {
        if (import.meta.env?.DEV) console.error('[TMDB] Failed to build auth headers:', err)
        return {}
    }
}

export async function proxyFetch<T>(path: string, signal?: AbortSignal): Promise<T | null> {
    let response: Response
    try {
        response = await fetch(`/api/metadata/tmdb/${path}`, {
            headers: await getAuthHeaders(),
            signal,
        })
    } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError') && import.meta.env?.DEV) {
            console.error('[TMDB proxyFetch] network error:', path, err)
        }
        return null
    }
    if (!response.ok) {
        if (import.meta.env?.DEV) console.warn(`[TMDB proxyFetch] ${response.status} for ${path}`)
        return null
    }
    try {
        return (await response.json()) as T
    } catch {
        return null
    }
}

export async function searchTmdbPerson(
    name: string,
    signal?: AbortSignal
): Promise<{ id: number; name: string; profilePath: string | null } | null> {
    try {
        const data = await proxyFetch<{ results?: Array<{ id: number; name?: string; profile_path?: string | null }> }>(
            `search/person?query=${encodeURIComponent(name)}&page=1`,
            signal
        )
        const result = data?.results?.[0]
        if (!result) return null
        return {
            id: result.id,
            name: result.name || name,
            profilePath: result.profile_path || null,
        }
    } catch {
        return null
    }
}

function extractYear(dateStr: string | undefined | null): number | undefined {
    if (!dateStr || dateStr.length < 4) return undefined
    const year = Number.parseInt(dateStr.slice(0, 4), 10)
    return Number.isFinite(year) ? year : undefined
}

function pickTrailerKey(videos: TmdbVideosPayload | undefined): string | undefined {
    const results = videos?.results
    if (!Array.isArray(results) || results.length === 0) return undefined
    const trailers = results.filter(v => v.type === 'Trailer' && v.site === 'YouTube')
    if (trailers.length === 0) return undefined
    const official = trailers.find(v => v.official === true)
    return (official ?? trailers[0]).key
}

function genresFromIds(ids: number[] | undefined): string[] | undefined {
    if (!Array.isArray(ids) || ids.length === 0) return undefined
    const mapped = ids
        .map(id => TMDB_GENRES[id])
        .filter((g): g is string => typeof g === 'string')
    return mapped.length > 0 ? mapped : undefined
}

function mapDetailsToCanonical(data: TmdbDetailsPayload, mediaType: TmdbMediaType): Partial<CanonicalItem> {
    const releaseDate = data.release_date || data.first_air_date
    const genres = Array.isArray(data.genres) && data.genres.length > 0
        ? data.genres.map(g => g.name).filter((n): n is string => typeof n === 'string')
        : undefined
    const partial: Partial<CanonicalItem> = {
        title: data.title || data.name,
        type: mediaType === 'tv' ? 'series' : 'movie',
        poster: data.poster_path ? `${TMDB_IMAGE_BASE}/w500${data.poster_path}` : undefined,
        backdrop: data.backdrop_path ? `${TMDB_IMAGE_BASE}/original${data.backdrop_path}` : undefined,
        description: data.overview,
        genres,
        trailerYouTubeId: pickTrailerKey(data.videos),
        voteAverage: data.vote_average,
        voteCount: data.vote_count,
        releaseDate,
    }
    if (typeof data.runtime === 'number' && data.runtime > 0) {
        partial.runtime = data.runtime
    } else if (Array.isArray(data.episode_run_time) && data.episode_run_time.length > 0) {
        const first = data.episode_run_time[0]
        if (typeof first === 'number' && first > 0) partial.runtime = first
    }
    const year = extractYear(releaseDate)
    if (year !== undefined) partial.year = year
    return partial
}

function mapListItemToCanonical(item: TmdbListItem, mediaType: TmdbMediaType): CanonicalItem {
    const releaseDate = item.release_date || item.first_air_date
    const canonical: CanonicalItem = {
        id: { tmdb: item.id, slug: String(item.id) },
        title: item.title || item.name || 'Unknown',
        type: mediaType === 'tv' ? 'series' : 'movie',
    }
    if (item.poster_path) canonical.poster = `${TMDB_IMAGE_BASE}/w500${item.poster_path}`
    const year = extractYear(releaseDate)
    if (year !== undefined) canonical.year = year
    if (typeof item.vote_average === 'number') canonical.voteAverage = item.vote_average
    if (typeof item.vote_count === 'number') canonical.voteCount = item.vote_count
    const genres = genresFromIds(item.genre_ids)
    if (genres) canonical.genres = genres
    return canonical
}

const tmdbIdCache = new Map<string, { tmdbId: number; mediaType: TmdbMediaType } | null>()
const TMDB_ID_CACHE_MAX = 2000

async function resolveTmdbIdFromCanonical(
    id: CanonicalId,
    typeHint?: ContentType
): Promise<{ tmdbId: number; mediaType: TmdbMediaType } | null> {
    if (typeof id.tmdb === 'number' && id.tmdb > 0) {
        const mediaType: TmdbMediaType = typeHint === 'series' || typeHint === 'anime' ? 'tv' : 'movie'
        return { tmdbId: id.tmdb, mediaType }
    }
    if (id.imdb) {
        const cacheKey = `${id.imdb}:${typeHint ?? ''}`
        if (tmdbIdCache.has(cacheKey)) return tmdbIdCache.get(cacheKey) ?? null
        if (tmdbIdCache.size >= TMDB_ID_CACHE_MAX) {
            const oldest = tmdbIdCache.keys().next().value
            if (oldest) tmdbIdCache.delete(oldest)
        }
        const find = await proxyFetch<TmdbFindPayload>(
            `find/${encodeURIComponent(id.imdb)}?external_source=imdb_id`
        )
        if (!find) {
            tmdbIdCache.set(cacheKey, null)
            return null
        }
        const movie = Array.isArray(find.movie_results) && find.movie_results.length > 0
            ? find.movie_results[0]
            : null
        const tv = Array.isArray(find.tv_results) && find.tv_results.length > 0
            ? find.tv_results[0]
            : null
        let result: { tmdbId: number; mediaType: TmdbMediaType } | null = null
        if (typeHint === 'series' || typeHint === 'anime') {
            if (tv) result = { tmdbId: tv.id, mediaType: 'tv' }
            else if (movie) result = { tmdbId: movie.id, mediaType: 'movie' }
        } else {
            if (movie) result = { tmdbId: movie.id, mediaType: 'movie' }
            else if (tv) result = { tmdbId: tv.id, mediaType: 'tv' }
        }
        tmdbIdCache.set(cacheKey, result)
        return result
    }
    return null
}

async function* iterPaged(
    basePath: string,
    mediaType: TmdbMediaType,
    signal?: AbortSignal,
    maxPages = 1
): AsyncIterable<CanonicalItem> {
    let page = 1
    while (page <= maxPages) {
        if (signal?.aborted) return
        const payload = await proxyFetch<TmdbPagedPayload>(`${basePath}?page=${page}`, signal)
        if (!payload) return
        const results = Array.isArray(payload.results) ? payload.results : []
        for (const item of results) {
            if (signal?.aborted) return
            yield mapListItemToCanonical(item, mediaType)
        }
        const totalPages = typeof payload.total_pages === 'number' && payload.total_pages > 0
            ? payload.total_pages
            : 1
        if (page >= totalPages) return
        page += 1
    }
}

export const tmdbAdapter: CandidateSource & MetadataSource = {
    providerId: TMDB_PROVIDER_ID,
    capabilities: TMDB_CAPABILITIES,

    async getDetails(id: CanonicalId, signal?: AbortSignal): Promise<Partial<CanonicalItem> | null> {
        const resolved = await resolveTmdbIdFromCanonical(id)
        if (!resolved) return null
        const { tmdbId, mediaType } = resolved
        const data = await proxyFetch<TmdbDetailsPayload>(
            `${mediaType}/${tmdbId}?append_to_response=videos,credits`,
            signal
        )
        if (!data) return null
        return mapDetailsToCanonical(data, mediaType)
    },

    async *getRecommendations(seed: CanonicalItem, signal?: AbortSignal): AsyncIterable<CanonicalItem> {
        const resolved = await resolveTmdbIdFromCanonical(seed.id, seed.type)
        if (!resolved) return
        let yielded = 0
        for await (const item of iterPaged(
            `${resolved.mediaType}/${resolved.tmdbId}/recommendations`,
            resolved.mediaType,
            signal
        )) {
            yield item
            yielded++
        }
        if (yielded === 0 && seed.genres && seed.genres.length > 0) {
            yield* discoverByGenre(seed.genres, resolved.mediaType, signal)
        }
    },

    async *getSimilar(seed: CanonicalItem, signal?: AbortSignal): AsyncIterable<CanonicalItem> {
        const resolved = await resolveTmdbIdFromCanonical(seed.id, seed.type)
        if (!resolved) return
        yield* iterPaged(
            `${resolved.mediaType}/${resolved.tmdbId}/similar`,
            resolved.mediaType,
            signal
        )
    },

    async getEpisodes(id: CanonicalId, season: number, signal?: AbortSignal): Promise<Episode[]> {
        const resolved = await resolveTmdbIdFromCanonical(id)
        if (!resolved || resolved.mediaType !== 'tv') return []
        const data = await proxyFetch<TmdbSeasonPayload>(
            `tv/${resolved.tmdbId}/season/${season}`,
            signal
        )
        if (!data || !Array.isArray(data.episodes)) return []
        return data.episodes.map(ep => {
            const episode: Episode = {
                id: String(ep.episode_number),
                season,
                episode: ep.episode_number,
            }
            if (typeof ep.name === 'string') episode.title = ep.name
            if (typeof ep.overview === 'string') episode.overview = ep.overview
            if (typeof ep.air_date === 'string') episode.airDate = ep.air_date
            if (ep.still_path) episode.thumbnail = `${TMDB_IMAGE_BASE}/w500${ep.still_path}`
            return episode
        })
    },
}

export async function* getTrending(
    mediaType: 'movie' | 'tv',
    timeWindow: 'day' | 'week' = 'week',
    signal?: AbortSignal
): AsyncIterable<CanonicalItem> {
    yield* iterPaged(`trending/${mediaType}/${timeWindow}`, mediaType, signal)
}

export async function fetchTrendingBatch(
    mediaType: 'movie' | 'tv',
    signal?: AbortSignal,
    maxItems = 20
): Promise<CanonicalItem[]> {
    const items: CanonicalItem[] = []
    try {
        for await (const item of getTrending(mediaType, 'week', signal)) {
            items.push(item)
            if (items.length >= maxItems) break
        }
    } catch {}
    return items
}

export interface SeasonInfo {
    seasonNumber: number
    name: string
    episodeCount: number
    airDate?: string
    poster?: string
    overview?: string
}

export interface EpisodeInfo {
    episodeNumber: number
    name: string
    overview?: string
    airDate?: string
    runtime?: number
    still?: string
    voteAverage?: number
}

export async function fetchSeasonEpisodes(tmdbId: number, season: number, signal?: AbortSignal): Promise<EpisodeInfo[]> {
    const data = await proxyFetch<{ episodes?: Array<{ episode_number: number; name?: string; overview?: string; air_date?: string; runtime?: number; still_path?: string | null; vote_average?: number }> }>(
        `tv/${tmdbId}/season/${season}`,
        signal
    )
    if (!data?.episodes) return []
    return data.episodes
        .filter(ep => ep && typeof ep.episode_number === 'number')
        .map(ep => ({
            episodeNumber: ep.episode_number,
            name: ep.name || `Episode ${ep.episode_number}`,
            overview: ep.overview,
            airDate: ep.air_date,
            runtime: typeof ep.runtime === 'number' ? ep.runtime : undefined,
            still: ep.still_path ? `${TMDB_IMAGE_BASE}/w500${ep.still_path}` : undefined,
            voteAverage: typeof ep.vote_average === 'number' ? ep.vote_average : undefined,
        }))
}

export async function fetchSeasonsList(tmdbId: number, signal?: AbortSignal): Promise<SeasonInfo[]> {
    const data = await proxyFetch<{ seasons?: Array<{ season_number: number; name?: string; episode_count?: number; air_date?: string; poster_path?: string | null; overview?: string }> }>(
        `tv/${tmdbId}`,
        signal
    )
    if (!data?.seasons) return []
    return data.seasons
        .filter(s => s && typeof s.season_number === 'number' && s.season_number >= 0)
        .map(s => ({
            seasonNumber: s.season_number,
            name: s.name || (s.season_number === 0 ? 'Specials' : `Season ${s.season_number}`),
            episodeCount: s.episode_count || 0,
            airDate: s.air_date,
            poster: s.poster_path ? `${TMDB_IMAGE_BASE}/w500${s.poster_path}` : undefined,
            overview: s.overview,
        }))
        .sort((a, b) => b.seasonNumber - a.seasonNumber)
}

export const TMDB_GENRE_MAP = TMDB_GENRES

export interface SearchResult {
    id: string
    tmdbId: number
    type: 'movie' | 'series'
    name: string
    year?: string
    poster?: string
    backdrop?: string
    overview?: string
    voteAverage?: number
}

export async function searchMedia(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
    if (!query.trim()) return []
    const data = await proxyFetch<{ results?: Array<Record<string, unknown>> }>(
        `search/multi?query=${encodeURIComponent(query.trim())}&include_adult=false`,
        signal
    )
    if (!data?.results) return []
    return data.results
        .filter((r): r is Record<string, unknown> => !!r && (r.media_type === 'movie' || r.media_type === 'tv') && typeof r.id === 'number')
        .slice(0, 20)
        .map(r => {
            const relDate = (r.release_date as string) || (r.first_air_date as string)
            const posterPath = r.poster_path as string | null | undefined
            const backdropPath = r.backdrop_path as string | null | undefined
            return {
                id: `tmdb:${r.id}`,
                tmdbId: r.id as number,
                type: r.media_type === 'tv' ? 'series' as const : 'movie' as const,
                name: (r.title as string) || (r.name as string) || 'Unknown',
                year: relDate ? relDate.slice(0, 4) : undefined,
                poster: posterPath ? `${TMDB_IMAGE_BASE}/w500${posterPath}` : undefined,
                backdrop: backdropPath ? `${TMDB_IMAGE_BASE}/original${backdropPath}` : undefined,
                overview: r.overview as string | undefined,
                voteAverage: typeof r.vote_average === 'number' ? r.vote_average : undefined,
            }
        })
}

export async function searchCinemeta(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
    if (!query.trim()) return []
    try {
        const res = await fetch(
            `https://v3-cinemeta.strem.io/catalog/search/top/search=${encodeURIComponent(query.trim())}.json`,
            { signal }
        )
        if (!res.ok) return []
        const data = await res.json()
        if (!Array.isArray(data?.metas)) return []
        return data.metas
            .filter((m: Record<string, unknown>) => m && (m.type === 'movie' || m.type === 'series'))
            .slice(0, 20)
            .map((m: Record<string, unknown>) => ({
                id: String(m.id ?? m.imdb_id ?? ''),
                tmdbId: 0,
                type: m.type as 'movie' | 'series',
                name: String(m.name ?? 'Unknown'),
                year: typeof m.year === 'string' ? m.year : undefined,
                poster: typeof m.poster === 'string' ? m.poster : undefined,
                overview: typeof m.description === 'string' ? m.description : undefined,
                voteAverage: typeof m.imdbRating === 'string' ? parseFloat(m.imdbRating) : undefined,
            }))
    } catch {
        return []
    }
}

export async function fetchTmdbImdbId(
    tmdbId: number,
    mediaType: TmdbMediaType,
    signal?: AbortSignal
): Promise<string | null> {
    const data = await proxyFetch<{ imdb_id?: string }>(
        `${mediaType}/${tmdbId}/external_ids`,
        signal
    )
    return data?.imdb_id ?? null
}

export async function fetchTmdbDetailsAsMeta(
    tmdbId: number,
    mediaType: TmdbMediaType,
    signal?: AbortSignal
): Promise<{ meta: Partial<CinemetaMeta>; imdbId: string | null; trailerYouTubeId: string | null }> {
    const appendParams = mediaType === 'movie'
        ? 'videos,credits,aggregate_credits,recommendations,reviews,release_dates,images,keywords,translations,similar,external_ids,watch/providers'
        : 'videos,credits,aggregate_credits,recommendations,reviews,content_ratings,images,keywords,translations,similar,external_ids,watch/providers'

    const data = await proxyFetch<TmdbDetailsPayload & {
        created_by?: Array<{ id: number; name?: string; profile_path?: string | null }>
        aggregate_credits?: { cast?: TmdbCastMember[]; crew?: Array<TmdbCastMember & { job?: string; department?: string }> }
        recommendations?: TmdbPagedPayload
        similar?: TmdbPagedPayload
        reviews?: { results?: Array<{ author?: string; author_details?: { avatar_path?: string | null; rating?: number }; content?: string; created_at?: string }> }
        production_companies?: Array<{ name: string; logo_path?: string | null }>
        networks?: Array<{ name: string; logo_path?: string | null }>
        status?: string
        original_language?: string
        images?: { logos?: Array<{ file_path?: string; iso_639_1?: string; vote_average?: number }>; backdrops?: Array<{ file_path?: string; vote_average?: number }>; posters?: Array<{ file_path?: string; vote_average?: number }> }
        keywords?: { keywords?: Array<{ id: number; name?: string }>; results?: Array<{ id: number; name?: string }> }
        translations?: { translations?: Array<{ iso_639_1?: string; data?: { overview?: string; tagline?: string } }> }
        external_ids?: { imdb_id?: string; tvdb_id?: number }
        belongs_to_collection?: { id: number; name?: string; poster_path?: string | null; backdrop_path?: string | null }
        'watch/providers'?: { results?: Record<string, { flatrate?: Array<{ provider_name?: string; logo_path?: string | null; provider_id?: number }>; free?: Array<{ provider_name?: string; logo_path?: string | null; provider_id?: number }> }> }
    }>(
        `${mediaType}/${tmdbId}?append_to_response=${appendParams}`,
        signal
    )
    if (!data) return { meta: {}, imdbId: null, trailerYouTubeId: null }

    let certification: string | undefined = undefined
    if (mediaType === 'movie' && (data as Record<string, any>).release_dates?.results) {
        const usRel = (data as Record<string, any>).release_dates.results.find((r: any) => r.iso_3166_1 === 'US')
        if (usRel && Array.isArray(usRel.release_dates)) {
            const cert = usRel.release_dates.find((d: any) => d.certification && d.certification.trim())?.certification
            if (cert) certification = cert.trim()
        }
    } else if (mediaType === 'tv' && (data as Record<string, any>).content_ratings?.results) {
        const usRating = (data as Record<string, any>).content_ratings.results.find((r: any) => r.iso_3166_1 === 'US')
        if (usRating?.rating && usRating.rating.trim()) certification = usRating.rating.trim()
    }

    const genres = Array.isArray(data.genres) && data.genres.length > 0
        ? data.genres.map(g => g.name).filter((n): n is string => typeof n === 'string')
        : []

    const rawCastSources = [
        ...(Array.isArray(data.credits?.cast) ? data.credits.cast : []),
        ...(Array.isArray(data.aggregate_credits?.cast) ? data.aggregate_credits.cast : []),
    ]

    const castMap = new Map<string, { name: string; character?: string; photo?: string; order?: number }>()
    for (const c of rawCastSources) {
        if (!c || !c.name || !c.name.trim()) continue
        const key = c.name.trim().toLowerCase()
        const photo = c.profile_path ? `${TMDB_IMAGE_BASE}/w500${c.profile_path}` : undefined
        const character = c.character || (Array.isArray(c.roles) && c.roles[0]?.character ? c.roles[0].character : undefined)
        const order = typeof c.order === 'number' ? c.order : 999
        if (!castMap.has(key)) {
            castMap.set(key, { name: c.name.trim(), character, photo, order })
        } else {
            const existing = castMap.get(key)!
            if (photo && !existing.photo) castMap.set(key, { ...existing, photo })
            if (character && !existing.character) castMap.set(key, { ...castMap.get(key)!, character })
            if (order < (existing.order ?? 999)) castMap.set(key, { ...castMap.get(key)!, order })
        }
    }
    const cast = Array.from(castMap.values())
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
        .slice(0, 100)

    const directorMap = new Map<string, { name: string; photo?: string }>()
    const crewMap = new Map<string, { name: string; role: string; photo?: string }>()

    if (Array.isArray(data.created_by)) {
        for (const c of data.created_by) {
            if (c?.name) {
                const key = c.name.toLowerCase()
                directorMap.set(key, {
                    name: c.name,
                    photo: c.profile_path ? `${TMDB_IMAGE_BASE}/w500${c.profile_path}` : undefined,
                })
                crewMap.set(key, {
                    name: c.name,
                    role: 'Creator',
                    photo: c.profile_path ? `${TMDB_IMAGE_BASE}/w500${c.profile_path}` : undefined,
                })
            }
        }
    }

    const crewSources = [
        ...(Array.isArray(data.credits?.crew) ? data.credits.crew : []),
        ...(Array.isArray(data.aggregate_credits?.crew) ? data.aggregate_credits.crew : []),
    ]

    for (const c of crewSources) {
        if (!c?.name) continue
        const key = c.name.toLowerCase()

        const job = c.job || (Array.isArray(c.jobs) && c.jobs[0]?.job ? c.jobs[0].job : undefined)
        const dept = c.department

        const isDirector = job === 'Director' || dept === 'Directing' || (Array.isArray(c.jobs) && c.jobs.some((j: { job?: string }) => j.job === 'Director'))
        if (isDirector && !directorMap.has(key)) {
            directorMap.set(key, {
                name: c.name,
                photo: c.profile_path ? `${TMDB_IMAGE_BASE}/w500${c.profile_path}` : undefined,
            })
        }

        if (!crewMap.has(key)) {
            let role: string | null = null
            if (isDirector) role = 'Director'
            else if (job === 'Executive Producer' || job === 'Producer' || job === 'Co-Producer') role = job
            else if (job === 'Writer' || job === 'Screenplay' || job === 'Story' || dept === 'Writing') role = 'Writer'
            else if (job === 'Creator' || job === 'Novel') role = job
            else if (job === 'Original Music Composer' || job === 'Music') role = 'Composer'
            else if (job === 'Director of Photography' || job === 'Cinematography') role = 'Cinematographer'
            else if (job === 'Editor') role = 'Editor'

            if (role) {
                crewMap.set(key, {
                    name: c.name,
                    role,
                    photo: c.profile_path ? `${TMDB_IMAGE_BASE}/w500${c.profile_path}` : undefined,
                })
            }
        }
    }

    const directors = Array.from(directorMap.values())
    const crewList = Array.from(crewMap.values()).slice(0, 30)

    const rawVideos = Array.isArray((data as Record<string, any>).videos?.results) ? (data as Record<string, any>).videos.results : []
    const videoList = rawVideos
        .filter((v: any) => v.site === 'YouTube' && v.key)
        .map((v: any, idx: number) => {
            const rawName = typeof v.name === 'string' ? v.name.trim() : ''
            const isRawHash = !rawName || rawName === v.key || /^[A-Za-z0-9_-]{10,14}$/.test(rawName)
            const cleanTitle = !isRawHash
                ? rawName
                : `${v.type || 'Clip'} ${idx + 1}`
            return {
                key: v.key,
                name: cleanTitle,
                type: v.type || 'Trailer',
                official: !!v.official,
            }
        })

    const trailerKey = pickTrailerKey(data.videos)
    const releaseDate = data.release_date || data.first_air_date
    const year = releaseDate ? releaseDate.slice(0, 4) : undefined

    const rawReviews = Array.isArray((data as Record<string, any>).reviews?.results) ? (data as Record<string, any>).reviews.results : []
    const reviewsList = rawReviews.slice(0, 15).map((rev: any) => ({
        id: rev.id,
        author: rev.author || rev.author_details?.username || 'TMDB Reviewer',
        avatar: rev.author_details?.avatar_path
            ? (rev.author_details.avatar_path.startsWith('http')
                ? rev.author_details.avatar_path
                : `https://image.tmdb.org/t/p/w185${rev.author_details.avatar_path}`)
            : undefined,
        rating: typeof rev.author_details?.rating === 'number' ? rev.author_details.rating : undefined,
        content: rev.content || '',
        createdAt: rev.created_at || '',
        url: rev.url || '',
        source: 'TMDB',
    }))

    const rawRelated = [
        ...(Array.isArray(data.recommendations?.results) ? data.recommendations.results : []),
        ...(Array.isArray(data.similar?.results) ? data.similar.results : []),
    ]
    const relatedMap = new Map<number, TmdbListItem>()
    for (const item of rawRelated) {
        if (item && item.id && !relatedMap.has(item.id)) {
            relatedMap.set(item.id, item)
        }
    }
    const relatedList = Array.from(relatedMap.values())
        .slice(0, 20)
        .map(r => {
            const relDate = r.release_date || r.first_air_date
            return {
                id: String(r.id),
                title: r.title || r.name || 'Untitled',
                type: mediaType === 'tv' ? 'series' : 'movie',
                poster: r.poster_path ? `${TMDB_IMAGE_BASE}/w500${r.poster_path}` : undefined,
                backdrop: r.backdrop_path ? `${TMDB_IMAGE_BASE}/original${r.backdrop_path}` : undefined,
                year: relDate ? relDate.slice(0, 4) : undefined,
                voteAverage: typeof r.vote_average === 'number' ? Number(r.vote_average.toFixed(1)) : undefined,
            }
        })



    const rawLogos = Array.isArray(data.images?.logos) ? data.images.logos : []
    const bestLogo = rawLogos.find(l => l.iso_639_1 === 'en') ?? rawLogos[0]
    const logoUrl = bestLogo?.file_path ? `${TMDB_IMAGE_BASE}/w500${bestLogo.file_path}` : undefined

    const rawBackdrops = Array.isArray(data.images?.backdrops) ? data.images.backdrops : []
    const galleryBackdrops = rawBackdrops
        .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))
        .slice(0, 12)
        .map(b => b.file_path)
        .filter((p): p is string => !!p)
        .map(p => `${TMDB_IMAGE_BASE}/w780${p}`)

    const rawKeywords = data.keywords?.keywords ?? data.keywords?.results ?? []
    const keywordIds = rawKeywords.map(k => k.id).filter((id): id is number => typeof id === 'number')

    const collection = data.belongs_to_collection
        ? { id: data.belongs_to_collection.id, name: data.belongs_to_collection.name ?? '' }
        : undefined

    const wpResults = data['watch/providers']?.results ?? {}
    const wpRegion = wpResults['US'] ?? Object.values(wpResults)[0] as typeof wpResults[string] | undefined
    const watchProviders = [
        ...(wpRegion?.flatrate ?? []),
        ...(wpRegion?.free ?? []),
    ].slice(0, 10).map(p => ({
        name: p.provider_name ?? '',
        logo: p.logo_path ? `${TMDB_IMAGE_BASE}/w92${p.logo_path}` : undefined,
    })).filter(p => p.name)

    const meta: Partial<CinemetaMeta> = {
        name: data.title || data.name,
        poster: data.poster_path ? `${TMDB_IMAGE_BASE}/w500${data.poster_path}` : undefined,
        background: data.backdrop_path ? `${TMDB_IMAGE_BASE}/original${data.backdrop_path}` : undefined,
        logo: logoUrl,
        description: data.overview,
        genre: genres.join(', ') || undefined,
        runtime: typeof data.runtime === 'number' && data.runtime > 0 ? `${data.runtime} min` : undefined,
        cast: cast.length > 0 ? cast : undefined,
        director: directors.map(d => d.name).filter((n): n is string => typeof n === 'string'),
        crew: crewList.length > 0 ? crewList : undefined,
        imdbRating: typeof data.vote_average === 'number' && data.vote_average > 0
            ? data.vote_average.toFixed(1)
            : undefined,
        released: releaseDate,
        year,
        certification,
        videoList: videoList.length > 0 ? videoList : undefined,
        relatedList: relatedList.length > 0 ? relatedList : undefined,
        reviewsList: reviewsList.length > 0 ? reviewsList : undefined,
        status: (data as Record<string, any>).status,
        originalLanguage: (data as Record<string, any>).original_language,
        productionCompanies: Array.isArray((data as Record<string, any>).production_companies)
            ? (data as Record<string, any>).production_companies.map((c: any) => c.name).filter(Boolean)
            : undefined,
        networks: Array.isArray((data as Record<string, any>).networks)
            ? (data as Record<string, any>).networks.map((n: any) => n.name).filter(Boolean)
            : undefined,
        keywords: keywordIds.length > 0 ? keywordIds : undefined,
        collection,
        galleryBackdrops: galleryBackdrops.length > 0 ? galleryBackdrops : undefined,
        watchProviders: watchProviders.length > 0 ? watchProviders : undefined,
        tmdbId,
    }

    return {
        meta,
        imdbId: data.external_ids?.imdb_id ?? data.imdb_id ?? null,
        trailerYouTubeId: trailerKey ?? null,
    }
}

export const __testing = {
    mapDetailsToCanonical,
    mapListItemToCanonical,
    resolveTmdbIdFromCanonical,
    pickTrailerKey,
    extractYear,
    genresFromIds,
}
