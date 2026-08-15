import { triggerSync } from '@/lib/sync-trigger'
import { create } from 'zustand'
import localforage from 'localforage'
import { ActivityItem, LibraryItem } from '@/types/activity'
import { stremioClient } from '@/api/stremio-client'
import { encrypt, decrypt as decryptData } from '@/lib/crypto'
import { getCachedAuthKey, getStremioAuthKey, isAuthError } from '@/store/accountStore'
import { useAuthStore } from '@/store/authStore'
import { Account } from '@/types/account'
import { toast } from '@/hooks/use-toast'
import { mapConcurrent } from '@/lib/concurrency'
import { trace } from '@/lib/trace'

const CACHE_KEY = 'aio_library_cache_v3'
const OLD_CACHE_KEY = 'aio_library_cache'
const DELETED_ITEMS_KEY = 'aio_library_deleted'
const CACHE_TTL = 5 * 60 * 1000
const LIBRARY_FETCH_CONCURRENCY = 5
const CACHE_VERSION = 3

let loadPromise: Promise<void> | null = null
let loadPromiseGeneration = 0
let cacheGeneration = 0
let removeItemsLock: Promise<void> = Promise.resolve()
const toastedNuvioFailures = new Set<string>()
const toastedRealStreamFailures = new Set<string>()

const bumpCacheGeneration = () => {
    cacheGeneration += 1
}

const hasAccountCoverage = (
    lastMtimeByAccount: Record<string, string> | undefined,
    accounts: Account[]
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

    ensureLoaded: (accounts: Account[]) => Promise<void>
    invalidate: () => void
    clear: () => Promise<void>
    removeItems: (itemIds: string[]) => void
    removeItemsForAccount: (accountId: string) => void
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
        const { items, lastMtimeByAccount } = get()
        const filtered = items.filter(item => item.accountId !== accountId)
        const newMtimes = { ...lastMtimeByAccount }
        delete newMtimes[accountId]
        set({ items: filtered, lastMtimeByAccount: newMtimes, isStale: true })
        localforage.removeItem(CACHE_KEY).catch(() => {})
    },

    invalidate: () => {
        bumpCacheGeneration()
        set({ items: [], lastMtimeByAccount: {}, isStale: true })
        localforage.removeItem(CACHE_KEY).catch(() => {})
    },

    clear: async () => {
        bumpCacheGeneration()
        set({ items: [], lastFetched: 0, lastMtimeByAccount: {}, isStale: true, deletedItemIds: new Set() })
        await localforage.removeItem(CACHE_KEY)
        await localforage.removeItem(DELETED_ITEMS_KEY)
    },

    ensureLoaded: async (accounts: Account[]) => {
        if (accounts.length === 0) return
        trace('libraryCache', 'ensureLoaded.start', { accountCount: accounts.length })

        const storedVersion = localStorage.getItem('aio-cache-version')
        if (storedVersion !== String(CACHE_VERSION)) {
            await localforage.removeItem(CACHE_KEY)
            localStorage.setItem('aio-cache-version', String(CACHE_VERSION))
            set({ items: [], lastMtimeByAccount: {} })
        }

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
                trace('libraryCache', 'ensureLoaded.cache-hit', { accountCount: accounts.length, items: state.items.length })
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
            let loadFailed = false
            loadPromise = (async () => {
                const state = get()
                const now = Date.now()
                const activeAccountIds = new Set(accounts.map(account => account.id))
                const generation = cacheGeneration
                const loadStart = Date.now()
                trace('libraryCache', 'ensureLoaded.load', { accountCount: accounts.length, reason: state.isStale ? 'stale' : (!state.lastFetched ? 'cold' : 'ttl') })

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
                            const isFresh = now - cached.lastFetched < CACHE_TTL
                            const hasCov = hasAccountCoverage(cachedMtimes, accounts)
                            const savedDeleted = await localforage.getItem<Record<string, DeletedEntry>>(DELETED_ITEMS_KEY)
                            if (generation !== cacheGeneration) return
                            const deletedEntries = savedDeleted || {}
                            const filteredItems = cached.items.filter(item =>
                                activeAccountIds.has(item.accountId) && !deletedEntries[item.id]
                            ).filter(item => {
                                const n = item.name?.trim() || ''
                                if (!n || n === 'Unknown' || n === 'Unknown Title') return false
                                if (item.source === 'realstream' && /^(tmdb:|movie_|series_|rs:|tv_)/i.test(n)) return false
                                // Pre-2026-08 mapper artifact: realstream series cached without episode
                                // identity duplicate the badged entries — drop; the next refresh re-adds them.
                                if (item.source === 'realstream' && item.type !== 'movie' && item.episode == null) return false
                                return true
                            })
                            const hydratedItems = filteredItems.map(i => {
                                const t = new Date(i.timestamp)
                                return {
                                    ...i,
                                    timestamp: t.getTime() > now ? new Date(now) : t
                                }
                            })

                            if (isFresh && hasCov) {
                                set({
                                    items: hydratedItems,
                                    lastFetched: cached.lastFetched,
                                    lastMtimeByAccount: cachedMtimes,
                                    isStale: false,
                                    loading: false,
                                    deletedItemIds: new Set(Object.keys(deletedEntries))
                                })
                                return
                            }

                            if (hydratedItems.length > 0) {
                                set({
                                    items: hydratedItems,
                                    lastMtimeByAccount: cachedMtimes,
                                    deletedItemIds: new Set(Object.keys(deletedEntries))
                                })
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

                set({ loadingProgress: { current: 0, total: accounts.length } })

                const { encryptionKey } = useAuthStore.getState()
                if (!encryptionKey) {
                    set({ loading: false })
                    throw new Error('App is locked')
                }

                const staleByAccount = new Map<string, ActivityItem[]>()
                const currentItems = get().items
                for (const item of currentItems) {
                    if (activeAccountIds.has(item.accountId)) {
                        const list = staleByAccount.get(item.accountId)
                        if (list) list.push(item)
                        else staleByAccount.set(item.accountId, [item])
                    }
                }
                const fetchedByAccount = new Map<string, ActivityItem[]>()
                const newMtimes: Record<string, string> = { ...get().lastMtimeByAccount }
                const allMtimes = new Map<string, number>()

                const buildMergedItems = (): ActivityItem[] => {
                    const merged: ActivityItem[] = []
                    for (const accId of activeAccountIds) {
                        const fetched = fetchedByAccount.get(accId)
                        if (fetched) {
                            merged.push(...fetched)
                        } else {
                            const stale = staleByAccount.get(accId)
                            if (stale) merged.push(...stale)
                        }
                    }
                    merged.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
                    return merged
                }

                const executing = new Set<Promise<void>>()
                let completedCount = 0

                for (let i = 0; i < accounts.length; i++) {
                    const account = accounts[i]
                    const p = (async () => {
                        const accountItems: ActivityItem[] = []
                        const nuvioConns = (account.connections || []).filter(c => c.enabled && c.platform === 'nuvio')
                        try {
                            const stremioAuthKey = getStremioAuthKey(account)
                            if (stremioAuthKey) {
                                const authKey = await getCachedAuthKey(stremioAuthKey, encryptionKey)
                                const libraryItems = await stremioClient.getLibraryItems(authKey, account.id) as LibraryItem[]

                                const latestMtime = libraryItems.reduce((max, item) => {
                                    if (!item._mtime) return max
                                    return item._mtime > max ? item._mtime : max
                                }, '0')

                                const oldMtime = get().lastMtimeByAccount[account.id]
                                if (oldMtime && latestMtime === oldMtime && nuvioConns.length === 0) {
                                    const { useWatchEventStore } = await import('@/store/watchEventStore')
                                    await useWatchEventStore.getState().load()
                                    const newEvents = useWatchEventStore.getState().diffAndRecord(
                                        account.id, libraryItems, account, accounts
                                    )
                                    if (newEvents.length > 0) {
                                        triggerSync()
                                    }
                                    useWatchEventStore.getState().recordBackfillEpisodes(account.id, libraryItems)
                                        .then(backfilled => { if (backfilled > 0) triggerSync() })
                                        .catch(e => { if (import.meta.env?.DEV) console.error(`[LibraryCache] bitfield backfill (mtime-skip) failed for ${account.name || account.id}:`, e) })
                                    const stale = staleByAccount.get(account.id) || []
                                    fetchedByAccount.set(account.id, stale)
                                    newMtimes[account.id] = latestMtime
                                } else {
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

                                    useWatchEventStore.getState().recordBackfillEpisodes(account.id, libraryItems)
                                        .then(backfilled => { if (backfilled > 0) triggerSync() })
                                        .catch(e => { if (import.meta.env.DEV) console.error(`[LibraryCache] bitfield backfill failed for ${account.name || account.id}:`, e) })

                                    const accountActivity = libraryItems
                                        .filter(item => isActuallyWatched(item))
                                        .map(item => transformLibraryItemToActivityItem(item, account, accounts))

                                    accountItems.push(...accountActivity)
                                    newMtimes[account.id] = latestMtime
                                }
                            } else {
                                newMtimes[account.id] = newMtimes[account.id] ?? '0'
                            }

                        } catch (err) {
                            if (import.meta.env.DEV) console.error(`[LibraryCache] Failed to fetch account ${account.name || account.id}:`, err)
                            newMtimes[account.id] = newMtimes[account.id] ?? '0'
                            // Fetch failed (offline/flaky): preserve last-known items like the
                            // Nuvio/RealStream paths do, instead of recording an empty account
                            // and wiping the cached feed.
                            const stale = staleByAccount.get(account.id)
                            if (stale) accountItems.push(...stale)
                        }

                        const existingKeys = new Set<string>()
                        for (const it of accountItems) {
                            existingKeys.add(`${account.id}:${it.itemId}`)
                            if (it.uniqueItemId) existingKeys.add(`${account.id}:${it.uniqueItemId}`)
                        }

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
                                        driver.readWatchHistory(token.accessToken, profileId).catch(err => { if (import.meta.env.DEV) console.warn('[LibraryCache] Nuvio readWatchHistory failed:', err); return [] }),
                                        driver.readWatchProgress(token.accessToken, profileId).catch(err => { if (import.meta.env.DEV) console.warn('[LibraryCache] Nuvio readWatchProgress failed:', err); return [] }),
                                    ])
                                    if (import.meta.env.DEV) console.info(`[LibraryCache] Nuvio fetched ${watched.length} watched + ${progress.length} progress for ${account.name || account.id}`)
                                    trace('libraryCache', 'nuvio.fetch', { accountId: account.id, watched: watched.length, progress: progress.length })
                                    const nuvioTitles = new Map<string, string>()
                                    for (const w of watched) {
                                        if (w?.content_id && w?.title) nuvioTitles.set(String(w.content_id), String(w.title))
                                    }
                                    const progressActivities = await mapConcurrent(progress, 5, async (row) => {
                                        try {
                                            return await transformNuvioProgressToActivityItem(row, account, accounts, nuvioTitles.get(String(row.content_id)))
                                        } catch {
                                            return null
                                        }
                                    })
                                    const seenIds = new Set<string>()
                                    for (const activity of progressActivities) {
                                        if (!activity) continue
                                        const pk1 = `${account.id}:${activity.uniqueItemId}`
                                        const pk2 = `${account.id}:${activity.itemId}`
                                        if (existingKeys.has(pk1) || existingKeys.has(pk2)) continue
                                        seenIds.add(activity.uniqueItemId)
                                        // pk2 (show-level) is checked only — never added — so that
                                        // later episodes of the same show in this batch survive.
                                        existingKeys.add(pk1)
                                        accountItems.push(activity)
                                    }
                                    const watchedActivities = await mapConcurrent(watched, 5, async (row) => {
                                        try {
                                            return await transformNuvioWatchedItemToActivityItem(row, account, accounts)
                                        } catch {
                                            return null
                                        }
                                    })
                                    for (const activity of watchedActivities) {
                                        if (!activity || seenIds.has(activity.uniqueItemId)) continue
                                        const wk1 = `${account.id}:${activity.uniqueItemId}`
                                        const wk2 = `${account.id}:${activity.itemId}`
                                        if (existingKeys.has(wk1) || existingKeys.has(wk2)) continue
                                        existingKeys.add(wk1)
                                        existingKeys.add(wk2)
                                        accountItems.push(activity)
                                    }
                                    const nuvioActivities = [
                                        ...progressActivities.filter((a): a is ActivityItem => a !== null),
                                        ...watchedActivities.filter((a): a is ActivityItem => a !== null && !seenIds.has(a.uniqueItemId)),
                                    ]
                                    if (nuvioActivities.length > 0) {
                                        const { useWatchEventStore } = await import('@/store/watchEventStore')
                                        await useWatchEventStore.getState().load()
                                        useWatchEventStore.getState().mergeExternalWatchEvents(account.id, 'nuvio', nuvioActivities.map(a => ({
                                            itemId: a.itemId,
                                            video_id: a.uniqueItemId,
                                            type: a.type,
                                            season: a.season,
                                            episode: a.episode,
                                            name: a.name,
                                            poster: a.poster,
                                            duration: a.duration,
                                            progress: a.progress,
                                            timestamp: a.timestamp.getTime(),
                                        })))
                                    }
                                } catch (err) {
                                    invalidateNuvioToken(conn.id)
                                    if (import.meta.env.DEV) console.warn(`[LibraryCache] Nuvio history fetch failed for ${account.name || account.id}, preserving last known items:`, err)
                                    trace('libraryCache', 'nuvio.fetch.error', { accountId: account.id, error: (err as Error)?.message })
                                    if (!toastedNuvioFailures.has(conn.id)) {
                                        toastedNuvioFailures.add(conn.id)
                                        toast({ title: 'Nuvio history unavailable', description: `Could not fetch watch history for ${account.name || 'account'}. Using last cached data.`, variant: 'destructive' })
                                        setTimeout(() => toastedNuvioFailures.delete(conn.id), 3600000)
                                    }
                                    const existingNuvio = currentItems.filter(item => item.accountId === account.id && item.source === 'nuvio')
                                    if (existingNuvio.length > 0) {
                                        accountItems.push(...existingNuvio)
                                    }
                                }
                            }
                        }
                        const realstreamConns = (account.connections || []).filter(c => c.enabled && c.platform === 'realstream')
                        if (realstreamConns.length > 0) {
                            const { fetchConnectionToken } = await import('@/api/connection')
                            const { realStreamDriverFor } = await import('@/lib/drivers/factory')
                            for (const conn of realstreamConns) {
                                try {
                                    const userId = conn.credentials?.userId || ''
                                    if (!userId) throw new Error('RealStream user ID missing; re-authenticate this connection')
                                    const token = await fetchConnectionToken(account.id, conn.id, 'realstream')
                                    const driver = realStreamDriverFor(conn)
                                    const progress = await driver.readWatchProgress(token.accessToken, userId).catch(async (e) => {
                                        if (!isAuthError(e)) throw e
                                        const refreshed = await driver.refreshAccessToken(token.accessToken)
                                        return driver.readWatchProgress(refreshed.accessToken, userId)
                                    })
                                    if (import.meta.env.DEV) console.info(`[LibraryCache] RealStream fetched ${progress.length} progress for ${account.name || account.id}`)
                                    trace('libraryCache', 'realstream.fetch', { accountId: account.id, progress: progress.length })
                                    const progressActivities = await Promise.all(
                                        progress.map(async (row) => {
                                            try {
                                                const rsTitle = row.title
                                                const rsPoster = row.posterPath
                                                const activity = await transformNuvioProgressToActivityItem(row, account, accounts, rsTitle)
                                                activity.id = `${account.id}:realstream:${activity.uniqueItemId}`
                                                activity.source = 'realstream'
                                                if (rsTitle && rsTitle.trim()) activity.name = rsTitle.trim()
                                                if (rsPoster && rsPoster.trim()) activity.poster = rsPoster.trim()
                                                return activity
                                            } catch {
                                                return null
                                            }
                                        })
                                    )
                                    const seenIds = new Set<string>()
                                    for (const activity of progressActivities) {
                                        if (!activity || seenIds.has(activity.uniqueItemId)) continue
                                        const rk1 = `${account.id}:${activity.uniqueItemId}`
                                        const rk2 = `${account.id}:${activity.itemId}`
                                        if (existingKeys.has(rk1) || existingKeys.has(rk2)) continue
                                        seenIds.add(activity.uniqueItemId)
                                        // rk2 (show-level) is checked only — never added — so that
                                        // later episodes of the same show in this batch survive.
                                        existingKeys.add(rk1)
                                        accountItems.push(activity)
                                    }
                                    const realstreamActivities = progressActivities.filter((a): a is ActivityItem => a !== null)
                                    if (realstreamActivities.length > 0) {
                                        const { useWatchEventStore } = await import('@/store/watchEventStore')
                                        await useWatchEventStore.getState().load()
                                        useWatchEventStore.getState().mergeExternalWatchEvents(account.id, 'realstream', realstreamActivities.map(a => ({
                                            itemId: a.itemId,
                                            video_id: a.uniqueItemId,
                                            type: a.type,
                                            season: a.season,
                                            episode: a.episode,
                                            name: a.name,
                                            poster: a.poster,
                                            duration: a.duration,
                                            progress: a.progress,
                                            timestamp: a.timestamp.getTime(),
                                        })))
                                    }
                                } catch (err) {
                                    if (import.meta.env.DEV) console.warn(`[LibraryCache] RealStream history fetch failed for ${account.name || account.id}, preserving last known items:`, err)
                                    trace('libraryCache', 'realstream.fetch.error', { accountId: account.id, error: (err as Error)?.message })
                                    if (!toastedRealStreamFailures.has(conn.id)) {
                                        toastedRealStreamFailures.add(conn.id)
                                        toast({ title: 'RealStream history unavailable', description: `Could not fetch watch history for ${account.name || 'account'}. Using last cached data.`, variant: 'destructive' })
                                        setTimeout(() => toastedRealStreamFailures.delete(conn.id), 3600000)
                                    }
                                    const existingRealStream = currentItems.filter(item => item.accountId === account.id && item.source === 'realstream')
                                    if (existingRealStream.length > 0) {
                                        accountItems.push(...existingRealStream)
                                    }
                                }
                            }
                        }
                        if (!fetchedByAccount.has(account.id)) {
                            fetchedByAccount.set(account.id, accountItems)
                        }
                    })().then(() => {
                        completedCount++
                        set({
                            loadingProgress: { current: completedCount, total: accounts.length }
                        })
                        executing.delete(p)
                    })
                    executing.add(p)
                    if (executing.size >= LIBRARY_FETCH_CONCURRENCY) {
                        await Promise.race(executing)
                    }
                }

                await Promise.all(executing)

                if (generation !== cacheGeneration) return

                const finalItems = buildMergedItems()

                const savedDeletedMap = await localforage.getItem<Record<string, DeletedEntry>>(DELETED_ITEMS_KEY)
                if (generation !== cacheGeneration) return
                const deletedEntries = savedDeletedMap || {}
                let entriesChanged = false

                const filteredFinal = finalItems.filter(item => {
                    const n = item.name?.trim() || ''
                    if (!n || n === 'Unknown' || n === 'Unknown Title') return false
                    if (item.source === 'realstream' && /^(tmdb:|movie_|series_|rs:|tv_)/i.test(n)) return false
                    // Pre-2026-08 mapper artifact: realstream series cached without episode
                    // identity duplicate the badged entries — drop; the next refresh re-adds them.
                    if (item.source === 'realstream' && item.type !== 'movie' && item.episode == null) return false
                    const entry = deletedEntries[item.id]
                    if (!entry) return true

                    // If Stremio shows a newer _mtime than when we deleted it,
                    // the user watched it again - remove from blacklist and show it.
                    // allMtimes holds Stremio library mtimes only, so the restore check
                    // is limited to Stremio-source items; an external item's _id collision
                    // with a Stremio library entry must not resurrect it.
                    const itemMtimeKey = `${item.accountId}:${item.itemId}`
                    const itemMtime = item.source && item.source !== 'stremio'
                        ? 0
                        : (allMtimes.get(itemMtimeKey) || 0)

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
                trace('libraryCache', 'ensureLoaded.load.complete', { accountCount: accounts.length, items: filteredFinal.length, timing: Date.now() - loadStart })

                if (encryptionKey) {
                    const encrypted = await encrypt(JSON.stringify({
                        items: filteredFinal,
                        lastFetched: now,
                        lastMtimeByAccount: newMtimes
                    }), encryptionKey)
                    await localforage.setItem(CACHE_KEY, encrypted)
                }
                } catch (err) {
                    loadFailed = true
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
            if (loadFailed && loadPromiseGeneration === cacheGeneration) {
                // Fatal load error with no pending invalidation (e.g. vault locked
                // mid-refresh): an immediate retry fails identically and busy-loops.
                // Bail; the next ensureLoaded call re-attempts.
                shouldRetry = false
                continue
            }
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

