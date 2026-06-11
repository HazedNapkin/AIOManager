import { AddonManifest, AddonDescriptor } from '@/types/addon'

export interface CachedManifest {
    manifest: AddonManifest
    timestamp: number
}

const CACHE_TTL = 10 * 60 * 1000
const MAX_ENTRIES = 500

const cache = new Map<string, CachedManifest>()
const pendingFetches = new Map<string, Promise<AddonDescriptor>>()

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
    if (cache.size >= MAX_ENTRIES) {
        const oldest = cache.keys().next().value
        if (oldest) cache.delete(oldest)
    }
    cache.set(key, { manifest, timestamp: Date.now() })
}

export function getPendingFetch(url: string): Promise<AddonDescriptor> | null {
    return pendingFetches.get(url.toLowerCase()) || null
}

export function setPendingFetch(url: string, promise: Promise<AddonDescriptor>): void {
    pendingFetches.set(url.toLowerCase(), promise)
    promise.finally(() => pendingFetches.delete(url.toLowerCase()))
}


