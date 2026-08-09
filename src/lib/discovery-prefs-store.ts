import { useSyncExternalStore } from 'react'

export interface CatalogConfig {
    id: string
    enabled: boolean
    locked: boolean
}

export interface DiscoveryPrefs {
    railSize: number
    accountOverrides: Record<string, number>
    catalogs: CatalogConfig[]
}

const STORAGE_KEY = 'aiomanager-discovery-prefs'
const MIN_RAIL_SIZE = 10
const MAX_RAIL_SIZE = 100
const DEFAULT_RAIL_SIZE = 20

export const DEFAULT_CATALOGS: CatalogConfig[] = [
    { id: 'recommended_movies', enabled: true, locked: true },
    { id: 'recommended_series', enabled: true, locked: true },
    { id: 'recommended_anime', enabled: true, locked: true },
    { id: 'watchlist', enabled: true, locked: true },
]

export const CATALOG_LABELS: Record<string, string> = {
    recommended_movies: 'Recommended Movies',
    recommended_series: 'Recommended Series',
    recommended_anime: 'Recommended Anime',
    watchlist: 'My Watchlist',
}

const DEFAULT_PREFS: DiscoveryPrefs = {
    railSize: DEFAULT_RAIL_SIZE,
    accountOverrides: {},
    catalogs: DEFAULT_CATALOGS.map(c => ({ ...c })),
}

function clampRailSize(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_RAIL_SIZE
    return Math.min(MAX_RAIL_SIZE, Math.max(MIN_RAIL_SIZE, Math.round(value)))
}

let cache: DiscoveryPrefs = {
    railSize: DEFAULT_PREFS.railSize,
    accountOverrides: { ...DEFAULT_PREFS.accountOverrides },
    catalogs: DEFAULT_CATALOGS.map(c => ({ ...c })),
}
let lastModifiedAt: number = 0
const listeners = new Set<() => void>()

function mergeCatalogs(stored: unknown): CatalogConfig[] {
    const storedList = Array.isArray(stored) ? stored : []
    const storedMap = new Map<string, { enabled: boolean }>()
    for (const entry of storedList) {
        if (entry && typeof entry === 'object' && typeof (entry as CatalogConfig).id === 'string') {
            const e = entry as CatalogConfig
            storedMap.set(e.id, { enabled: typeof e.enabled === 'boolean' ? e.enabled : true })
        }
    }
    const merged: CatalogConfig[] = DEFAULT_CATALOGS.map(d => {
        const s = storedMap.get(d.id)
        return { id: d.id, locked: d.locked, enabled: s ? s.enabled : d.enabled }
    })
    for (const entry of storedList) {
        if (entry && typeof entry === 'object' && typeof (entry as CatalogConfig).id === 'string') {
            const e = entry as CatalogConfig
            if (!(e.id in CATALOG_LABELS)) continue
            if (!merged.some(d => d.id === e.id)) {
                merged.push({ id: e.id, locked: false, enabled: typeof e.enabled === 'boolean' ? e.enabled : true })
            }
        }
    }
    return merged
}

function parsePrefs(raw: Record<string, unknown>, railSizeFallback: number): DiscoveryPrefs {
    const railSize = typeof raw.railSize === 'number'
        ? clampRailSize(raw.railSize)
        : railSizeFallback
    const accountOverrides: Record<string, number> = {}
    if (raw.accountOverrides && typeof raw.accountOverrides === 'object') {
        for (const [key, val] of Object.entries(raw.accountOverrides)) {
            if (typeof val === 'number') accountOverrides[key] = clampRailSize(val)
        }
    }
    const catalogs = mergeCatalogs(raw.catalogs)
    return { railSize, accountOverrides, catalogs }
}

function loadFromStorage() {
    try {
        const data = localStorage.getItem(STORAGE_KEY)
        if (!data) return
        const parsed = JSON.parse(data)
        if (parsed === null || typeof parsed !== 'object') return
        if (parsed.cache && typeof parsed.cache === 'object') {
            cache = parsePrefs(parsed.cache as Record<string, unknown>, DEFAULT_RAIL_SIZE)
            lastModifiedAt = typeof parsed.lastModifiedAt === 'number' ? parsed.lastModifiedAt : 0
        } else {
            cache = parsePrefs(parsed as Record<string, unknown>, DEFAULT_RAIL_SIZE)
            lastModifiedAt = 0
        }
    } catch {
    }
}

function persist() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ cache, lastModifiedAt }))
    } catch {
    }
}

loadFromStorage()

function notify() {
    for (const fn of listeners) fn()
}

export function subscribe(callback: () => void): () => void {
    listeners.add(callback)
    return () => listeners.delete(callback)
}

export function getDiscoveryPrefs(): DiscoveryPrefs {
    return cache
}

export function setRailSize(size: number): void {
    const next = clampRailSize(size)
    if (next === cache.railSize) return
    lastModifiedAt = Date.now()
    cache = { ...cache, railSize: next }
    persist()
    notify()

}

export function setAccountRailSize(accountId: string, size: number | null): void {
    if (!accountId) return
    const overrides = { ...cache.accountOverrides }
    if (size === null) {
        if (!(accountId in overrides)) return
        delete overrides[accountId]
    } else {
        const clamped = clampRailSize(size)
        if (overrides[accountId] === clamped) return
        overrides[accountId] = clamped
    }
    lastModifiedAt = Date.now()
    cache = { ...cache, accountOverrides: overrides }
    persist()
    notify()

}

function getSnapshot(): DiscoveryPrefs {
    return cache
}

export function useRailSize(accountId?: string): number {
    const prefs = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    if (accountId !== undefined && prefs.accountOverrides[accountId] !== undefined) {
        return prefs.accountOverrides[accountId]
    }
    return prefs.railSize
}

export function getLastModifiedAt(): number {
    return lastModifiedAt
}

export function _setLastModifiedForTest(ts: number): void {
    lastModifiedAt = ts
}

export function _resetPrefsStoreForTest(): void {
    cache = {
        railSize: DEFAULT_PREFS.railSize,
        accountOverrides: { ...DEFAULT_PREFS.accountOverrides },
        catalogs: DEFAULT_CATALOGS.map(c => ({ ...c })),
    }
    lastModifiedAt = 0
}

export function _loadFromStorageForTest(): void {
    loadFromStorage()
}
