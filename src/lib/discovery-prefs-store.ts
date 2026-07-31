import { useSyncExternalStore } from 'react'
import { useSyncStore } from '@/store/syncStore'
import { deriveSyncToken } from '@/lib/crypto'

export interface CatalogConfig {
    id: string
    enabled: boolean
    locked: boolean
}

export interface DiscoveryPrefs {
    railSize: number
    accountOverrides: Record<string, number>
    catalogs: CatalogConfig[]
    accountCatalogOverrides: Record<string, Record<string, boolean>>
}

const STORAGE_KEY = 'aiomanager-discovery-prefs'
const MIN_RAIL_SIZE = 10
const MAX_RAIL_SIZE = 50
const DEFAULT_RAIL_SIZE = 20

export const DEFAULT_CATALOGS: CatalogConfig[] = [
    { id: 'recommended_movies', enabled: true, locked: true },
    { id: 'recommended_series', enabled: true, locked: true },
    { id: 'continue_watching', enabled: true, locked: true },
    { id: 'watchlist', enabled: true, locked: true },
    { id: 'because_you_watched', enabled: true, locked: false },
    { id: 'themed_rows', enabled: true, locked: false },
    { id: 'popular_household', enabled: true, locked: false },
    { id: 'trending_household', enabled: false, locked: false },
]

export const CATALOG_LABELS: Record<string, string> = {
    recommended_movies: 'Recommended Movies',
    recommended_series: 'Recommended Series',
    continue_watching: 'Continue Watching',
    watchlist: 'My Watchlist',
    because_you_watched: 'Because You Watched',
    themed_rows: 'Themed For You',
    popular_household: 'Popular in Household',
    trending_household: 'Trending This Week',
}

const DEFAULT_PREFS: DiscoveryPrefs = {
    railSize: DEFAULT_RAIL_SIZE,
    accountOverrides: {},
    catalogs: DEFAULT_CATALOGS.map(c => ({ ...c })),
    accountCatalogOverrides: {},
}

function clampRailSize(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_RAIL_SIZE
    return Math.min(MAX_RAIL_SIZE, Math.max(MIN_RAIL_SIZE, Math.round(value)))
}

async function authHeaders(): Promise<Record<string, string>> {
    const auth = useSyncStore.getState().auth
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (auth.isAuthenticated) {
        headers['x-sync-user'] = auth.id
        headers['x-sync-password'] = await deriveSyncToken(auth.password)
    }
    return headers
}

let cache: DiscoveryPrefs = {
    railSize: DEFAULT_PREFS.railSize,
    accountOverrides: { ...DEFAULT_PREFS.accountOverrides },
    catalogs: DEFAULT_CATALOGS.map(c => ({ ...c })),
    accountCatalogOverrides: {},
}
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

function loadFromStorage() {
    try {
        const data = localStorage.getItem(STORAGE_KEY)
        if (!data) return
        const parsed = JSON.parse(data)
        if (parsed === null || typeof parsed !== 'object') return
        const railSize = typeof parsed.railSize === 'number'
            ? clampRailSize(parsed.railSize)
            : DEFAULT_RAIL_SIZE
        let accountOverrides: Record<string, number> = {}
        if (parsed.accountOverrides && typeof parsed.accountOverrides === 'object') {
            for (const [key, val] of Object.entries(parsed.accountOverrides)) {
                if (typeof val === 'number') accountOverrides[key] = clampRailSize(val)
            }
        }
        const catalogs = mergeCatalogs(parsed.catalogs)
        let accountCatalogOverrides: Record<string, Record<string, boolean>> = {}
        if (parsed.accountCatalogOverrides && typeof parsed.accountCatalogOverrides === 'object') {
            for (const [accId, overrides] of Object.entries(parsed.accountCatalogOverrides)) {
                if (overrides && typeof overrides === 'object') {
                    const map: Record<string, boolean> = {}
                    for (const [catId, enabled] of Object.entries(overrides as Record<string, unknown>)) {
                        if (typeof enabled === 'boolean') map[catId] = enabled
                    }
                    if (Object.keys(map).length > 0) accountCatalogOverrides[accId] = map
                }
            }
        }
        cache = { railSize, accountOverrides, catalogs, accountCatalogOverrides }
    } catch {
    }
}

function persist() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
    } catch {
    }
}

async function syncFromServer(): Promise<void> {
    try {
        const res = await fetch('/api/catalog/prefs?scope=household', { headers: await authHeaders() })
        if (!res.ok) return
        const json = await res.json()
        const serverPrefs = json?.prefs
        if (!serverPrefs || typeof serverPrefs !== 'object') return
        const railSize = typeof serverPrefs.railSize === 'number'
            ? clampRailSize(serverPrefs.railSize)
            : cache.railSize
        let accountOverrides: Record<string, number> = {}
        if (serverPrefs.accountOverrides && typeof serverPrefs.accountOverrides === 'object') {
            for (const [key, val] of Object.entries(serverPrefs.accountOverrides)) {
                if (typeof val === 'number') accountOverrides[key] = clampRailSize(val)
            }
        }
        const catalogs = mergeCatalogs(serverPrefs.catalogs)
        let accountCatalogOverrides: Record<string, Record<string, boolean>> = {}
        if (serverPrefs.accountCatalogOverrides && typeof serverPrefs.accountCatalogOverrides === 'object') {
            for (const [accId, overrides] of Object.entries(serverPrefs.accountCatalogOverrides)) {
                if (overrides && typeof overrides === 'object') {
                    const map: Record<string, boolean> = {}
                    for (const [catId, enabled] of Object.entries(overrides as Record<string, unknown>)) {
                        if (typeof enabled === 'boolean') map[catId] = enabled
                    }
                    if (Object.keys(map).length > 0) accountCatalogOverrides[accId] = map
                }
            }
        }
        const next: DiscoveryPrefs = { railSize, accountOverrides, catalogs, accountCatalogOverrides }
        if (JSON.stringify(next) === JSON.stringify(cache)) return
        cache = next
        persist()
        notify()
    } catch {
    }
}

function pushToServer(prefs: DiscoveryPrefs): void {
    authHeaders()
        .then(headers => fetch('/api/catalog/prefs', {
            method: 'PUT',
            headers,
            body: JSON.stringify({ scope: 'household', prefs }),
        }))
        .catch(() => {})
}

loadFromStorage()
void syncFromServer()

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
    cache = { ...cache, railSize: next }
    persist()
    notify()
    pushToServer(cache)
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
    cache = { ...cache, accountOverrides: overrides }
    persist()
    notify()
}

export function setCatalogEnabled(id: string, enabled: boolean, accountId?: string): void {
    const idx = cache.catalogs.findIndex(c => c.id === id)
    if (idx === -1) return
    const current = cache.catalogs[idx]
    if (current.locked) return
    if (accountId) {
        const accOverrides = { ...cache.accountCatalogOverrides }
        const accMap = { ...(accOverrides[accountId] || {}) }
        if (accMap[id] === enabled) return
        accMap[id] = enabled
        accOverrides[accountId] = accMap
        cache = { ...cache, accountCatalogOverrides: accOverrides }
        persist()
        notify()
        pushToServer(cache)
    } else {
        if (current.enabled === enabled) return
        const catalogs = cache.catalogs.map((c, i) => i === idx ? { ...c, enabled } : c)
        cache = { ...cache, catalogs }
        persist()
        notify()
        pushToServer(cache)
    }
}

export function resetAccountCatalogs(accountId: string): void {
    if (!accountId || !cache.accountCatalogOverrides[accountId]) return
    const accOverrides = { ...cache.accountCatalogOverrides }
    delete accOverrides[accountId]
    cache = { ...cache, accountCatalogOverrides: accOverrides }
    persist()
    notify()
    pushToServer(cache)
}

export function moveCatalog(id: string, direction: 'up' | 'down'): void {
    const idx = cache.catalogs.findIndex(c => c.id === id)
    if (idx === -1) return
    const current = cache.catalogs[idx]
    if (current.locked) return
    const target = direction === 'up' ? idx - 1 : idx + 1
    if (target < 0 || target >= cache.catalogs.length) return
    const neighbor = cache.catalogs[target]
    if (neighbor.locked) return
    const catalogs = [...cache.catalogs]
    const tmp = catalogs[idx]
    catalogs[idx] = catalogs[target]
    catalogs[target] = tmp
    cache = { ...cache, catalogs }
    persist()
    notify()
    pushToServer(cache)
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

export function useCatalogs(accountId?: string): CatalogConfig[] {
    const prefs = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    if (accountId && prefs.accountCatalogOverrides[accountId]) {
        const accOverrides = prefs.accountCatalogOverrides[accountId]
        return prefs.catalogs.map(c =>
            !c.locked && accOverrides[c.id] !== undefined
                ? { ...c, enabled: accOverrides[c.id] }
                : c
        )
    }
    return prefs.catalogs
}

export function isCatalogEnabled(id: string): boolean {
    const catalog = cache.catalogs.find(c => c.id === id)
    if (!catalog) return true
    if (catalog.locked) return true
    return catalog.enabled
}
