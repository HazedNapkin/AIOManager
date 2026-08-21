import type { RankedRail, ScoredRecommendation } from './recommendation-engine.ts'

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io'
const GENRE_CAP_RATIO = 0.4

export interface CinemetaRailItem extends ScoredRecommendation {
    cast?: string[]
    director?: string[]
    status?: string
}

export interface CinemetaRailsOptions {
    watchedImdbIds?: Set<string>
}

export function parseYearFromReleaseInfo(releaseInfo: unknown, year: unknown): number | undefined {
    if (typeof releaseInfo === 'string') {
        const m = releaseInfo.match(/^(\d{4})/)
        if (m) return Number(m[1])
    }
    if (typeof year === 'string') {
        const m = year.match(/^(\d{4})/)
        if (m) return Number(m[1])
    }
    if (typeof year === 'number' && Number.isInteger(year) && year > 1800 && year < 2200) return year
    return undefined
}

function toStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined
    const out = value.filter((x): x is string => typeof x === 'string' && x.length > 0)
    return out.length > 0 ? out : undefined
}

function parseGenres(raw: Record<string, unknown>): string[] | undefined {
    const fromGenres = toStringArray(raw.genres)
    if (fromGenres) return fromGenres
    if (typeof raw.genre === 'string') {
        const split = raw.genre.split(',').map(g => g.trim()).filter(Boolean)
        if (split.length > 0) return split
    }
    return toStringArray(raw.genre)
}

function parseFirstTrailerYouTubeId(value: unknown): string | undefined {
    if (!Array.isArray(value)) return undefined
    for (const t of value) {
        const source = t && typeof t === 'object' ? (t as Record<string, unknown>).source : undefined
        if (typeof source === 'string' && source.length > 0) return source
    }
    return undefined
}

export function mapCinemetaMetaToRecommendation(raw: Record<string, unknown>, type: 'movie' | 'series'): CinemetaRailItem {
    const imdbId = typeof raw.id === 'string' ? raw.id : ''
    const parsedRating = typeof raw.imdbRating === 'number' ? raw.imdbRating : parseFloat(String(raw.imdbRating ?? ''))
    const rating = Number.isFinite(parsedRating) && parsedRating > 0 ? parsedRating : undefined
    const parsedPopularity = typeof raw.popularity === 'number' ? raw.popularity : parseFloat(String(raw.popularity ?? ''))
    const popularity = Number.isFinite(parsedPopularity) && parsedPopularity > 0 ? parsedPopularity : undefined
    const parsedRuntime = typeof raw.runtime === 'number' ? raw.runtime : parseInt(String(raw.runtime ?? ''), 10)
    const runtime = Number.isFinite(parsedRuntime) && parsedRuntime > 0 ? parsedRuntime : undefined

    const item: CinemetaRailItem = {
        id: { imdb: imdbId, slug: imdbId },
        title: typeof raw.name === 'string' && raw.name ? raw.name : 'Unknown',
        type: type === 'series' ? 'series' : 'movie',
        poster: typeof raw.poster === 'string' && raw.poster ? raw.poster : undefined,
        backdrop: typeof raw.background === 'string' && raw.background ? raw.background : undefined,
        description: typeof raw.description === 'string' && raw.description ? raw.description : undefined,
        year: parseYearFromReleaseInfo(raw.releaseInfo, raw.year),
        voteAverage: rating,
        voteCount: 0,
        score: rating ?? popularity ?? 0,
        source: 'cinemeta',
    }
    const genres = parseGenres(raw)
    if (genres) item.genres = genres
    const cast = toStringArray(raw.cast)
    if (cast) item.cast = cast
    const director = toStringArray(raw.director)
    if (director) item.director = director
    if (runtime) item.runtime = runtime
    const trailerYouTubeId = parseFirstTrailerYouTubeId(raw.trailers)
    if (trailerYouTubeId) item.trailerYouTubeId = trailerYouTubeId
    if (type === 'series' && typeof raw.status === 'string' && raw.status) item.status = raw.status
    return item
}

export function capGenre<T extends { genres?: string[] }>(items: T[], ratio: number): T[] {
    const maxPerGenre = Math.ceil(items.length * ratio)
    const counts: Record<string, number> = {}
    const out: T[] = []
    for (const item of items) {
        const primary = item.genres?.[0]
        if (!primary || (counts[primary] ?? 0) < maxPerGenre) {
            if (primary) counts[primary] = (counts[primary] ?? 0) + 1
            out.push(item)
        }
    }
    return out
}

// Cinemeta never returns HTTP errors; degraded responses are 200s with empty metas (docs/cinemeta-api-surface.md §2).
async function fetchCinemetaCatalogPage(type: 'movie' | 'series', skip: number): Promise<Record<string, unknown>[]> {
    try {
        const suffix = skip > 0 ? `/skip=${skip}` : ''
        const res = await fetch(`${CINEMETA_BASE}/catalog/${type}/top${suffix}.json`, {
            signal: AbortSignal.timeout(15_000),
        })
        if (!res.ok) return []
        const data = await res.json()
        return Array.isArray(data?.metas) ? (data.metas as Record<string, unknown>[]) : []
    } catch {
        return []
    }
}

const CATALOG_TTL_MS = 24 * 60 * 60 * 1000 // matches the Cinemeta CDN catalog lifetime

interface CatalogPages {
    page0: Record<string, unknown>[]
    rest: Record<string, unknown>[]
}

interface CinemetaCatalogs {
    movie: CatalogPages
    series: CatalogPages
}

let catalogPromise: Promise<CinemetaCatalogs | null> | null = null
let catalogFetchedAt = 0

// Singleflight deep fetch shared by every caller per TTL window. Caller signals are not
// forwarded: the shared fetch outlives any one mount and callers discard stale results.
function loadCinemetaCatalogs(): Promise<CinemetaCatalogs | null> {
    if (catalogPromise && Date.now() - catalogFetchedAt < CATALOG_TTL_MS) return catalogPromise
    catalogFetchedAt = Date.now()
    catalogPromise = (async () => {
        const [moviePage0, movieRest, seriesPage0, seriesRest] = await Promise.all([
            fetchCinemetaCatalogPage('movie', 0),
            fetchCinemetaCatalogPage('movie', 50),
            fetchCinemetaCatalogPage('series', 0),
            fetchCinemetaCatalogPage('series', 50),
        ])
        const total = moviePage0.length + movieRest.length + seriesPage0.length + seriesRest.length
        if (total === 0) return null
        return {
            movie: { page0: moviePage0, rest: movieRest },
            series: { page0: seriesPage0, rest: seriesRest },
        }
    })()
    // All-empty or half-empty (one type's both pages empty) responses are degraded
    // fetches, not catalogs — the current caller still gets best-effort data, but the
    // next caller refetches instead of inheriting it for the full TTL.
    catalogPromise.then(catalogs => {
        const movieDegraded = !catalogs || catalogs.movie.page0.length + catalogs.movie.rest.length === 0
        const seriesDegraded = !catalogs || catalogs.series.page0.length + catalogs.series.rest.length === 0
        if (movieDegraded || seriesDegraded) catalogPromise = null
    })
    return catalogPromise
}

function buildRail(
    metas: Record<string, unknown>[],
    type: 'movie' | 'series',
    title: string,
    railSize: number,
    watched: ReadonlySet<string> | undefined
): RankedRail | null {
    const seen = new Set<string>()
    const items: CinemetaRailItem[] = []
    for (const raw of metas) {
        const item = mapCinemetaMetaToRecommendation(raw, type)
        if (!item.id.imdb || seen.has(item.id.imdb)) continue
        seen.add(item.id.imdb)
        if (watched?.has(item.id.imdb)) continue
        items.push(item)
    }
    const capped = capGenre(items, GENRE_CAP_RATIO).slice(0, railSize)
    if (capped.length === 0) return null
    return { title, source: 'trending', items: capped }
}

export async function buildCinemetaFatRails(
    signal?: AbortSignal,
    railSize = 20,
    opts?: CinemetaRailsOptions
): Promise<RankedRail[]> {
    const watched = opts?.watchedImdbIds && opts.watchedImdbIds.size > 0 ? opts.watchedImdbIds : undefined
    const catalogs = await loadCinemetaCatalogs()
    if (!catalogs || signal?.aborted) return []
    // Shallow callers keep the exact page-0-only pool they fetched before the cache;
    // capGenre's per-genre caps are pool-size dependent, so widening the pool would
    // otherwise change rail composition for them.
    const movieMetas = watched ? [...catalogs.movie.page0, ...catalogs.movie.rest] : catalogs.movie.page0
    const seriesMetas = watched ? [...catalogs.series.page0, ...catalogs.series.rest] : catalogs.series.page0
    const rails: RankedRail[] = []
    const movieRail = buildRail(movieMetas, 'movie', 'Popular Movies', railSize, watched)
    if (movieRail) rails.push(movieRail)
    const seriesRail = buildRail(seriesMetas, 'series', 'Popular Series', railSize, watched)
    if (seriesRail) rails.push(seriesRail)
    return rails
}
