// Cinemeta meta cache, deliberately free of `@/` path-alias imports so it stays
// resolvable under the node:test runner (see utils.ts for the convention).
//
// The fetch is shared by every caller that needs name/poster/genres for an item —
// including the library-refresh transforms, which resolve one fetch PER EPISODE ROW.
// Two properties keep a 20-episode watch-history refresh from becoming 20 upstream
// fetches: the 24h result cache, and in-flight dedupe added here — before it, N
// concurrent transforms for the same show (an episode list) each missed the cache
// (it only fills after completion) and fired N identical full-detail downloads.

export interface CinemetaCastMember {
    name?: string
    character?: string
    photo?: string
}

export interface CinemetaDirectorMember {
    name?: string
    photo?: string
}

export interface CinemetaCrewMember {
    name: string
    role: string
    photo?: string
}

export interface CinemetaVideo {
    key: string
    name: string
    type: string
    official?: boolean
}

export interface CinemetaRelatedItem {
    id: string
    title: string
    type: string
    poster?: string
    backdrop?: string
    year?: string
    voteAverage?: number
}

export interface CinemetaReview {
    id?: string
    author: string
    avatar?: string
    rating?: number
    content: string
    createdAt?: string
    source?: string
}

export interface CinemetaMeta {
    id?: string
    type?: string
    name?: string
    poster?: string
    background?: string
    logo?: string
    description?: string
    genre?: string
    runtime?: string
    cast?: CinemetaCastMember[]
    director?: Array<string | CinemetaDirectorMember> | string
    crew?: CinemetaCrewMember[]
    imdbRating?: string
    released?: string
    year?: string
    trailers?: Array<{ source: string; type: string }>
    videoList?: CinemetaVideo[]
    relatedList?: CinemetaRelatedItem[]
    reviewsList?: CinemetaReview[]
    status?: string
    originalLanguage?: string
    productionCompanies?: string[]
    networks?: string[]
    certification?: string
    keywords?: number[]
    collection?: { id: number; name: string }
    galleryBackdrops?: string[]
    watchProviders?: Array<{ name: string; logo?: string }>
    tmdbId?: number
}

interface CinemetaCacheEntry {
    meta: CinemetaMeta | null
    fetchedAt: number
}

const cinemetaCache = new Map<string, CinemetaCacheEntry>()
const cinemetaInFlight = new Map<string, Promise<CinemetaMeta | null>>()
const CINEMETA_TTL = 24 * 60 * 60 * 1000
const CINEMETA_NULL_TTL = 5 * 60 * 1000

export function parseCinemetaGenres(meta: CinemetaMeta | undefined | null): string[] {
    if (!meta || typeof meta.genre !== 'string' || !meta.genre.trim()) return []
    return meta.genre.split(',').map(g => g.trim()).filter(Boolean)
}

const remember = (imdbId: string, meta: CinemetaMeta | null) => {
    cinemetaCache.set(imdbId, { meta, fetchedAt: Date.now() })
}

async function fetchCinemetaUncached(imdbId: string, mediaType: string): Promise<CinemetaMeta | null> {
    try {
        const res = await fetch(`https://cinemeta-live.strem.io/meta/${mediaType}/${imdbId}.json`, { signal: AbortSignal.timeout(8000) })
        if (!res.ok) {
            if (import.meta.env?.DEV) console.warn(`[Cinemeta] ${res.status} for ${imdbId} (${mediaType})`)
            remember(imdbId, null)
            return null
        }
        const data = await res.json()
        const raw: Record<string, unknown> | null = data?.meta ?? null
        if (!raw) {
            remember(imdbId, null)
            return null
        }

        const TMDB_IMG = 'https://image.tmdb.org/t/p/w185'
        const creditsCast = Array.isArray(raw.credits_cast) ? raw.credits_cast : []
        const cast: CinemetaCastMember[] = creditsCast
            .filter((c): c is Record<string, unknown> => c && typeof c === 'object')
            .map(c => ({
                name: typeof c.name === 'string' ? c.name : undefined,
                character: typeof c.character === 'string' ? c.character : undefined,
                photo: typeof c.profile_path === 'string' && c.profile_path ? `${TMDB_IMG}${c.profile_path}` : undefined,
            }))

        const creditsCrew = Array.isArray(raw.credits_crew) ? raw.credits_crew : []
        const crew: CinemetaCrewMember[] = creditsCrew
            .filter((c): c is Record<string, unknown> => c && typeof c === 'object')
            .map(c => ({
                name: typeof c.name === 'string' ? c.name : '',
                role: typeof c.job === 'string' ? c.job : (typeof c.role === 'string' ? c.role : ''),
                photo: typeof c.profile_path === 'string' && c.profile_path ? `${TMDB_IMG}${c.profile_path}` : undefined,
            }))

        const rawDirector = raw.director
        let director: CinemetaMeta['director']
        if (Array.isArray(rawDirector)) {
            director = rawDirector.map(d => {
                if (typeof d === 'string') return d
                if (d && typeof d === 'object') {
                    const obj = d as Record<string, unknown>
                    return { name: String(obj.name ?? ''), photo: typeof obj.profile_path === 'string' && obj.profile_path ? `${TMDB_IMG}${obj.profile_path}` : undefined }
                }
                return String(d)
            })
        } else if (typeof rawDirector === 'string') {
            director = rawDirector
        }

        const trailers = Array.isArray(raw.trailers) ? raw.trailers : []
        const videoList: CinemetaVideo[] = trailers
            .filter((t): t is Record<string, unknown> => t && typeof t === 'object')
            .filter(t => t.type === 'Trailer' || t.type === 'Teaser')
            .map(t => ({
                key: String(t.source ?? ''),
                name: String(t.name ?? t.type ?? 'Trailer'),
                type: String(t.type ?? 'Trailer'),
            }))
            .filter(v => v.key)

        const rawRelated = Array.isArray(raw.related) ? raw.related : []
        const relatedList: CinemetaRelatedItem[] = rawRelated
            .filter((r): r is Record<string, unknown> => r && typeof r === 'object')
            .map(r => ({
                id: String(r.id ?? ''),
                title: String(r.name ?? 'Unknown'),
                type: String(r.type ?? 'movie'),
                poster: typeof r.poster === 'string' ? r.poster : undefined,
            }))
            .filter(r => r.id)

        const meta: CinemetaMeta = {
            id: typeof raw.id === 'string' ? raw.id : imdbId,
            type: typeof raw.type === 'string' ? raw.type : mediaType,
            name: typeof raw.name === 'string' ? raw.name : undefined,
            poster: typeof raw.poster === 'string' ? raw.poster : undefined,
            background: typeof raw.background === 'string' ? raw.background : undefined,
            logo: typeof raw.logo === 'string' ? raw.logo : undefined,
            description: typeof raw.description === 'string' ? raw.description : undefined,
            genre: typeof raw.genre === 'string' ? raw.genre : (Array.isArray(raw.genres) ? raw.genres.join(', ') : undefined),
            runtime: typeof raw.runtime === 'string' ? raw.runtime : undefined,
            cast: cast.length > 0 ? cast : undefined,
            director,
            crew: crew.length > 0 ? crew : undefined,
            imdbRating: typeof raw.imdbRating === 'string' ? raw.imdbRating : undefined,
            released: typeof raw.released === 'string' ? raw.released : (typeof raw.releaseInfo === 'string' ? raw.releaseInfo.slice(0, 4) : undefined),
            year: typeof raw.year === 'string' ? raw.year : (typeof raw.releaseInfo === 'string' ? raw.releaseInfo.slice(0, 4) : undefined),
            trailers,
            videoList: videoList.length > 0 ? videoList : undefined,
            relatedList: relatedList.length > 0 ? relatedList : undefined,
            reviewsList: Array.isArray(raw.reviews) ? raw.reviews as CinemetaReview[] : undefined,
            status: typeof raw.status === 'string' ? raw.status : undefined,
            originalLanguage: typeof raw.language === 'string' ? raw.language : undefined,
            productionCompanies: Array.isArray(raw.production_companies) ? raw.production_companies.map(String) : undefined,
            tmdbId: typeof raw.moviedb_id === 'number' ? raw.moviedb_id : undefined,
        }

        remember(imdbId, meta)
        return meta
    } catch {
        remember(imdbId, null)
        return null
    }
}

export async function fetchCinemetaDetail(imdbId: string, type?: string): Promise<CinemetaMeta | null> {
    if (!imdbId || !imdbId.startsWith('tt')) return null
    const cached = cinemetaCache.get(imdbId)
    if (cached && Date.now() - cached.fetchedAt < (cached.meta ? CINEMETA_TTL : CINEMETA_NULL_TTL)) {
        return cached.meta
    }
    const mediaType = type === 'movie' ? 'movie' : 'series'
    // In-flight dedupe: concurrent callers for the same id+type share one fetch.
    // The cache alone cannot do this — it only fills after the fetch completes,
    // so a burst of episode rows for one show all missed it.
    const flightKey = `${mediaType}:${imdbId}`
    let flight = cinemetaInFlight.get(flightKey)
    if (!flight) {
        flight = fetchCinemetaUncached(imdbId, mediaType).finally(() => {
            cinemetaInFlight.delete(flightKey)
        })
        cinemetaInFlight.set(flightKey, flight)
    }
    return flight
}

export function getCachedCinemetaName(imdbId: string): string | null {
    if (!imdbId || !imdbId.startsWith('tt')) return null
    const cached = cinemetaCache.get(imdbId)
    if (!cached || !cached.meta) return null
    if (Date.now() - cached.fetchedAt > CINEMETA_TTL) return null
    return cached.meta.name?.trim() || null
}
