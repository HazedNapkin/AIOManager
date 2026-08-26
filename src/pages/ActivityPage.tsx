import { triggerSync } from '@/lib/sync-trigger'
import { ActivityFeed } from '@/components/activity/ActivityFeed'
import { ActivityDetailModal } from '@/components/activity/ActivityDetailModal'
import { ForYouPage } from '@/components/for-you/ForYouPage'
import { AccountDetailPage } from '@/components/for-you/AccountDetailPage'
import { ContentRail } from '@/components/ui/content-rail'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AccountSwitcher } from '@/components/common/AccountSwitcher'
import { ActivityItem, LibraryItem } from '@/types/activity'
import { useAccountStore, getStremioAuthKey, getAccountEmail, hasPlatformConnection } from '@/store/accountStore'
import { useDiscoveryPrefs, useDiscoveryStore, CONTINUE_WATCHING_CONTEXT } from '@/store/discoveryStore'
import { useLibraryCache } from '@/store/libraryCache'
import { useWatchHistory } from '@/hooks/useWatchHistory'
import { stremioClient } from '@/api/stremio-client'
import { decrypt } from '@/lib/crypto'
import { useAuthStore } from '@/store/authStore'
import { useSyncStore } from '@/store/syncStore'
import { useWatchEventStore } from '@/store/watchEventStore'
import { useUIStore } from '@/store/uiStore'
import { ActivityItemSkeleton } from '@/components/ui/skeleton'
import { historyEntryToActivityItem, nuvioProgressKey, fetchCinemetaDetail, getCachedCinemetaName } from '@/lib/activity-utils'
import { planEpisodeBitfieldDelete } from '@/lib/episode-bitfield-delete'
import { fetchSeriesVideos } from '@/lib/watched-episodes'
import type { Account } from '@/types/account'

import { FloatingActionBar } from '@/components/ui/floating-action-bar'
import { Grid, List, Search, Check, X, PlayCircle } from 'lucide-react'
import { AnimatedRefreshIcon, AnimatedTrashIcon } from '@/components/ui/AnimatedIcons'
import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { toast } from '@/hooks/use-toast'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { cn, maskNameLevel, maskEmailLevel } from '@/lib/utils'
import { SYNCED_SETTINGS_EVENT, type ActivitySettings } from '@/lib/synced-settings'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { OperationProgress } from '@/components/ui/operation-progress'
import { ToolbarShell } from '@/components/ui/toolbar-shell'
import { Tooltip } from '@/components/ui/tooltip'
import { Poster } from '@/components/common/Poster'
import { PlatformSourceBadge } from '@/components/activity/PlatformSourceBadge'
import { mapConcurrent } from '@/lib/concurrency'
import { getPlatformEntry } from '@/lib/platform-registry'
import { trace } from '@/lib/trace'

const ACTIVITY_ACCOUNT_DELETE_CONCURRENCY = 4
const ACTIVITY_ITEM_DELETE_CONCURRENCY = 5

function platformsPhrase(sources: Set<string>): string {
    const names = Array.from(sources).map(s => (s && s !== 'stremio' ? getPlatformEntry(s)?.name ?? s : 'Stremio'))
    if (names.length === 0) return 'Stremio'
    if (names.length === 1) return names[0]
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function includesWholeShowSeriesDelete(items: ActivityItem[]): boolean {
    return items.some(item => item.source !== 'nuvio' && item.source !== 'realstream'
        && (item.type === 'series' || item.type === 'anime')
        && (item.season == null || item.episode == null))
}

async function deleteNuvioWatchItems(account: Account, items: ActivityItem[]): Promise<boolean> {
    const nuvioConns = (account.connections || []).filter(c => c.enabled && c.platform === 'nuvio')
    if (nuvioConns.length === 0) return false
    const [{ fetchConnectionToken }, { nuvioDriverFor }, { getCachedNuvioToken, setCachedNuvioToken, invalidateNuvioToken }] = await Promise.all([
        import('@/api/connection'),
        import('@/lib/drivers/factory'),
        import('@/lib/nuvio-token-cache'),
    ])
    const historyKeys = items.map(i => {
        const k: { content_id: string; season?: number; episode?: number } = { content_id: i.itemId }
        if (i.episode != null) { k.season = i.season ?? 1; k.episode = i.episode }
        return k
    })
    const progressKeys = items.map(i => nuvioProgressKey(i.itemId, i.season, i.episode))

    let failed = false
    for (const conn of nuvioConns) {
        try {
            let token = getCachedNuvioToken(conn.id)
            if (!token) {
                token = await fetchConnectionToken(account.id, conn.id, 'nuvio')
                setCachedNuvioToken(conn.id, token)
            }
            const driver = nuvioDriverFor(conn)
            const profileId = token.profileId ?? conn.credentials?.profileId
            await driver.deleteWatchHistory(token.accessToken, historyKeys, profileId)
            await driver.deleteWatchProgress(token.accessToken, progressKeys, profileId)
            trace('activityDelete', 'nuvio.connection.ok', { accountId: account.id, connectionId: conn.id, historyKeys: historyKeys.length, progressKeys: progressKeys.length })
        } catch (e) {
            if (import.meta.env.DEV) console.error('[Activity] Nuvio delete failed:', e)
            trace('activityDelete', 'nuvio.connection.error', { accountId: account.id, connectionId: conn.id, status: (e as { status?: number })?.status, error: (e as Error)?.message })
            invalidateNuvioToken(conn.id)
            failed = true
        }
    }
    return !failed
}

async function deleteRealStreamWatchItems(account: Account, items: ActivityItem[]): Promise<boolean> {
    const rsConns = (account.connections || []).filter(c => c.enabled && c.platform === 'realstream')
    if (rsConns.length === 0) return false
    const [{ fetchConnectionToken }, { realStreamDriverFor }] = await Promise.all([
        import('@/api/connection'),
        import('@/lib/drivers/factory'),
    ])
    const entries = items.map(i => ({
        videoId: i.uniqueItemId || i.itemId,
        contentId: i.itemId.startsWith('tt') ? i.itemId : undefined,
        season: i.season ?? null,
        episode: i.episode ?? null,
    }))

    let failed = false
    for (const conn of rsConns) {
        try {
            const userId = conn.credentials?.userId || ''
            if (!userId) throw new Error('RealStream user ID missing; re-authenticate this connection')
            const token = await fetchConnectionToken(account.id, conn.id, 'realstream')
            const driver = realStreamDriverFor(conn)
            await driver.deleteWatchProgress(token.accessToken, userId, entries)
            trace('activityDelete', 'realstream.connection.ok', { accountId: account.id, connectionId: conn.id, entries: entries.length })
        } catch (e) {
            if (import.meta.env.DEV) console.error('[Activity] RealStream delete failed:', e)
            trace('activityDelete', 'realstream.connection.error', { accountId: account.id, connectionId: conn.id, error: (e as Error)?.message })
            failed = true
        }
    }
    return !failed
}

// Minimal ActivityItem for deep links (?detail=<id>): the watch-history
// object is preferred when available, but on a cold load (or for films only
// reachable via filmography/person URLs) we open with just the id and let the
// modal's metadata fetch fill in name/poster/genres.
function detailItemFromUrlParams(itemId: string, type: string | null): ActivityItem {
    return {
        id: `url:${itemId}`,
        accountId: '',
        accountName: '',
        accountColorIndex: 0,
        itemId,
        uniqueItemId: itemId,
        name: '',
        type: type || 'movie',
        poster: '',
        timestamp: new Date(0),
        duration: 0,
        watched: 0,
        progress: 0,
        isInProgress: false,
    }
}

export function ActivityPage() {
    useDocumentTitle('Activity')
    const accounts = useAccountStore(s => s.accounts)
    const ensureLoaded = useLibraryCache(s => s.ensureLoaded)
    const loading = useLibraryCache(s => s.loading)
    const loadingProgress = useLibraryCache(s => s.loadingProgress)
    const invalidate = useLibraryCache(s => s.invalidate)
    const removeItems = useLibraryCache(s => s.removeItems)
    const syncIsAuthenticated = useSyncStore(s => s.auth.isAuthenticated)
    const syncId = useSyncStore(s => s.auth.id)
    const syncPassword = useSyncStore(s => s.auth.password)
    const isRefreshingFromCloud = useSyncStore(s => s.isRefreshingFromCloud)
    const refreshFromCloud = useSyncStore(s => s.refreshFromCloud)
    const watchEventsInitialized = useWatchEventStore(s => s.initialized)
    const liveActivity = useUIStore(s => s.liveActivity)
    const isPrivacyModeEnabled = useUIStore(s => s.isPrivacyModeEnabled)
    const privacyLevelNames = useUIStore(s => s.privacyLevelNames)
    const privacyLevel = isPrivacyModeEnabled ? privacyLevelNames : 0
    const { dismissedItems: dismissedContinueWatching } = useDiscoveryPrefs(CONTINUE_WATCHING_CONTEXT)

    const { history: watchHistory, inProgress } = useWatchHistory()

    const [activeView, setActiveView] = useState<'feed' | 'foryou'>('feed')
    const [forYouAccountId, setForYouAccountId] = useState<string | null>(null)

    const [resolvedNames, setResolvedNames] = useState<Map<string, { name: string; poster?: string; genres?: string[] }>>(new Map())

    // Convert to ActivityItem[] for existing feed components. Backfilled episodes (recovered from the
    // watched-bitfield) have no real per-episode time, so they are kept out of the chronological feed
    // -- they still power Replay totals/discoveries and the per-show "seen" state.
    const history: ActivityItem[] = useMemo(
        () => {
            const items = watchHistory.map(historyEntryToActivityItem).filter(item => !item.backfill)

            const BAD_NAME_RE = /^(tt\d{7,}|kitsu:\d+|mv:\d+|show:\d+|tmdb:\d+|mal:\d+|anilist:\d+|anidb:\d+|tvdb:\d+)$/i
            const isBadName = (n: string) => !n || n === 'Unknown Title' || BAD_NAME_RE.test(n)

            const bestByItemId = new Map<string, { name: string; poster?: string; genres?: string[] }>()
            for (const item of items) {
                if (isBadName(item.name)) continue
                const existing = bestByItemId.get(item.itemId)
                if (!existing || item.name.length > existing.name.length) {
                    bestByItemId.set(item.itemId, { name: item.name, poster: item.poster || undefined, genres: item.genres })
                }
            }

            if (bestByItemId.size > 0) {
                let enriched = 0
                for (let i = 0; i < items.length; i++) {
                    if (!isBadName(items[i].name)) continue
                    const best = bestByItemId.get(items[i].itemId)
                    if (best) {
                        items[i] = {
                            ...items[i],
                            name: best.name,
                            poster: items[i].poster || best.poster || items[i].poster,
                            genres: items[i].genres || best.genres,
                        }
                        enriched++
                    }
                }
                if (import.meta.env.DEV && enriched > 0) console.log('[ActivityPage] Cross-source name enrichment:', enriched, 'items')
            }

            if (resolvedNames.size > 0) {
                for (let i = 0; i < items.length; i++) {
                    if (!isBadName(items[i].name)) continue
                    const resolved = resolvedNames.get(items[i].itemId)
                    if (resolved) {
                        items[i] = {
                            ...items[i],
                            name: resolved.name,
                            poster: items[i].poster || resolved.poster || items[i].poster,
                            genres: items[i].genres || resolved.genres,
                        }
                    }
                }
            }

            return items
        },
        [watchHistory, resolvedNames]
    )

    useEffect(() => {
        const BAD_NAME_RE = /^(tt\d{7,}|kitsu:\d+|mv:\d+|show:\d+|tmdb:\d+|mal:\d+|anilist:\d+|anidb:\d+|tvdb:\d+)$/i
        const isBadName = (n: string) => !n || n === 'Unknown Title' || BAD_NAME_RE.test(n)
        const badIds = new Set<string>()
        for (const item of history) {
            if (isBadName(item.name) && item.itemId.startsWith('tt') && !resolvedNames.has(item.itemId)) {
                badIds.add(item.itemId)
            }
        }
        if (badIds.size === 0) return
        let active = true
        const resolutions = new Map<string, { name: string; poster?: string; genres?: string[] }>()
        Promise.all(Array.from(badIds).slice(0, 10).map(async (itemId) => {
            const meta = await fetchCinemetaDetail(itemId)
            if (!meta?.name) return
            const genres = meta.genre ? meta.genre.split(',').map((g: string) => g.trim()).filter(Boolean) : undefined
            resolutions.set(itemId, {
                name: meta.name,
                poster: meta.poster || undefined,
                genres: genres && genres.length > 0 ? genres : undefined,
            })
        })).then(() => {
            if (!active || resolutions.size === 0) return
            setResolvedNames(prev => {
                const next = new Map(prev)
                for (const [k, v] of resolutions) next.set(k, v)
                return next
            })
        })
        return () => { active = false }
    }, [history, resolvedNames])

    // Map useLibraryCache functions to original names for UI compatibility
    const fetchActivity = useCallback(async (silent = false) => {
        if (!silent) {
            invalidate()
            await ensureLoaded(accounts)
        }
    }, [accounts, ensureLoaded, invalidate])

    const [searchInput, setSearchInput] = useState('')
    const [searchTerm, setSearchTerm] = useState('')
    const searchInputRef = useRef<HTMLInputElement>(null)
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleSearchChange = useCallback((val: string) => {
        setSearchInput(val)
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
        if (!val) {
            setSearchTerm('')
            return
        }
        searchTimeoutRef.current = setTimeout(() => {
            setSearchTerm(val)
        }, 150)
    }, [])

    useEffect(() => {
        return () => {
            if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
        }
    }, [])

    useEffect(() => {
        if (!liveActivity) return
        let active = true
        const tick = () => {
            if (!active || document.visibilityState !== 'visible') return
            useLibraryCache.setState({ isStale: true })
            ensureLoaded(accounts)
        }
        const scheduleNext = () => {
            const jitter = Math.floor(Math.random() * 30000)
            return setTimeout(() => {
                tick()
                timerId = scheduleNext()
            }, 60000 + jitter)
        }
        let timerId = scheduleNext()
        const onVisibility = () => { if (document.visibilityState === 'visible') tick() }
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
            active = false
            clearTimeout(timerId)
            document.removeEventListener('visibilitychange', onVisibility)
        }
    }, [liveActivity, accounts, ensureLoaded])

    const [userFilter, setUserFilter] = useState('all')
    const [timeFilter, setTimeFilter] = useState(() => {
        try { return localStorage.getItem('activity-time-filter') || 'all' } catch { return 'all' }
    })
    const [customStartDate, setCustomStartDate] = useState<string>(() => {
        try { return localStorage.getItem('activity-since-date') || '' } catch { return '' }
    })
    const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
        try {
            const saved = localStorage.getItem('activity-view-mode')
            return saved === 'list' ? 'list' : 'grid'
        } catch { return 'grid' }
    })
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
    const [showDeleteDialog, setShowDeleteDialog] = useState(false)
    const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null)
    const [isDeletingPending, setIsDeletingPending] = useState(false)
    const [isBulkMode, setIsBulkMode] = useState(false)
    const [detailItem, setDetailItem] = useState<ActivityItem | null>(null)
    const cloudRefreshAttemptedRef = useRef(false)

    useEffect(() => {
        const handleSyncedSettings = (event: Event) => {
            const activity = (event as CustomEvent<{ activity?: ActivitySettings }>).detail?.activity
            if (!activity) return
            if (activity.timeFilter && ['all', '24h', '7d', '30d', 'since'].includes(activity.timeFilter)) {
                setTimeFilter(activity.timeFilter)
            }
            if (typeof activity.sinceDate === 'string') {
                setCustomStartDate(activity.sinceDate)
            }
            if (activity.viewMode === 'grid' || activity.viewMode === 'list') {
                setViewMode(activity.viewMode)
            }
        }

        window.addEventListener(SYNCED_SETTINGS_EVENT, handleSyncedSettings)
        return () => window.removeEventListener(SYNCED_SETTINGS_EVENT, handleSyncedSettings)
    }, [])

    useEffect(() => {
        if (accounts.length === 0) return

        // refreshFromCloud only latches watchEventsInitialized on a *successful* pull. Gate the
        // attempt to once per mount so a persistent pull failure can't re-fire this effect forever.
        const shouldRefreshEvents = Boolean(
            syncIsAuthenticated && syncId && syncPassword &&
            !watchEventsInitialized && !cloudRefreshAttemptedRef.current
        )

        let cancelled = false
        const loadActivity = async () => {
            if (shouldRefreshEvents) {
                cloudRefreshAttemptedRef.current = true
                await refreshFromCloud().catch(e => {
                    if (import.meta.env.DEV) console.error('[Activity] Failed to refresh watch history from cloud:', e)
                })
                if (cancelled) return

                const latestAccounts = useAccountStore.getState().accounts
                await ensureLoaded(latestAccounts.length > 0 ? latestAccounts : accounts)
                return
            }

            await ensureLoaded(accounts)
        }

        loadActivity().catch(e => {
            if (import.meta.env.DEV) console.error('[Activity] Failed to load watch history:', e)
        })

        return () => {
            cancelled = true
        }
    }, [accounts, ensureLoaded, refreshFromCloud, syncIsAuthenticated, syncId, syncPassword, watchEventsInitialized])

    const accountById = useMemo(() => new Map(accounts.map(account => [account.id, account])), [accounts])
    const accountOrderIndex = useMemo(() => new Map(accounts.map((account, index) => [account.id, index])), [accounts])

    const accountOptions = useMemo(() => {
        const accountMap = new Map<string, { id: string; name: string; colorIndex: number; emoji?: string; avatar?: string }>()
        history.forEach(item => {
            if (!accountMap.has(item.accountId)) {
                const acc = accountById.get(item.accountId)
                accountMap.set(item.accountId, {
                    id: item.accountId,
                    name: item.accountName,
                    colorIndex: item.accountColorIndex,
                    emoji: acc?.emoji,
                    avatar: acc?.avatar
                })
            }
        })

        return Array.from(accountMap.values()).sort((a, b) => {
            const indexA = accountOrderIndex.get(a.id) ?? -1
            const indexB = accountOrderIndex.get(b.id) ?? -1
            if (indexA === -1) return 1
            if (indexB === -1) return -1
            return indexA - indexB
        })
    }, [history, accountById, accountOrderIndex])

    const filteredHistory = useMemo(() => {
        const now = new Date().getTime()
        const oneDay = 24 * 60 * 60 * 1000
        const sevenDays = 7 * oneDay
        const thirtyDays = 30 * oneDay

        return history.filter(item => {
            if (userFilter !== 'all' && item.accountId !== userFilter) {
                return false
            }
            const itemTime = new Date(item.timestamp).getTime()
            if (timeFilter === '24h' && now - itemTime > oneDay) return false
            if (timeFilter === '7d' && now - itemTime > sevenDays) return false
            if (timeFilter === '30d' && now - itemTime > thirtyDays) return false
            if (timeFilter === 'since' && customStartDate) {
                const sinceTime = new Date(customStartDate).getTime()
                if (itemTime < sinceTime) return false
            }

            if (searchTerm.trim()) {
                const searchLower = searchTerm.toLowerCase()
                const haystack = [
                    item.name || '',
                    item.itemId || '',
                    item.source || '',
                    getCachedCinemetaName(item.itemId) || '',
                    item.season !== undefined ? `S${item.season}` : '',
                    item.episode !== undefined ? `E${item.episode}` : '',
                ].join(' ').toLowerCase()
                return haystack.includes(searchLower)
            }
            return true
        })
    }, [history, userFilter, searchTerm, timeFilter, customStartDate])

    useEffect(() => {
        if (userFilter !== 'all' && !accountOptions.some(o => o.id === userFilter)) {
            setUserFilter('all')
        }
    }, [accountOptions, userFilter])

    const sessionComparison = useMemo(() => {
        const now = new Date().getTime()
        const oneDay = 24 * 60 * 60 * 1000

        const watchedToday = history
            .filter(item => now - new Date(item.timestamp).getTime() < oneDay)
            .reduce((acc, item) => acc + (item.watched || 0), 0)

        const watchedYesterday = history
            .filter(item => {
                const diff = now - new Date(item.timestamp).getTime()
                return diff > oneDay && diff < 2 * oneDay
            })
            .reduce((acc, item) => acc + (item.watched || 0), 0)

        return {
            todayHrs: Math.round(watchedToday / 3600000 * 10) / 10,
            isUp: watchedToday >= watchedYesterday,
        }
    }, [history])

    const handleViewModeChange = useCallback((mode: 'grid' | 'list') => {
        setViewMode(mode)
        try { localStorage.setItem('activity-view-mode', mode) } catch {}
        triggerSync()
    }, [])


    const handleToggleSelect = useCallback((itemId: string | string[]) => {
        const ids = Array.isArray(itemId) ? itemId : [itemId]
        setSelectedItems(prev => {
            const newSet = new Set(prev)
            const allSelected = ids.every(id => newSet.has(id))
            if (allSelected) {
                ids.forEach(id => newSet.delete(id))
            } else {
                ids.forEach(id => newSet.add(id))
            }
            return newSet
        })
    }, [])

    const handleSelectAll = useCallback(() => {
        setSelectedItems(new Set(filteredHistory.map((item: ActivityItem) => item.id)))
    }, [filteredHistory])

    const handleDeselectAll = useCallback(() => {
        setSelectedItems(new Set())
        setIsBulkMode(false)
    }, [])

    const handleFeedToggleSelect = useCallback((id: string | string[]) => {
        handleToggleSelect(id)
        setIsBulkMode(true)
    }, [handleToggleSelect])

    const handleFeedDelete = useCallback((id: string | string[]) => {
        const ids = Array.isArray(id) ? id : [id]
        setPendingDeleteIds(ids)
    }, [])

    const pendingSources = useMemo(() => {
        if (!pendingDeleteIds) return new Set<string>()
        const idSet = new Set(pendingDeleteIds)
        return new Set(history.filter(h => idSet.has(h.id)).map(h => h.source || 'stremio'))
    }, [pendingDeleteIds, history])

    const selectedSources = useMemo(() => {
        if (selectedItems.size === 0) return new Set<string>()
        return new Set(history.filter(h => selectedItems.has(h.id)).map(h => h.source || 'stremio'))
    }, [selectedItems, history])

    const selectedHasWholeShowSeries = useMemo(
        () => includesWholeShowSeriesDelete(history.filter(h => selectedItems.has(h.id))),
        [selectedItems, history]
    )

    const pendingHasWholeShowSeries = useMemo(() => {
        if (!pendingDeleteIds) return false
        const idSet = new Set(pendingDeleteIds)
        return includesWholeShowSeriesDelete(history.filter(h => idSet.has(h.id)))
    }, [pendingDeleteIds, history])

    const handleOpenDetail = useCallback((item: ActivityItem) => {
        setDetailItem(item)
    }, [])

    // Deep-link sync with the detail modal's URL params. Opening the modal
    // pushes ?detail=… (handled inside ActivityDetailModal); this covers the
    // other direction: entering /activity with ?detail=… opens the modal
    // (deep link / refresh), and browser Back removing the params closes it.
    // While the modal is open we never swap detailItem from here — in-modal
    // navigation (person/episode/filmography) belongs to the modal's navStack.
    // If two accounts watched the same itemId the first history match wins,
    // and a cold-load fallback item is not retro-upgraded once history loads.
    const [searchParams] = useSearchParams()
    const detailParamId = searchParams.get('detail')

    useEffect(() => {
        if (!detailParamId) {
            setDetailItem(null)
            return
        }
        setDetailItem(prev => {
            if (prev) return prev
            return history.find(h => h.itemId === detailParamId) ?? detailItemFromUrlParams(detailParamId, searchParams.get('type'))
        })
    }, [detailParamId, history, searchParams])

    const deletePlatformItems = useCallback(async (items: ActivityItem[]): Promise<{ failed: boolean; keptIds: Set<string>; keptReasons: Map<string, number> }> => {
        if (items.length === 0) return { failed: false, keptIds: new Set<string>(), keptReasons: new Map<string, number>() }
        const byAccount: Record<string, ActivityItem[]> = {}
        for (const item of items) {
            (byAccount[item.accountId] ||= []).push(item)
        }
        const keptIds = new Set<string>()
        const keptReasons = new Map<string, number>()
        const countKeep = (reason: string, n: number = 1) => keptReasons.set(reason, (keptReasons.get(reason) || 0) + n)
        let failed = false
        await mapConcurrent(Object.entries(byAccount), ACTIVITY_ACCOUNT_DELETE_CONCURRENCY, async ([accountId, accItems]) => {
            const account = accountById.get(accountId)
            if (!account || !hasPlatformConnection(account)) return

            const nuvioItems = accItems.filter(i => i.source === 'nuvio')
            const realstreamItems = accItems.filter(i => i.source === 'realstream')
            const stremioItems = accItems.filter(i => i.source !== 'nuvio' && i.source !== 'realstream')

            if (stremioItems.length > 0) {
                const { encryptionKey } = useAuthStore.getState()
                const stremioKey = getStremioAuthKey(account)
                if (encryptionKey && stremioKey) {
                    try {
                        const authKey = await decrypt(stremioKey, encryptionKey)

                        const episodeItems = stremioItems.filter(i => i.season != null && i.episode != null)
                        const rowsById = new Map<string, LibraryItem>()
                        let rowsFetchFailed = false
                        if (episodeItems.length > 0) {
                            const rowIds = Array.from(new Set(episodeItems.map(i => i.itemId)))
                            try {
                                for (const row of await stremioClient.getLibraryItemsByIds(authKey, rowIds, account.id)) {
                                    rowsById.set(row._id, row)
                                }
                            } catch (e) {
                                // A failed rows fetch must not degrade into destructive per-item fallbacks.
                                rowsFetchFailed = true
                                trace('activityDelete', 'stremio.rows.error', { accountId, rows: rowIds.length, error: (e as Error)?.message })
                                for (const item of episodeItems) keptIds.add(item.id)
                                countKeep('rows-unavailable', episodeItems.length)
                                failed = true
                            }
                        }

                        const showLocks = new Map<string, Promise<unknown>>()
                        const touchedShows = new Set<string>()
                        const withShowLock = (itemId: string, fn: () => Promise<void>): Promise<void> => {
                            const prev = showLocks.get(itemId) ?? Promise.resolve()
                            const next = prev.catch(() => {}).then(fn)
                            showLocks.set(itemId, next)
                            return next
                        }

                        await mapConcurrent(stremioItems, ACTIVITY_ITEM_DELETE_CONCURRENCY, async (item) => {
                            const wholeShowDelete = async () => {
                                await stremioClient.removeLibraryItem(authKey, item.itemId, account.id)
                                trace('activityDelete', 'stremio.item.ok', { accountId, itemId: item.itemId, mode: 'whole-show' })
                            }
                            try {
                                if (item.season == null || item.episode == null) {
                                    await withShowLock(item.itemId, wholeShowDelete)
                                    return
                                }
                                if (rowsFetchFailed) return
                                const target = { uniqueItemId: item.uniqueItemId, season: item.season, episode: item.episode }
                                await withShowLock(item.itemId, async () => {
                                    const plan = await planEpisodeBitfieldDelete({
                                        itemId: item.itemId,
                                        row: rowsById.get(item.itemId),
                                        videos: await fetchSeriesVideos(item.itemId),
                                        target,
                                    })
                                    if (plan.kind === 'fail') {
                                        // Transient/structural failures must never escalate to whole-show deletion.
                                        keptIds.add(item.id)
                                        countKeep(plan.reason)
                                        failed = true
                                        trace('activityDelete', 'stremio.item.kept', { accountId, itemId: item.itemId, reason: plan.reason })
                                        return
                                    }
                                    if (plan.kind === 'skip') {
                                        trace('activityDelete', 'stremio.item.skip', { accountId, itemId: item.itemId, reason: 'no-row' })
                                        return
                                    }
                                    if (plan.kind === 'remove-row') {
                                        await wholeShowDelete()
                                        return
                                    }
                                    await stremioClient.upsertLibraryItem(authKey, plan.rewritten, account.id)
                                    rowsById.set(item.itemId, plan.rewritten)
                                    touchedShows.add(item.itemId)
                                    // The rewrite preserves the row mtime, so the watcher inference
                                    // would otherwise read the repointed anchor as a fresh watch.
                                    useWatchEventStore.getState().patchSnapshot(accountId, item.itemId, {
                                        mtime: new Date(plan.rewritten._mtime || '').getTime() || 0,
                                        video_id: plan.rewritten.state?.video_id,
                                        season: plan.rewritten.state?.season,
                                        episode: plan.rewritten.state?.episode,
                                    })
                                    trace('activityDelete', 'stremio.item.ok', { accountId, itemId: item.itemId, mode: 'per-episode', season: item.season, episode: item.episode, remaining: plan.rewritten.state?.timesWatched })
                                })
                            } catch (e) {
                                if (import.meta.env.DEV) console.error(`Failed to remove ${item.itemId}:`, e)
                                trace('activityDelete', 'stremio.item.error', { accountId, itemId: item.itemId, error: (e as Error)?.message })
                                keptIds.add(item.id)
                                countKeep('item-error')
                                failed = true
                            }
                        })
                        if (touchedShows.size > 0) {
                            useLibraryCache.getState().dropMetaRows(accountId, Array.from(touchedShows))
                        }
                        trace('activityDelete', 'stremio.account.done', { accountId, items: stremioItems.length })
                    } catch (e) {
                        if (import.meta.env.DEV) console.error(`Failed to process deletions for account ${accountId}:`, e)
                        trace('activityDelete', 'stremio.account.error', { accountId, items: stremioItems.length, error: (e as Error)?.message })
                        for (const item of stremioItems) keptIds.add(item.id)
                        countKeep('account-error', stremioItems.length)
                        failed = true
                    }
                } else {
                    trace('activityDelete', 'stremio.account.skipped', { accountId, items: stremioItems.length, reason: encryptionKey ? 'no-auth-key' : 'locked' })
                }
            }

            if (nuvioItems.length > 0) {
                trace('activityDelete', 'nuvio.account.start', { accountId, items: nuvioItems.length })
                const ok = await deleteNuvioWatchItems(account, nuvioItems)
                trace('activityDelete', 'nuvio.account.done', { accountId, items: nuvioItems.length, ok })
                if (!ok) {
                    failed = true
                    countKeep('platform-error', nuvioItems.length)
                    for (const item of nuvioItems) keptIds.add(item.id)
                }
            }

            if (realstreamItems.length > 0) {
                trace('activityDelete', 'realstream.account.start', { accountId, items: realstreamItems.length })
                const ok = await deleteRealStreamWatchItems(account, realstreamItems)
                trace('activityDelete', 'realstream.account.done', { accountId, items: realstreamItems.length, ok })
                if (!ok) {
                    failed = true
                    countKeep('platform-error', realstreamItems.length)
                    for (const item of realstreamItems) keptIds.add(item.id)
                }
            }
        })
        return { failed, keptIds, keptReasons }
    }, [accountById])

    const KEEP_REASON_LABELS: Record<string, string> = {
        'no-videos': 'episode list unavailable',
        'no-bitfield': 'no per-episode data to edit',
        'anchor-mismatch': "the show's episode data changed since watching",
        'episode-not-watched': 'not marked watched on the account',
        'non-tt': 'anime titles can only be deleted as a whole show',
        'rows-unavailable': 'watch history rows unavailable',
        'account-error': 'account sync error',
        'item-error': 'Stremio API error',
        'platform-error': 'platform sync error',
    }

    const keptReasonSummary = (keptReasons: Map<string, number>): string => {
        if (keptReasons.size === 0) return ''
        const parts = Array.from(keptReasons.entries())
            .map(([reason, n]) => `${n} ${KEEP_REASON_LABELS[reason] || reason}${n > 1 ? 's' : ''}`)
        return ` (${parts.join(', ')})`
    }

    const purgeLocalActivity = useCallback((items: ActivityItem[], feedIds: string[]) => {
        const liveIds = new Set<string>(feedIds)
        for (const i of items) {
            const cacheId = i.source === 'nuvio' ? `${i.accountId}:nuvio:${i.uniqueItemId}`
                : i.source === 'realstream' ? `${i.accountId}:realstream:${i.uniqueItemId}`
                : `${i.accountId}:${i.uniqueItemId}`
            liveIds.add(cacheId)
        }
        removeItems(Array.from(liveIds))
        useWatchEventStore.getState().removeEvents(items)
    }, [removeItems])

    const handleDeleteSelected = async () => {
        if (selectedItems.size === 0) return
        const count = selectedItems.size
        const itemIds = Array.from(selectedItems)
        setShowDeleteDialog(false)
        setSelectedItems(new Set())

        const itemIdSet = new Set(itemIds)
        const itemsToDelete = history.filter(item => itemIdSet.has(item.id))
        const { failed, keptIds, keptReasons } = await deletePlatformItems(itemsToDelete)

        purgeLocalActivity(itemsToDelete.filter(item => !keptIds.has(item.id)), itemIds.filter(id => !keptIds.has(id)))

        if (failed) {
            toast({ variant: 'destructive', title: 'Partial Deletion', description: `Some items could not be removed from their source platform and were left completely untouched in your history.${keptReasonSummary(keptReasons)}` })
        } else {
            toast({
                title: 'Items Deleted',
                description: `${count} item(s) removed from history.`
            })
        }
    }

    const handleConfirmPendingDelete = async () => {
        const ids = pendingDeleteIds
        if (!ids || ids.length === 0) {
            setPendingDeleteIds(null)
            return
        }

        setIsDeletingPending(true)
        try {
            const idSet = new Set(ids)
            const itemsToDelete = history.filter(item => idSet.has(item.id))

            const { failed, keptIds, keptReasons } = await deletePlatformItems(itemsToDelete)
            purgeLocalActivity(itemsToDelete.filter(item => !keptIds.has(item.id)), ids.filter(id => !keptIds.has(id)))

            if (failed) {
                toast({ variant: 'destructive', title: 'Partial Deletion', description: `Some items could not be removed from their source platform and were left completely untouched in your history.${keptReasonSummary(keptReasons)}` })
            } else {
                toast({
                    title: ids.length > 1 ? 'Episodes Deleted' : 'Item Deleted',
                    description: 'Removed from activity history.'
                })
            }
            setPendingDeleteIds(null)
        } finally {
            setIsDeletingPending(false)
        }
    }

    const isSelecting = selectedItems.size > 0 || isBulkMode
    const isLoading = loading || isRefreshingFromCloud

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const el = document.activeElement as HTMLElement
            const isInput = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
            if (e.key === '/' && !isSelecting && !isInput) {
                e.preventDefault()
                searchInputRef.current?.focus()
            }
            if (e.key === 'Escape' && isSelecting && !isInput) {
                handleDeselectAll()
            }
        }
        document.addEventListener('keydown', handler)
        return () => document.removeEventListener('keydown', handler)
    }, [isSelecting, handleDeselectAll])

    return (
        <div className="space-y-6 overflow-x-hidden">
            <Tabs value={activeView} onValueChange={(v) => { setActiveView(v as 'feed' | 'foryou'); setForYouAccountId(null) }}>
                <TabsList>
                    <TabsTrigger value="feed" className="h-8 px-4 text-xs">
                        Activity Feed
                    </TabsTrigger>
                    <TabsTrigger value="foryou" className="h-8 px-4 text-xs">
                        For You
                    </TabsTrigger>
                </TabsList>
            </Tabs>
            {activeView === 'foryou' && (
                <div className={forYouAccountId ? 'hidden' : undefined}>
                    <ForYouPage onAccountClick={(id) => setForYouAccountId(id)} />
                </div>
            )}
            {activeView === 'foryou' && forYouAccountId && (
                <AccountDetailPage
                    accountId={forYouAccountId}
                    onBack={() => setForYouAccountId(null)}
                />
            )}
            {activeView === 'feed' && (
            <>
            {/* Single unified toolbar */}
            <ToolbarShell contentClassName="gap-2 sm:gap-3">
                {/* Search */}
                <div className="relative w-full sm:w-80 shrink-0 min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                        ref={searchInputRef}
                        placeholder="Search history..."
                        value={searchInput}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        className="pl-9 pr-9 h-8 text-xs bg-muted/30 border border-border/40 focus:bg-muted/40 transition-colors w-full"
                        data-search-focus
                    />
                    {searchInput && (
                        <button
                            onClick={() => handleSearchChange('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 hover:bg-accent rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label="Clear search"
                        >
                            <X className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                    )}
                </div>

                {/* Filters - Left aligned to match search */}
                <div className={cn(
                    "grid w-full gap-2 sm:flex sm:flex-1 sm:flex-wrap sm:items-center sm:min-w-0",
                    accountOptions.length > 1 ? "grid-cols-2" : "grid-cols-1"
                )}>
                    {accountOptions.length > 1 && (
                        <AccountSwitcher
                            mode="filter"
                            accounts={accountOptions}
                            selectedId={userFilter}
                            onSelect={setUserFilter}
                            allLabel="All Users"
                            placeholder="Search users..."
                            buttonClassName="inline-flex h-8 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-border/40 bg-muted/30 px-3 text-xs font-medium shadow-sm transition-colors hover:bg-muted/50 hover:text-foreground"
                        />
                    )}

                    <Select value={timeFilter} onValueChange={(val) => {
                        setTimeFilter(val)
                        try { localStorage.setItem('activity-time-filter', val) } catch {}
                        triggerSync()
                    }}>
                        <SelectTrigger className="h-8 w-full sm:w-[120px] text-xs font-medium">
                            <SelectValue placeholder="All Time" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Time</SelectItem>
                            <SelectItem value="24h">Last 24 Hours</SelectItem>
                            <SelectItem value="7d">Last 7 Days</SelectItem>
                            <SelectItem value="30d">Last 30 Days</SelectItem>
                            <SelectItem value="since">Since…</SelectItem>
                        </SelectContent>
                    </Select>

                    {timeFilter === 'since' && (
                        <Input
                            type="date"
                            value={customStartDate}
                            onChange={(e) => {
                                setCustomStartDate(e.target.value)
                                try { localStorage.setItem('activity-since-date', e.target.value) } catch {}
                                triggerSync()
                            }}
                            className="col-span-full h-8 w-full sm:w-[150px] text-xs font-medium"
                        />
                    )}
                </div>

                {/* Actions - pushed to right */}
                <div className="grid w-full grid-cols-[1fr_1fr_auto] items-center gap-2 sm:ml-auto sm:flex sm:w-auto sm:justify-end shrink-0">
                    <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchActivity()}
                        disabled={isLoading}
                        className="w-full text-xs font-medium gap-1.5 sm:w-auto"
                    >
                        <AnimatedRefreshIcon className="h-3.5 w-3.5" isAnimating={isLoading} />
                        Refresh
                    </Button>

                    <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                        if (isBulkMode || selectedItems.size > 0) handleDeselectAll()
                        else setIsBulkMode(true)
                        }}
                        className="w-full text-xs font-medium gap-1.5 sm:w-auto"
                    >
                        {isSelecting ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                        {isSelecting ? 'Cancel' : 'Select'}
                    </Button>

                    {/* Grid / List toggle */}
                    <div className="flex items-center bg-muted/50 rounded-lg p-0.5 border border-border/40 gap-0.5 shrink-0">
                        <Tooltip content="Grid view" side="bottom">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewModeChange('grid')}
                            className={cn(
                                'h-8 w-8 rounded-lg p-0',
                                viewMode === 'grid'
                                    ? 'bg-background shadow-sm text-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                            aria-label="Grid view"
                        >
                            <Grid className="h-3.5 w-3.5" />
                        </Button>
                        </Tooltip>
                        <Tooltip content="List view" side="bottom">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewModeChange('list')}
                            className={cn(
                                'h-8 w-8 rounded-lg p-0',
                                viewMode === 'list'
                                    ? 'bg-background shadow-sm text-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                            aria-label="List view"
                        >
                            <List className="h-3.5 w-3.5" />
                        </Button>
                        </Tooltip>
                    </div>
                </div>
            </ToolbarShell>
            {isLoading && (
                <OperationProgress
                    status="running"
                    current={loadingProgress.current}
                    total={loadingProgress.total}
                    label={loadingProgress.current > 0
                        ? `Syncing ${loadingProgress.current} of ${loadingProgress.total} accounts`
                        : 'Connecting...'}
                    detail={loadingProgress.current > 0
                        ? `${loadingProgress.total - loadingProgress.current} remaining`
                        : 'Fetching watch history'}
                    className="mt-2"
                />
            )}

            {/* Continue Watching Rail */}
            {(() => {
              const filteredInProgress = (userFilter === 'all' ? inProgress : inProgress.filter(item => item.accountId === userFilter))
                .filter(item => !dismissedContinueWatching.includes(`${item.accountId}:${item.itemId}`))
              if (filteredInProgress.length === 0 || searchTerm) return null
              return (
                <ContentRail
                    title="Continue Watching"
                    subtitle="Resume in-progress streams from the latest account sync."
                    count={filteredInProgress.length}
                    countLabel="active"
                >
                            {filteredInProgress.slice(0, 24).map((item, i) => {
                                const account = accountById.get(item.accountId)
                                return (
                                    <motion.div
                                        key={item.id}
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: i * 0.04, duration: 0.25, ease: 'easeOut' }}
                                        className="relative w-28 shrink-0 cursor-pointer group"
                                        onClick={() => setDetailItem(item)}
                                    >
                                        <button
                                            type="button"
                                            aria-label={`Remove ${item.name} from Continue Watching`}
                                            className="absolute -top-1.5 -right-1.5 z-10 flex h-5.5 w-5.5 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground opacity-0 shadow-sm transition-all hover:bg-destructive hover:text-destructive-foreground focus-visible:opacity-100 group-hover:opacity-100"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                useDiscoveryStore.getState().dismissItem(CONTINUE_WATCHING_CONTEXT, `${item.accountId}:${item.itemId}`)
                                            }}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                        <div className="relative aspect-[2/3] overflow-hidden rounded-2xl border border-border/40 shadow-sm transition-[transform,opacity,box-shadow] duration-200 group-hover:border-primary/50 group-hover:shadow-lg">
                                            <Poster
                                                src={item.poster}
                                                itemId={item.itemId}
                                                itemType={item.type}
                                                alt={item.name}
                                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                loading="lazy"
                                            />
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                                            {item.source && <PlatformSourceBadge source={item.source} className="top-1.5 right-1.5" />}
                                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                                                <div className="h-full bg-primary" style={{ width: `${item.progress}%` }} />
                                            </div>
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                                                <div className="rounded-full border border-white/25 bg-black/75 p-2 shadow-xl">
                                                    <PlayCircle className="h-7 w-7 text-white" />
                                                </div>
                                            </div>
                                            <div className="absolute bottom-2 right-1.5">
                                                <span className="rounded-full bg-black/75 px-1.5 py-0.5 text-xs font-bold tabular-nums text-white/90">
                                                    {Math.round(item.progress)}%
                                                </span>
                                            </div>
                                            {account && (
                                                <div className="absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/20 bg-black/65 overflow-hidden">
                                                    {account.avatar ? (
                                                        <img src={account.avatar} alt="" className="h-full w-full object-cover" loading="lazy" />
                                                    ) : account.emoji ? (
                                                        <span className="text-xs font-bold leading-none text-white">{account.emoji}</span>
                                                    ) : (
                                                        <span className="text-xs font-bold leading-none text-white">{(account.name || getAccountEmail(account) || '?')[0].toUpperCase()}</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <p className="mt-1.5 truncate text-xs font-semibold leading-tight">{item.name}</p>
                                        <div className="mt-0.5 flex items-center gap-1">
                                            {(item.type === 'series' || item.type === 'anime') && item.episode !== undefined && (
                                                <span className="font-mono text-xs text-muted-foreground">S{item.season ?? 1} E{item.episode}</span>
                                            )}
                                            {account && (
                                                <>
                                                    <span className="relative h-4 w-4 shrink-0 flex items-center justify-center overflow-hidden rounded-full">
                                                        {account.avatar ? (
                                                            <img src={account.avatar} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                                                        ) : account.emoji ? (
                                                            <span className="text-xs font-bold leading-none text-muted-foreground">{account.emoji}</span>
                                                        ) : null}
                                                    </span>
                                                    <span className="truncate text-xs text-muted-foreground/60">{account.name && !account.name.includes('@')
                                                        ? maskNameLevel(account.name, privacyLevel)
                                                        : (maskEmailLevel(getAccountEmail(account) || '', privacyLevel) || account.name)}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    </motion.div>
                                )
                            })}
                </ContentRail>
              )
            })()}

            {isLoading ? (
                <div className="space-y-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <ActivityItemSkeleton key={i} />
                    ))}
                </div>
            ) : (
                <ActivityFeed
                    history={filteredHistory}
                    viewMode={viewMode}
                    todayHours={sessionComparison.todayHrs}
                    todayTrend={sessionComparison.isUp ? 'up' : 'down'}
                    selectedItems={selectedItems}
                    isBulkMode={isBulkMode}
                    onToggleSelect={handleFeedToggleSelect}
                    onDelete={handleFeedDelete}
                    onOpenDetail={handleOpenDetail}
                />
            )}

            <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Selected Items?</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-3">
                                <p>
                                    This will permanently remove {selectedItems.size} item(s) from your {platformsPhrase(selectedSources)} watch history. This cannot be undone.
                                </p>
                                {selectedHasWholeShowSeries && (
                                    <p className="text-sm text-destructive">
                                        Deleting a series removes its entire watch history for the show.
                                    </p>
                                )}
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteSelected}
                            className="bg-secondary text-destructive hover:bg-secondary/80 hover:text-destructive"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <ActivityDetailModal
                open={detailItem !== null}
                onOpenChange={(open) => { if (!open) setDetailItem(null) }}
                item={detailItem}
            />

            <ConfirmationDialog
                open={pendingDeleteIds !== null}
                onOpenChange={(open) => {
                    if (!open && !isDeletingPending) setPendingDeleteIds(null)
                }}
                title={pendingDeleteIds && pendingDeleteIds.length > 1 ? 'Delete Episodes?' : 'Delete Activity Item?'}
                description={(
                    <>
                        <p>
                            This will permanently remove {pendingDeleteIds?.length ?? 1} item{(pendingDeleteIds?.length ?? 1) > 1 ? 's' : ''} from your {platformsPhrase(pendingSources)} watch history.
                        </p>
                        {pendingHasWholeShowSeries && (
                            <p className="text-sm text-destructive">
                                Deleting a series removes its entire watch history for the show.
                            </p>
                        )}
                        <p className="text-sm text-muted-foreground">
                            This cannot be undone.
                        </p>
                    </>
                )}
                confirmText="Delete"
                isDestructive
                isLoading={isDeletingPending}
                onConfirm={() => { void handleConfirmPendingDelete() }}
            />

            {/* Floating Action Bar for Bulk Deletion */}
            <FloatingActionBar
                open={selectedItems.size > 0}
                selectedCount={selectedItems.size}
                totalCount={filteredHistory.length}
                onClearSelection={handleDeselectAll}
                actions={[
                    {
                        label: 'Select All',
                        onClick: handleSelectAll,
                        variant: 'outline',
                        icon: <Check className="h-4 w-4" />,
                        disabled: selectedItems.size === filteredHistory.length,
                        tooltip: 'Select all items',
                    },
                    {
                        label: 'Delete History',
                        onClick: () => setShowDeleteDialog(true),
                        variant: 'destructive',
                        icon: <AnimatedTrashIcon className="h-4 w-4" />,
                        tooltip: 'Delete selected items',
                    },
                ]}
            />

            </>
            )}
        </div >
    )
}
