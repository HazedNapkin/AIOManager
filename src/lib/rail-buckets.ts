import type { CanonicalId } from '@/api/metadata/types'
import type { RankedRail } from '@/lib/recommendation-engine'
import type { WatchlistItem } from '@/lib/watchlist'
import type { PmdbRail, PmdbRailItem } from '@/lib/pmdb-list-publisher'

export interface BucketItem {
    id: string
    title: string
    type: string
    poster?: string
    year?: number
    genres?: string[]
    genreIds?: number[]
    voteAverage?: number
    backdrop?: string
}

export interface RailBuckets {
    movies: BucketItem[]
    series: BucketItem[]
    anime: BucketItem[]
    watchlist: WatchlistItem[]
}

export function itemIdFromCanonical(id: CanonicalId): string {
    if (id.imdb) return id.imdb
    if (typeof id.tmdb === 'number') return `tmdb:${id.tmdb}`
    return id.slug
}

export function bucketize(
    rails: RankedRail[],
    watchlist: WatchlistItem[],
    extraItems: BucketItem[] = [],
): RailBuckets {
    const seen = new Set<string>()
    for (const w of watchlist) seen.add(w.itemId)

    const movies: BucketItem[] = []
    const series: BucketItem[] = []
    const anime: BucketItem[] = []

    const push = (item: BucketItem) => {
        if (seen.has(item.id)) return
        seen.add(item.id)
        if (item.type === 'anime') anime.push(item)
        else if (item.type === 'series') series.push(item)
        else movies.push(item)
    }

    for (const rail of rails) {
        for (const rec of rail.items) {
            push({
                id: itemIdFromCanonical(rec.id),
                title: rec.title,
                type: rec.type,
                poster: rec.poster,
                year: rec.year,
                genres: rec.genres,
                genreIds: rec.genreIds,
                voteAverage: rec.voteAverage,
                backdrop: rec.backdrop,
            })
        }
    }

    for (const item of extraItems) {
        push(item)
    }

    return { movies, series, anime, watchlist }
}

export function bucketsToPmdbRails(buckets: RailBuckets, maxPerRail?: number): PmdbRail[] {
    const cap = (items: BucketItem[]) => maxPerRail ? items.slice(0, maxPerRail) : items
    const toItems = (items: BucketItem[], type: 'movie' | 'series'): PmdbRailItem[] =>
        cap(items)
            .filter(i => i.id.startsWith('tmdb:'))
            .map(i => ({ id: i.id, type, name: i.title, poster: i.poster }))

    const out: PmdbRail[] = []
    const movies = toItems(buckets.movies, 'movie')
    const series = toItems(buckets.series, 'series')
    const anime = toItems(buckets.anime, 'series')

    if (movies.length > 0) out.push({ railName: 'Movies', railKey: 'recommended_movies', items: movies })
    if (series.length > 0) out.push({ railName: 'Series', railKey: 'recommended_series', items: series })
    if (anime.length > 0) out.push({ railName: 'Anime', railKey: 'recommended_anime', items: anime })
    if (buckets.watchlist.length > 0) {
        const wl = maxPerRail ? buckets.watchlist.slice(0, maxPerRail) : buckets.watchlist
        out.push({
            railName: 'Watchlist',
            railKey: 'watchlist',
            items: wl.map(w => ({
                id: w.itemId,
                type: w.type === 'movie' ? 'movie' : 'series',
                name: w.name || 'Unknown',
                poster: w.poster,
            })),
        })
    }

    return out
}
