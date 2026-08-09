import { useSyncExternalStore } from 'react'

export interface WatchlistSeed {
    imdbId: string | null
    tmdbId: number | null
    title: string
    type: 'movie' | 'series'
    source: 'trakt' | 'simkl'
}

const STORAGE_KEY = 'aiom_external_watchlist'
const VERSION_KEY = 'aiom_external_watchlist_v1'

let cache: WatchlistSeed[] = []
const listeners = new Set<() => void>()

function loadFromStorage() {
    try {
        const raw = localStorage.getItem(VERSION_KEY)
        if (raw !== '1') return
        const data = localStorage.getItem(STORAGE_KEY)
        if (!data) return
        const parsed = JSON.parse(data)
        if (Array.isArray(parsed)) cache = parsed
    } catch {
    }
}

function persist() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
        localStorage.setItem(VERSION_KEY, '1')
    } catch {
    }
}

loadFromStorage()

function notify() {
    for (const fn of listeners) fn()
}

export function cacheWatchlist(source: 'trakt' | 'simkl', items: WatchlistSeed[]) {
    const tagged = items.map(i => ({ ...i, source }))
    cache = cache.filter(i => i.source !== source)
    cache = [...cache, ...tagged]
    persist()
    notify()
}

export function clearWatchlist(source?: 'trakt' | 'simkl') {
    if (source) {
        cache = cache.filter(i => i.source !== source)
    } else {
        cache = []
    }
    persist()
    notify()
}

export function getWatchlist(): WatchlistSeed[] {
    return cache
}

function subscribe(callback: () => void) {
    listeners.add(callback)
    return () => listeners.delete(callback)
}

export function useExternalWatchlist(): WatchlistSeed[] {
    return useSyncExternalStore(subscribe, getWatchlist, getWatchlist)
}
