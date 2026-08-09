import localforage from 'localforage'
import { searchTmdbPerson } from '@/api/metadata/adapters/tmdb'

const personPhotoCache = new Map<string, string | null>()
const PERSON_PHOTO_CACHE_MAX = 1000

function setPersonPhotoCache(key: string, value: string | null): void {
    personPhotoCache.set(key, value)
    if (personPhotoCache.size > PERSON_PHOTO_CACHE_MAX) {
        const oldest = personPhotoCache.keys().next().value
        if (oldest !== undefined) personPhotoCache.delete(oldest)
    }
}

const inFlightPhotos = new Map<string, Promise<string | null>>()

const PHOTO_CACHE_KEY = 'aiom_person_photos'
const PHOTO_CACHE_TTL = 7 * 24 * 60 * 60 * 1000
let photoStoreLoaded = false

export async function ensurePhotoStoreLoaded(): Promise<void> {
    if (photoStoreLoaded) return
    photoStoreLoaded = true
    try {
        const stored = await localforage.getItem<{ entries: Record<string, { url: string | null; ts: number }>; ts: number }>(PHOTO_CACHE_KEY)
        if (stored && Date.now() - stored.ts < PHOTO_CACHE_TTL) {
            for (const [name, entry] of Object.entries(stored.entries)) {
                setPersonPhotoCache(name, entry.url)
            }
        }
    } catch {}
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

function persistPhotoStore(): void {
    try {
        const entries: Record<string, { url: string | null; ts: number }> = {}
        for (const [name, url] of personPhotoCache) {
            entries[name] = { url, ts: Date.now() }
        }
        localforage.setItem(PHOTO_CACHE_KEY, { entries, ts: Date.now() })
    } catch {}
}

export function debouncedPersist(): void {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(persistPhotoStore, 2000)
}

export async function resolvePersonPhoto(name: string): Promise<string | null> {
    const key = name.trim().toLowerCase()
    if (!key) return null
    if (personPhotoCache.has(key)) return personPhotoCache.get(key) ?? null
    if (inFlightPhotos.has(key)) return inFlightPhotos.get(key)!
    const promise = (async () => {
        try {
            const person = await searchTmdbPerson(name.trim())
            const path = person?.profilePath
            const url = path ? `https://image.tmdb.org/t/p/w185${path}` : null
            setPersonPhotoCache(key, url)
            return url
        } catch {
            setPersonPhotoCache(key, null)
            return null
        } finally {
            inFlightPhotos.delete(key)
        }
    })()
    inFlightPhotos.set(key, promise)
    return promise
}

export function getCastPhotoUrl(photo?: string): string | null {
    if (!photo) return null
    if (photo.startsWith('http')) return photo
    return `https://image.tmdb.org/t/p/w500${photo.startsWith('/') ? '' : '/'}${photo}`
}
