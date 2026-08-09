import { authedFetch } from '@/api/metadata/adapters/shared-fetch'

export interface TraktSyncData {
    watched: TraktItem[]
    ratings: TraktRatedItem[]
    watchlist: TraktItem[]
}

export interface TraktItem {
    imdbId: string | null
    tmdbId: number | null
    tvdbId: number | null
    title: string
    year: number | null
    type: 'movie' | 'series'
}

export interface TraktRatedItem extends TraktItem {
    rating: number
    ratedAt: string
}

export interface TraktStatus {
    connected: boolean
    configured: boolean
}

export interface TraktComment {
    id: string
    author: string
    content: string
    rating?: number | null
    createdAt?: string
    likes: number
    replies: number
    source: string
}

export async function startTraktAuth(): Promise<{ url: string } | null> {
    const res = await authedFetch('/api/auth/trakt/start')
    if (!res.ok) return null
    return res.json()
}

export async function getTraktStatus(): Promise<TraktStatus | null> {
    try {
        const res = await authedFetch('/api/trakt/status')
        if (!res.ok) return null
        return res.json()
    } catch {
        return null
    }
}

export async function disconnectTrakt(): Promise<boolean> {
    const res = await authedFetch('/api/trakt/disconnect', { method: 'DELETE' })
    return res.ok
}

export async function syncTrakt(): Promise<{ stats: { watched: number; rated: number; watchlist: number }; data: TraktSyncData } | null> {
    const res = await authedFetch('/api/trakt/sync')
    if (!res.ok) return null
    return res.json()
}

export async function getTraktComments(type: string, id: string): Promise<TraktComment[]> {
    try {
        const res = await authedFetch(`/api/trakt/comments/${type}/${encodeURIComponent(id)}`)
        if (!res.ok) return []
        return res.json()
    } catch {
        return []
    }
}

export async function getTraktRecommendations(type: 'movie' | 'series'): Promise<TraktItem[]> {
    try {
        const res = await authedFetch(`/api/trakt/recommendations/${type}`)
        if (!res.ok) return []
        return res.json()
    } catch {
        return []
    }
}

export async function getTraktTrending(type: 'movie' | 'series'): Promise<Array<TraktItem & { watchers: number }>> {
    try {
        const res = await authedFetch(`/api/trakt/trending/${type}`)
        if (!res.ok) return []
        return res.json()
    } catch {
        return []
    }
}

export async function getTraktLastActivities(): Promise<Record<string, any>> {
    try {
        const res = await authedFetch('/api/trakt/last_activities')
        if (!res.ok) return {}
        return res.json()
    } catch {
        return {}
    }
}

export function ratingToWeight(rating: number): number {
    if (rating >= 9) return 3.0
    if (rating >= 7) return 1.5
    if (rating >= 5) return 0.5
    if (rating >= 1) return -1.0
    return 0
}

export function ratingToLabel(rating: number): string {
    if (rating >= 9) return 'loved'
    if (rating >= 7) return 'liked'
    if (rating >= 5) return 'neutral'
    return 'disliked'
}
