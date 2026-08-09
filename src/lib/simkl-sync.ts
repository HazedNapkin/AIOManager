import { authedFetch } from '@/api/metadata/adapters/shared-fetch'

export interface SimklSyncData {
    watched: SimklItem[]
    ratings: SimklRatedItem[]
    watchlist: SimklItem[]
}

export interface SimklItem {
    imdbId: string | null
    tmdbId: number | null
    tvdbId: number | null
    title: string
    year: number | null
    type: 'movie' | 'series'
}

export interface SimklRatedItem extends SimklItem {
    rating: number
    ratedAt: string
}

export interface SimklStatus {
    connected: boolean
    configured: boolean
}

export async function startSimklAuth(): Promise<{ url: string } | null> {
    const res = await authedFetch('/api/auth/simkl/start')
    if (!res.ok) return null
    return res.json()
}

export async function getSimklStatus(): Promise<SimklStatus | null> {
    try {
        const res = await authedFetch('/api/simkl/status')
        if (!res.ok) return null
        return res.json()
    } catch {
        return null
    }
}

export async function disconnectSimkl(): Promise<boolean> {
    const res = await authedFetch('/api/simkl/disconnect', { method: 'DELETE' })
    return res.ok
}

export async function syncSimkl(): Promise<{ stats: { watched: number; rated: number; watchlist: number }; data: SimklSyncData } | null> {
    const res = await authedFetch('/api/simkl/sync')
    if (!res.ok) return null
    return res.json()
}

export function simklRatingToWeight(rating: number): number {
    if (rating >= 9) return 3.0
    if (rating >= 7) return 1.5
    if (rating >= 5) return 0.5
    if (rating >= 1) return -1.0
    return 0
}

export interface SimklRating {
    id: number
    type: string
    release_year?: number
    rank?: number
    simkl?: { rating: number; votes: number; droprate: string }
    imdb?: { rating: number; votes: number }
    mal?: { rating: number; votes: number; rank?: number }
}

export async function getSimklRatings(): Promise<SimklRating[]> {
    try {
        const res = await authedFetch('/api/simkl/ratings')
        if (!res.ok) return []
        return res.json()
    } catch { return [] }
}

export async function getSimklActivities(): Promise<Record<string, any>> {
    try {
        const res = await authedFetch('/api/simkl/activities')
        if (!res.ok) return {}
        return res.json()
    } catch { return {} }
}

export interface SimklTrendingItem {
    title: string
    year: number | null
    poster: string | null
    simklId: number | null
    type: string
    watchers: number
    rank: number
}

export async function getSimklTrending(type: 'movies' | 'tv' | 'anime'): Promise<SimklTrendingItem[]> {
    try {
        const res = await authedFetch(`/api/simkl/trending/${type}`)
        if (!res.ok) return []
        return res.json()
    } catch { return [] }
}
