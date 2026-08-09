import localforage from 'localforage'
import { AddonManifest, AddonDescriptor } from '@/types/addon'

export interface CachedManifest {
    manifest: AddonManifest
    timestamp: number
}

const CACHE_TTL = 10 * 60 * 1000
const MAX_ENTRIES = 500
const PERSIST_KEY = 'aioman:manifest-cache'
const PERSIST_DEBOUNCE_MS = 2000

const FAILURE_BACKOFF_MS = 5 * 60 * 1000

const FAILURE_MAX = 500

const cache = new Map<string, CachedManifest>()
const failures = new Map<string, number>()
const pendingFetches = new Map<string, Promise<AddonDescriptor>>()

let persistTimer: ReturnType<typeof setTimeout> | null = null

function schedulePersist(): void {
    if (persistTimer) return
    persistTimer = setTimeout(() => {
        persistTimer = null
        const now = Date.now()
        const entries: [string, CachedManifest][] = []
        for (const [key, val] of cache) {
            if (now - val.timestamp <= CACHE_TTL) entries.push([key, val])
        }
        localforage.setItem(PERSIST_KEY, entries).catch(() => { })
    }, PERSIST_DEBOUNCE_MS)
}

let hydratePromise: Promise<void> | null = null
export function hydrateManifestCache(): Promise<void> {
    if (!hydratePromise) {
        hydratePromise = (async () => {
            try {
                const entries = await localforage.getItem<[string, CachedManifest][]>(PERSIST_KEY)
                if (!Array.isArray(entries)) return
                const now = Date.now()
                for (const [key, val] of entries) {
                    if (val && typeof val.timestamp === 'number' && now - val.timestamp <= CACHE_TTL && !cache.has(key)) {
                        cache.set(key, val)
                    }
                }
            } catch { }
        })()
    }
    return hydratePromise
}

export function getCachedManifest(url: string): AddonManifest | null {
    const entry = cache.get(url.toLowerCase())
    if (!entry) return null
    if (Date.now() - entry.timestamp > CACHE_TTL) {
        cache.delete(url.toLowerCase())
        return null
    }
    return entry.manifest
}

export function setCachedManifest(url: string, manifest: AddonManifest): void {
    const key = url.toLowerCase()
    if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
        const oldest = cache.keys().next().value
        if (oldest) cache.delete(oldest)
    }
    cache.set(key, { manifest, timestamp: Date.now() })
    failures.delete(key)
    schedulePersist()
}

export function recordManifestFetchFailure(url: string): void {
    const key = url.toLowerCase()
    if (failures.size >= FAILURE_MAX && !failures.has(key)) {
        const oldest = failures.keys().next().value
        if (oldest) failures.delete(oldest)
    }
    failures.set(key, Date.now())
}

export function shouldSkipManifestFetch(url: string): boolean {
    const key = url.toLowerCase()
    const failedAt = failures.get(key)
    if (failedAt === undefined) return false
    if (Date.now() - failedAt > FAILURE_BACKOFF_MS) {
        failures.delete(key)
        return false
    }
    return true
}

export function getPendingFetch(url: string): Promise<AddonDescriptor> | null {
    return pendingFetches.get(url.toLowerCase()) || null
}

export function setPendingFetch(url: string, promise: Promise<AddonDescriptor>): void {
    pendingFetches.set(url.toLowerCase(), promise)
    promise.finally(() => pendingFetches.delete(url.toLowerCase()))
}
