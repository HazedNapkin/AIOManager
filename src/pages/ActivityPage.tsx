import { triggerSync } from '@/lib/sync-trigger'
import { ActivityFeed } from '@/components/activity/ActivityFeed'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AccountSwitcher } from '@/components/common/AccountSwitcher'
import { ActivityItem } from '@/types/activity'
import { useAccountStore, getStremioAuthKey, getAccountEmail } from '@/store/accountStore'
import { useLibraryCache } from '@/store/libraryCache'
import { useWatchHistory } from '@/hooks/useWatchHistory'
import { stremioClient } from '@/api/stremio-client'
import { decrypt } from '@/lib/crypto'
import { useAuthStore } from '@/store/authStore'
import { useSyncStore } from '@/store/syncStore'
import { useWatchEventStore } from '@/store/watchEventStore'
import { ActivityItemSkeleton } from '@/components/ui/skeleton'
import { historyEntryToActivityItem } from '@/lib/activity-utils'

import { FloatingActionBar, type FloatingActionItem } from '@/components/ui/floating-action-bar'
import { Grid, List, Search, Check, X, PlayCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { AnimatedRefreshIcon, AnimatedTrashIcon } from '@/components/ui/AnimatedIcons'
import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { toast } from '@/hooks/use-toast'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { cn, openStremioDetail } from '@/lib/utils'
import { useTheme } from '@/contexts/ThemeContext'
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
import { Progress } from '@/components/ui/progress'
import { ToolbarShell } from '@/components/ui/toolbar-shell'
import { StatusChip } from '@/components/ui/status-chip'
import { Poster } from '@/components/common/Poster'
import { PlatformSourceBadge } from '@/components/activity/PlatformSourceBadge'
import { mapConcurrent } from '@/lib/concurrency'

const ACTIVITY_ACCOUNT_DELETE_CONCURRENCY = 4
const ACTIVITY_ITEM_DELETE_CONCURRENCY = 5

export function ActivityPage() {
    useDocumentTitle('Activity')
    const { isLight } = useTheme()
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
    const syncToRemote = useSyncStore(s => s.syncToRemote)
    const watchEventsInitialized = useWatchEventStore(s => s.initialized)

    const { history: watchHistory, inProgress } = useWatchHistory()

    // Convert to ActivityItem[] for existing feed components. Backfilled episodes (recovered from the
    // watched-bitfield) have no real per-episode time, so they are kept out of the chronological feed
    // -- they still power Replay totals/discoveries and the per-show "seen" state.
    const history: ActivityItem[] = useMemo(
        () => watchHistory.map(historyEntryToActivityItem).filter(item => !item.backfill),
        [watchHistory]
    )

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
    const cloudRefreshAttemptedRef = useRef(false)
    const continueWatchingRef = useRef<HTMLDivElement>(null)
    const scrollRail = useCallback((dir: 'left' | 'right') => {
        const el = continueWatchingRef.current
        if (!el) return
        el.scrollBy({ left: dir === 'right' ? 320 : -320, behavior: 'smooth' })
    }, [])

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
        const accountMap = new Map<string, { id: string; name: string; colorIndex: number; emoji?: string }>()
        history.forEach(item => {
            if (!accountMap.has(item.accountId)) {
                accountMap.set(item.accountId, {
                    id: item.accountId,
                    name: item.accountName,
                    colorIndex: item.accountColorIndex,
                    emoji: accountById.get(item.accountId)?.emoji
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
                return item.name.toLowerCase().includes(searchLower)
            }
            return true
        })
    }, [history, userFilter, searchTerm, timeFilter, customStartDate])

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
        try { localStorage.setItem('activity-view-mode', mode) } catch { /* storage unavailable */ }
        triggerSync()
    }, [syncToRemote])


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
        // If we manually select something, ensure we're in bulk mode for the UI
        setIsBulkMode(true)
    }, [handleToggleSelect])

    const handleFeedDelete = useCallback((id: string | string[]) => {
        const ids = Array.isArray(id) ? id : [id]
        setPendingDeleteIds(ids)
    }, [])

    const handleDeleteSelected = async () => {
        if (selectedItems.size === 0) return
        const count = selectedItems.size
        const itemIds = Array.from(selectedItems)
        setShowDeleteDialog(false)
        setSelectedItems(new Set())

        const { encryptionKey } = useAuthStore.getState()
        let failed = false
        if (encryptionKey) {
            const itemIdSet = new Set(itemIds)
            const itemsToDelete = history.filter(item => itemIdSet.has(item.id))
            const itemsByAccount: Record<string, typeof itemsToDelete> = {}
            itemsToDelete.forEach(item => {
                if (!itemsByAccount[item.accountId]) itemsByAccount[item.accountId] = []
                itemsByAccount[item.accountId].push(item)
            })
            await mapConcurrent(Object.entries(itemsByAccount), ACTIVITY_ACCOUNT_DELETE_CONCURRENCY, async ([accountId, items]) => {
                const account = accountById.get(accountId)
                if (!account) return
                try {
                    const authKey = await decrypt(getStremioAuthKey(account), encryptionKey)
                    await mapConcurrent(items, ACTIVITY_ITEM_DELETE_CONCURRENCY, async (item) => {
                        try {
                            await stremioClient.removeLibraryItem(authKey, item.itemId, account.id)
                        } catch (e) {
                            if (import.meta.env.DEV) console.error(`Failed to remove ${item.itemId}:`, e)
                            failed = true
                        }
                    })
                } catch (e) {
                    if (import.meta.env.DEV) console.error(`Failed to process deletions for account ${accountId}:`, e)
                    failed = true
                }
            })
        }

        removeItems(itemIds)

        if (failed) {
            toast({ variant: 'destructive', title: 'Partial Deletion', description: 'Some items could not be removed from Stremio.' })
        } else {
            toast({
                title: 'Items Deleted',
                description: `${count} item(s) removed from Stremio history.`
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
            removeItems(ids)

            const { encryptionKey } = useAuthStore.getState()
            if (encryptionKey) {
                const idSet = new Set(ids)
                const itemsToDelete = history.filter(item => idSet.has(item.id))
                for (const item of itemsToDelete) {
                    const account = accountById.get(item.accountId)
                    if (account) {
                        try {
                            const authKey = await decrypt(getStremioAuthKey(account), encryptionKey)
                            await stremioClient.removeLibraryItem(authKey, item.itemId, account.id)
                        } catch (e) {
                            if (import.meta.env.DEV) console.error(`Failed to remove ${item.itemId}:`, e)
                        }
                    }
                }
            }

            toast({
                title: ids.length > 1 ? 'Episodes Deleted' : 'Item Deleted',
                description: 'Removed from activity history.'
            })
            setPendingDeleteIds(null)
        } finally {
            setIsDeletingPending(false)
        }
    }

    const isSelecting = selectedItems.size > 0 || isBulkMode
    const isLoading = loading || isRefreshingFromCloud
    const loadingPercent = loadingProgress.total > 0 ? (loadingProgress.current / loadingProgress.total) * 100 : 0

    return (
        <div className="space-y-6 overflow-x-hidden">
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
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 hover:bg-accent rounded-full transition-colors focus:outline-none"
                            aria-label="Clear search"
                        >
                            <X className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                    )}
                </div>

                {isLoading && (
                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                        <StatusChip variant="primary">
                            {loadingProgress.current > 0 ? `Synced ${loadingProgress.current} of ${loadingProgress.total}` : 'Connecting...'}
                        </StatusChip>
                    </div>
                )}

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
                            buttonClassName="inline-flex h-8 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-input bg-background px-3 text-xs font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                        />
                    )}

                    <Select value={timeFilter} onValueChange={(val) => {
                        setTimeFilter(val)
                        try { localStorage.setItem('activity-time-filter', val) } catch { /* storage unavailable */ }
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
                                try { localStorage.setItem('activity-since-date', e.target.value) } catch { /* storage unavailable */ }
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
                    </div>
                </div>
            </ToolbarShell>
            {isLoading && (
                <div className="-mt-4 h-1 overflow-hidden rounded-full bg-muted">
                    <Progress value={loadingPercent} className="h-full bg-primary transition-[transform,opacity,box-shadow] duration-300" />
                </div>
            )}

            {/* Continue Watching Rail */}
            {inProgress.length > 0 && !searchTerm && userFilter === 'all' && timeFilter === 'all' && (
                <div className="rounded-2xl border border-border/40 bg-card/50 p-3 space-y-3 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold">Continue Watching</p>
                            <p className="text-xs text-muted-foreground">Resume in-progress streams from the latest account sync.</p>
                        </div>
                        <StatusChip variant="muted" icon={<PlayCircle />}>
                            {inProgress.length} active
                        </StatusChip>
                    </div>
                    <div className="relative group/rail">
                        <button
                            onClick={() => scrollRail('left')}
                            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-background/95 border border-border/40 shadow-md flex items-center justify-center opacity-0 group-hover/rail:opacity-100 transition-opacity hover:bg-muted -translate-x-3"
                            aria-label="Scroll left"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <button
                            onClick={() => scrollRail('right')}
                            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-background/95 border border-border/40 shadow-md flex items-center justify-center opacity-0 group-hover/rail:opacity-100 transition-opacity hover:bg-muted translate-x-3"
                            aria-label="Scroll right"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                        <div ref={continueWatchingRef} className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
                            {inProgress.map((item, i) => {
                                const account = accountById.get(item.accountId)
                                return (
                                    <motion.div
                                        key={item.id}
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: i * 0.04, duration: 0.25, ease: 'easeOut' }}
                                        className="relative w-28 shrink-0 cursor-pointer group"
                                        onClick={() => openStremioDetail(item.type, item.itemId)}
                                    >
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
                                            {/* Progress bar */}
                                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                                                <div className="h-full bg-primary transition-[transform,opacity,box-shadow]" style={{ width: `${item.progress}%` }} />
                                            </div>
                                            {/* Hover play icon */}
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                                                <div className="rounded-full border border-white/25 bg-black/75 p-2 shadow-xl">
                                                    <PlayCircle className={`h-7 w-7 text-white ${isLight ? 'drop-shadow-lg' : 'drop-shadow-sm'}`} />
                                                </div>
                                            </div>
                                            {/* Progress % */}
                                            <div className="absolute bottom-2 right-1.5">
                                                <span className="rounded-full bg-black/75 px-1.5 py-0.5 text-xs font-bold tabular-nums text-white/90">
                                                    {Math.round(item.progress)}%
                                                </span>
                                            </div>
                                            {/* Account avatar top-left */}
                                            {account && (
                                                <div className="absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/20 bg-black/65">
                                                    <span className="text-xs font-bold leading-none text-white">
                                                        {account.emoji || (account.name || getAccountEmail(account) || '?')[0].toUpperCase()}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                        <p className="mt-1.5 truncate text-xs font-semibold leading-tight">{item.name}</p>
                                        <div className="mt-0.5 flex items-center gap-1">
                                            {(item.type === 'series' || item.type === 'anime') && item.episode !== undefined && (
                                                <span className="font-mono text-xs text-muted-foreground">S{item.season ?? 1} E{item.episode}</span>
                                            )}
                                            {account && (
                                                <span className="truncate text-xs text-muted-foreground/60">{account.name || getAccountEmail(account)?.split('@')[0]}</span>
                                            )}
                                        </div>
                                    </motion.div>
                                )
                            })}
                        </div>
                    </div>
                </div>
            )}

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
                />
            )}

            <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Selected Items?</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-3">
                                <p>
                                    This will permanently remove {selectedItems.size} item(s) from your Stremio watch history. This cannot be undone.
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Note: deleting a series removes the entire show, not individual episodes. This is a Stremio limitation.
                                </p>
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

            <ConfirmationDialog
                open={pendingDeleteIds !== null}
                onOpenChange={(open) => {
                    if (!open && !isDeletingPending) setPendingDeleteIds(null)
                }}
                title={pendingDeleteIds && pendingDeleteIds.length > 1 ? 'Delete Episodes?' : 'Delete Activity Item?'}
                description={(
                    <>
                        <p>
                            This will permanently remove {pendingDeleteIds?.length ?? 1} item{(pendingDeleteIds?.length ?? 1) > 1 ? 's' : ''} from your Stremio watch history.
                        </p>
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
                        disabled: selectedItems.size === filteredHistory.length
                    },
                    {
                        label: 'Delete History',
                        onClick: () => setShowDeleteDialog(true),
                        variant: 'destructive',
                        icon: <AnimatedTrashIcon className="h-4 w-4" />
                    },
                ].filter(Boolean) as FloatingActionItem[]}
            />

        </div >
    )
}
