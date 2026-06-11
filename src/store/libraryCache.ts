import { triggerSync } from '@/lib/sync-trigger'
import { create } from 'zustand'
import localforage from 'localforage'
import { ActivityItem, LibraryItem } from '@/types/activity'
import { stremioClient } from '@/api/stremio-client'
import { encrypt, decrypt as decryptData } from '@/lib/crypto'
import { getCachedAuthKey, getAccountAuthKey } from '@/store/accountStore'
import { useAuthStore } from '@/store/authStore'
import { StremioAccount } from '@/types/account'
import { toast } from '@/hooks/use-toast'

const CACHE_KEY = 'aio_library_cache_v3'
const OLD_CACHE_KEY = 'aio_library_cache'
const DELETED_ITEMS_KEY = 'aio_library_deleted'
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const LIBRARY_FETCH_CONCURRENCY = 5

let loadPromise: Promise<void> | null = null
let loadPromiseGeneration = 0
let cacheGeneration = 0
let removeItemsLock: Promise<void> = Promise.resolve()
const toastedNuvioFailures = new Set<string>()

const bumpCacheGeneration = () => {
    cacheGeneration += 1
}

const hasAccountCoverage = (
    lastMtimeByAccount: Record<string, string> | undefined,
    accounts: StremioAccount[]
) => {
    const mtimes = lastMtimeByAccount || {}
    return accounts.every(account => Object.prototype.hasOwnProperty.call(mtimes, account.id))
}

interface CacheData {
    items: ActivityItem[]
    lastFetched: number
    lastMtimeByAccount: Record<string, string>
}

interface DeletedEntry {
    deletedAt: number
}

interface LibraryCacheState {
    items: ActivityItem[]
    lastFetched: number
    lastMtimeByAccount: Record<string, string>
    loading: boolean
    loadingProgress: { current: number; total: number }
    isStale: boolean

    ensureLoaded: (accounts: StremioAccount[]) => Promise<void>
    invalidate: () => void
    clear: () => Promise<void>
    removeItems: (itemIds: string[]) => void
    removeItemsForAccount: (accountId: string) => void
    clearDeletedItems: () => void
    deletedItemIds: Set<string>
}

import { isActuallyWatched, transformLibraryItemToActivityItem, transformNuvioWatchedItemToActivityItem, transformNuvioProgressToActivityItem } from '@/lib/activity-utils'


export const useLibraryCache = create<LibraryCacheState>((set, get) => ({
    items: [],
    lastFetched: 0,
    lastMtimeByAccount: {},
    loading: false,
    loadingProgress: { current: 0, total: 0 },
    isStale: false,
    deletedItemIds: new Set(),

    removeItems: (itemIds: string[]) => {
        if (itemIds.length === 0) return
        bumpCacheGeneration()
        const { items, deletedItemIds } = get()
        const itemIdSet = new Set(itemIds)
        const newDeleted = new Set(deletedItemIds)
        const now = Date.now()
        itemIds.forEach(id => newDeleted.add(id))
        if (newDeleted.size > 500) {
            const arr = Array.from(newDeleted)
            newDeleted.clear()
            arr.slice(arr.length - 500).forEach(id => newDeleted.add(id))
        }
        const newItems = items.filter(item => !itemIdSet.has(item.id))
        set({ items: newItems, deletedItemIds: newDeleted })

        removeItemsLock = removeItemsLock.then(async () => {
            await localforage.removeItem(CACHE_KEY)
            const existing = await localforage.getItem<Record<string, DeletedEntry>>(DELETED_ITEMS_KEY)
            const entries = existing || {}
            itemIds.forEach(id => { entries[id] = { deletedAt: now } })
            await localforage.setItem(DELETED_ITEMS_KEY, entries)
        }).catch(() => {})
    },

    removeItemsForAccount: (accountId: string) => {
        bumpCacheGeneration()
        const { items } = get()
        const filtered = items.filter(item => item.accountId !== accountId)
        set({ items: filtered })
        localforage.removeItem(CACHE_KEY).catch(() => {})
    },

    clearDeletedItems: () => {
        set({ deletedItemIds: new Set() })
        localforage.removeItem(DELETED_ITEMS_KEY)
    },

    invalidate: () => {
        bumpCacheGeneration()
        set({ items: [], isStale: true })
        localforage.removeItem(CACHE_KEY).catch(() => {})
    },

    clear: async () => {
        bumpCacheGeneration()
        set({ items: [], lastFetched: 0, lastMtimeByAccount: {}, isStale: true, deletedItemIds: new Set() })
        await localforage.removeItem(CACHE_KEY)
        await localforage.removeItem(DELETED_ITEMS_KEY)
    },

    ensureLoaded: async (accounts: StremioAccount[]) => {
        if (accounts.length === 0) return

        let shouldRetry = true
        while (shouldRetry) {
            const state = get()
            const now = Date.now()

            if (
                !state.isStale &&
                state.lastFetched > 0 &&
                now - state.lastFetched < CACHE_TTL &&
                hasAccountCoverage(state.lastMtimeByAccount, accounts)
            ) {
                return
            }

            if (loadPromise) {
                const currentLoad = loadPromise
                await currentLoad
                if (loadPromise === currentLoad) {
                    loadPromise = null
                }
                const nextState = get()
                if (
                    loadPromiseGeneration !== cacheGeneration ||
                    nextState.isStale ||
                    !hasAccountCoverage(nextState.lastMtimeByAccount, accounts)
                ) {
                    continue
                }
                shouldRetry = false
                continue
            }

            loadPromiseGeneration = cacheGeneration
            loadPromise = (async () => {
                const state = get()
                const now = Date.now()
                const activeAccountIds = new Set(accounts.map(account => account.id))
                const generation = cacheGeneration

                set({ loading: true })

                try {
                if (state.items.length === 0) {
                    const oldCache = await localforage.getItem<string>(OLD_CACHE_KEY)
                    if (oldCache && !(await localforage.getItem<string>(CACHE_KEY))) {
                        await localforage.setItem(CACHE_KEY, oldCache)
                        await localforage.removeItem(OLD_CACHE_KEY)
                    }
                    const encrypted = await localforage.getItem<string>(CACHE_KEY)
                    const { encryptionKey } = useAuthStore.getState()

                    if (encrypted && encryptionKey && !state.isStale) {
                        try {
                            const decrypted = await decryptData(encrypted, encryptionKey)
                            const cached = JSON.parse(decrypted) as CacheData
                            const cachedMtimes = cached.lastMtimeByAccount || {}
                            if (
                                now - cached.lastFetched < CACHE_TTL &&
                                hasAccountCoverage(cachedMtimes, accounts)
                            ) {
                                const savedDeleted = await localforage.getItem<Record<string, DeletedEntry>>(DELETED_ITEMS_KEY)
                                if (generation !== cacheGeneration) return
                                const deletedEntries = savedDeleted || {}
                                const filteredItems = cached.items.filter(item =>
                                    activeAccountIds.has(item.accountId) && !deletedEntries[item.id]
                                )

                                set({
                                    items: filteredItems.map(i => {
                                        const t = new Date(i.timestamp)
                                        return {
                                            ...i,
                                            timestamp: t.getTime() > now ? new Date(now) : t
                                        }
                                    }),
                                    lastFetched: cached.lastFetched,
                                    lastMtimeByAccount: cachedMtimes,
                                    isStale: false,
                                    loading: false,
                                    deletedItemIds: new Set(Object.keys(deletedEntries))
                                })
                                return
                            }
                        } catch (e) {
                            if (import.meta.env.DEV) console.error('[LibraryCache] Failed to decrypt cache:', e)
                            localforage.removeItem(CACHE_KEY)
                        }
                    }
                }

                const savedDeleted = await localforage.getItem<Record<string, DeletedEntry>>(DELETED_ITEMS_KEY)
                if (savedDeleted) {
                    set({ deletedItemIds: new Set(Object.keys(savedDeleted)) })
                }

                if (import.meta.env.DEV && import.meta.env.VITE_MOCK_ACTIVITY === 'true') {
                    if (import.meta.env.DEV) console.log('[LibraryCache] Generating mock data...')
                    set({ loadingProgress: { current: 0, total: 30 } })

                    const mockItems: ActivityItem[] = []
                    const accountCount = 30
                    const itemsPerAccount = 500 // Increased for stress test (15k items total)

                    for (let a = 0; a < accountCount; a++) {
                        const accountId = `mock-acc-${a}`
                        const accountName = `Mock User ${a}`
                        for (let i = 0; i < itemsPerAccount; i++) {
                            const timestamp = new Date(now - (Math.random() * 365 * 24 * 60 * 60 * 1000))
                            mockItems.push({
                                id: `${accountId}:tt${i}`,
                                accountId,
                                accountName,
                                accountColorIndex: a % 10,
                                itemId: `tt${i}`,
                                uniqueItemId: `tt${i}`,
                                name: `Mock Content ${i}`,
                                type: Math.random() > 0.5 ? 'movie' : 'series',
                                poster: `https://picsum.photos/seed/${i}/200/300`,
                                timestamp,
                                isInProgress: false,
                                duration: 3600000,
                                watched: 1800000,
                                progress: 50,
                                season: 1,
                                episode: i % 20
                            })
                        }
                        set({ loadingProgress: { current: a + 1, total: accountCount } })
                        // Yield to UI
                        await new Promise(r => setTimeout(r, 0))
                    }

                    mockItems.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
                    const mockMtimes = Object.fromEntries(accounts.map(account => [account.id, new Date(now).toISOString()]))
                    set({
                        items: mockItems,
                        lastFetched: now,
                        lastMtimeByAccount: mockMtimes,
                        loading: false,
                        isStale: false,
                        loadingProgress: { current: accountCount, total: accountCount }
                    })
                    const { encryptionKey } = useAuthStore.getState()
                    if (encryptionKey) {
                        const encrypted = await encrypt(JSON.stringify({ items: mockItems, lastFetched: now, lastMtimeByAccount: mockMtimes }), encryptionKey)
                        await localforage.setItem(CACHE_KEY, encrypted)
                    }
                    return
                }

                set({ loadingProgress: { current: 0, total: accounts.length } })

                const { encryptionKey } = useAuthStore.getState()
                if (!encryptionKey) {
                    set({ loading: false })
                    throw new Error('App is locked')
                }

                const allItems: ActivityItem[] = []
                const newMtimes: Record<string, string> = { ...state.lastMtimeByAccount }
                const allMtimes = new Map<string, number>() // accountId:itemId -> mtime

                const executing = new Set<Promise<void>>()
                let completedCount = 0

                for (let i = 0; i < accounts.length; i++) {
                    const account = accounts[i]
                    const p = (async () => {
                        try {
                            const stremioAuthKey = getAccountAuthKey(account)
                            if (stremioAuthKey) {
                                const authKey = await getCachedAuthKey(stremioAuthKey, encryptionKey)
                                const libraryItems = await stremioClient.getLibraryItems(authKey, account.id) as LibraryItem[]

                                libraryItems.forEach(item => {
                                    if (item._mtime) {
                                        const key = `${account.id}:${item._id}`
                                        allMtimes.set(key, new Date(item._mtime).getTime())
                                    }
                                })

                                const { useWatchEventStore } = await import('@/store/watchEventStore')
                                await useWatchEventStore.getState().load()
                                const newEvents = useWatchEventStore.getState().diffAndRecord(
                                    account.id, libraryItems, account, accounts
                                )
                                if (newEvents.length > 0) {
                                    triggerSync()
                                }

                                // Recover complete per-episode history from Stremio's watched-bitfield
                                // (fills binge/batch-sync gaps the live video_id sampling misses). Run it
                                // non-blocking so the feed isn't held up by per-series Cinemeta lookups.
                                useWatchEventStore.getState().recordBackfillEpisodes(account.id, libraryItems)
                                    .then(backfilled => { if (backfilled > 0) triggerSync() })
                                    .catch(e => { if (import.meta.env.DEV) console.error(`[LibraryCache] bitfield backfill failed for ${account.name || account.id}:`, e) })

                                const accountActivity = libraryItems
                                    .filter(item => isActuallyWatched(item))
                                    .map(item => transformLibraryItemToActivityItem(item, account, accounts))

                                for (let k = 0; k < accountActivity.length; k++) {
                                    allItems.push(accountActivity[k])
                                }

                                const latestMtime = libraryItems.reduce((max, item) => {
                                    if (!item._mtime) return max
                                    return item._mtime > max ? item._mtime : max
                                }, '0')
                                newMtimes[account.id] = latestMtime
                            } else {
                                newMtimes[account.id] = newMtimes[account.id] ?? '0'
                            }

                        } catch (err) {
                            if (import.meta.env.DEV) console.error(`[LibraryCache] Failed to fetch account ${account.name || account.id}:`, err)
                            newMtimes[account.id] = newMtimes[account.id] ?? '0'
                        }

                        const nuvioConns = (account.connections || []).filter(c => c.enabled && c.platform === 'nuvio')
                        if (nuvioConns.length > 0) {
                            const { fetchConnectionToken } = await import('@/api/connection')
                            const { nuvioDriverFor } = await import('@/lib/drivers/factory')
                            const { getCachedNuvioToken, setCachedNuvioToken, invalidateNuvioToken } = await import('@/lib/nuvio-token-cache')
                            for (const conn of nuvioConns) {
                                try {
                                    let token = getCachedNuvioToken(conn.id)
                                    if (!token) {
                                        token = await fetchConnectionToken(account.id, conn.id, 'nuvio')
                                        setCachedNuvioToken(conn.id, token)
                                    }
                                    const driver = nuvioDriverFor(conn)
                                    const profileId = token.profileId ?? conn.credentials?.profileId
                                    const [watched, progress] = await Promise.all([
                                        driver.readWatchHistory(token.accessToken, profileId).catch(err => { console.warn('[LibraryCache] Nuvio readWatchHistory failed:', err); return [] }),
                                        driver.readWatchProgress(token.accessToken, profileId).catch(err => { console.warn('[LibraryCache] Nuvio readWatchProgress failed:', err); return [] }),
                                    ])
                                    console.info(`[LibraryCache] Nuvio fetched ${watched.length} watched + ${progress.length} progress for ${account.name || account.id}`)
                                    const nuvioTitles = new Map<string, string>()
                                    for (const w of watched) {
                                        if (w?.content_id && w?.title) nuvioTitles.set(String(w.content_id), String(w.title))
                                    }
                                    const progressActivities = await Promise.all(
                                        progress.map(async (row) => {
                                            try {
                                                return await transformNuvioProgressToActivityItem(row, account, accounts, nuvioTitles.get(String(row.content_id)))
                                            } catch {
                                                return null
                                            }
                                        })
                                    )
                                    const seenIds = new Set<string>()
                                    for (const activity of progressActivities) {
                                        if (!activity) continue
                                        seenIds.add(activity.uniqueItemId)
                                        allItems.push(activity)
                                    }
                                    const watchedActivities = await Promise.all(
                                        watched.map(async (row) => {
                                            try {
                                                return await transformNuvioWatchedItemToActivityItem(row, account, accounts)
                                            } catch {
                                                return null
                                            }
                                        })
                                    )
                                    for (const activity of watchedActivities) {
                                        if (!activity || seenIds.has(activity.uniqueItemId)) continue
                                        allItems.push(activity)
                                    }
                                } catch (err) {
                                    invalidateNuvioToken(conn.id)
                                    console.warn(`[LibraryCache] Nuvio history fetch failed for ${account.name || account.id}, preserving last known items:`, err)
                                    if (!toastedNuvioFailures.has(conn.id)) {
                                        toastedNuvioFailures.add(conn.id)
                                        toast({ title: 'Nuvio history unavailable', description: `Could not fetch watch history for ${account.name || 'account'}. Using last cached data.`, variant: 'destructive' })
                                        setTimeout(() => toastedNuvioFailures.delete(conn.id), 3600000)
                                    }
                                    const existingNuvio = state.items.filter(item => item.accountId === account.id && item.source === 'nuvio')
                                    if (existingNuvio.length > 0) {
                                        allItems.push(...existingNuvio)
                                    }
                                }
                            }
                        }
                    })().then(() => {
                        completedCount++
                        set({ loadingProgress: { current: completedCount, total: accounts.length } })
                        executing.delete(p)
                    })
                    executing.add(p)
                    if (executing.size >= LIBRARY_FETCH_CONCURRENCY) {
                        await Promise.race(executing)
                    }
                }

                await Promise.all(executing)

                if (generation !== cacheGeneration) return

                const finalItems = allItems.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

                const savedDeletedMap = await localforage.getItem<Record<string, DeletedEntry>>(DELETED_ITEMS_KEY)
                if (generation !== cacheGeneration) return
                const deletedEntries = savedDeletedMap || {}
                let entriesChanged = false

                const filteredFinal = finalItems.filter(item => {
                    const entry = deletedEntries[item.id]
                    if (!entry) return true // Not blacklisted

                    // If Stremio shows a newer _mtime than when we deleted it,
                    // the user watched it again - remove from blacklist and show it
                    const itemMtimeKey = `${item.accountId}:${item.itemId}`
                    const itemMtime = allMtimes.get(itemMtimeKey) || 0

                    if (itemMtime > entry.deletedAt) {
                        delete deletedEntries[item.id]
                        entriesChanged = true
                        if (import.meta.env.DEV) console.log(`[Smart Restore] Restoring ${item.name} (${item.id}) - watched again after deletion.`)
                        return true
                    }
                    return false
                })

                if (entriesChanged) {
                    await localforage.setItem(DELETED_ITEMS_KEY, deletedEntries)
                    set({ deletedItemIds: new Set(Object.keys(deletedEntries)) })
                } else {
                    set({ deletedItemIds: new Set(Object.keys(deletedEntries)) })
                }

                set({
                    items: filteredFinal,
                    lastFetched: now,
                    lastMtimeByAccount: newMtimes,
                    loading: false,
                    isStale: false
                })

                if (encryptionKey) {
                    const encrypted = await encrypt(JSON.stringify({
                        items: filteredFinal,
                        lastFetched: now,
                        lastMtimeByAccount: newMtimes
                    }), encryptionKey)
                    await localforage.setItem(CACHE_KEY, encrypted)
                }
                } catch (err) {
                    if (import.meta.env.DEV) console.error('[LibraryCache] Fatal error during load:', err)
                } finally {
                    set({ loading: false })
                }
            })()

            const currentLoad = loadPromise
            try {
                await currentLoad
            } finally {
                if (loadPromise === currentLoad) {
                    loadPromise = null
                }
            }

            const nextState = get()
            if (
                loadPromiseGeneration !== cacheGeneration ||
                nextState.isStale ||
                !hasAccountCoverage(nextState.lastMtimeByAccount, accounts)
            ) {
                continue
            }
            shouldRetry = false
        }
    }
}))

