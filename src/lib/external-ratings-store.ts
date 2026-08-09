import { useSyncExternalStore } from 'react'
import type { ExternalRating } from '@/lib/taste-profile'

const STORAGE_KEY = 'aiom_external_ratings'
const VERSION_KEY = 'aiom_external_ratings_v1'

let cache: ExternalRating[] = []
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

export function cacheExternalRatings(source: 'trakt' | 'pmdb', ratings: ExternalRating[]) {
    const tagged = ratings.map(r => ({ ...r, source }))
    cache = cache.filter(r => r.source !== source)
    cache = [...cache, ...tagged]
    persist()
    notify()
}

export function clearExternalRatings(source?: 'trakt' | 'pmdb') {
    if (source) {
        cache = cache.filter(r => r.source !== source)
    } else {
        cache = []
    }
    persist()
    notify()
}

export function getExternalRatings(): ExternalRating[] {
    return cache
}

export function subscribe(callback: () => void) {
    listeners.add(callback)
    return () => listeners.delete(callback)
}

export function useExternalRatings(): ExternalRating[] {
    return useSyncExternalStore(subscribe, getExternalRatings, getExternalRatings)
}
