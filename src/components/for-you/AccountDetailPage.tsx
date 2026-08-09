import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Sparkles, Users, Link as LinkIcon, Copy, Check, Bookmark, LayoutGrid, RefreshCw, Download } from 'lucide-react'
import { useWatchHistory } from '@/hooks/useWatchHistory'
import { historyEntryToActivityItem, sanitizePosterUrl } from '@/lib/activity-utils'
import { buildTasteProfile, findSimilarAccounts, type TasteProfile } from '@/lib/taste-profile'
import { useExternalRatings } from '@/lib/external-ratings-store'
import { useExternalWatchlist } from '@/lib/external-watchlist-store'
import { useRailSize, useCatalogs } from '@/lib/discovery-prefs-store'
import { useDiscoveryPrefs, HOUSEHOLD_CONTEXT } from '@/store/discoveryStore'
import {
    buildRecommendations,
    buildColdStartRails,
    buildThemedRails,
    buildCreatorsRails,
    type SeedItem,
    type RankedRail,
    type ScoredRecommendation,
} from '@/lib/recommendation-engine'
import { tmdbAdapter } from '@/api/metadata/adapters/tmdb'
import { anilistAdapter } from '@/api/metadata/adapters/anilist'
import { malAdapter } from '@/api/metadata/adapters/mal'
import { createMultiProviderAdapter } from '@/lib/recommendation-engine'

const multiAdapter = createMultiProviderAdapter(
    [
        { adapter: anilistAdapter, match: (seed) => seed.type === 'anime' },
        { adapter: malAdapter, match: (seed) => seed.type === 'anime' },
    ],
    tmdbAdapter
)
import { useAccountStore } from '@/store/accountStore'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { ToolbarShell } from '@/components/ui/toolbar-shell'
import { Button } from '@/components/ui/button'
import { ContentRail, ContentRailCard, ContentRailSkeleton, type RailWatcher } from '@/components/ui/content-rail'
import { EmptyState } from '@/components/common/EmptyState'
import type { ActivityItem } from '@/types/activity'
import type { CanonicalId, ContentType } from '@/api/metadata/types'
import { ActivityDetailModal, type DetailItem } from '@/components/activity/ActivityDetailModal'
import { DiscoveryPreferencesModal } from '@/components/for-you/DiscoveryPreferencesModal'
import { publishRecommendations, getAccountCatalogUrl, getWatchlist } from '@/lib/catalog-sync'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'

interface AccountDetailPageProps {
    accountId: string
    onBack: () => void
}

const MIN_ITEMS_FOR_RECS = 5
const MAX_PER_SEED_RAILS = 5
const MAX_SIMILAR_ACCOUNT_ITEMS = 20
const MAX_SEEDS = 15
const PER_SEED_PREFIX = 'Because you watched'
const PUBLISH_THROTTLE_MS = 5 * 60 * 1000

function railTitleToCatalogType(title: string): string | null {
    const lower = title.toLowerCase()
    if (lower.startsWith('theme:')) return 'themed_rows'
    if (lower.startsWith('because ')) return 'because_you_watched'
    if (lower.includes('movie')) return 'recommended_movies'
    if (lower.includes('series')) return 'recommended_series'
    return null
}

function railCatalogId(title: string): string | null {
    const lower = title.toLowerCase()
    if (lower.startsWith('more from')) return 'because_you_watched'
    if (lower.startsWith('because you watched') || lower.startsWith('more like')) return 'because_you_watched'
    if (lower.startsWith('theme:')) return 'themed_rows'
    if (lower.startsWith('trending ')) return 'trending_household'
    if (lower.startsWith('popular ')) return 'popular_household'
    if (lower.startsWith('recommended movies')) return 'recommended_movies'
    if (lower.startsWith('recommended series')) return 'recommended_series'
    return null
}

function activityItemToSeed(item: ActivityItem): SeedItem {
    const seed: SeedItem = {
        itemId: item.itemId,
        title: item.name,
        type: item.type,
        progress: item.progress,
        timestamp: item.timestamp.getTime(),
    }
    if (item.genres && item.genres.length > 0) seed.genres = item.genres
    if (item.season !== undefined) seed.season = item.season
    if (item.episode !== undefined) seed.episode = item.episode
    return seed
}

function toCanonicalId(itemId: string): CanonicalId {
    const imdbMatch = itemId.match(/^(tt\d{7,})$/)
    if (imdbMatch) return { imdb: imdbMatch[1], slug: itemId }
    const tmdbMatch = itemId.match(/^tmdb:(\d+)$/i)
    if (tmdbMatch) {
        const n = Number(tmdbMatch[1])
        if (Number.isFinite(n)) return { tmdb: n, slug: itemId }
    }
    return { slug: itemId }
}

function itemIdFromScoredRec(id: CanonicalId): string {
    if (id.imdb) return id.imdb
    if (typeof id.tmdb === 'number') return `tmdb:${id.tmdb}`
    return id.slug
}

function normalizeContentType(type: string): ContentType {
    if (type === 'movie') return 'movie'
    if (type === 'series' || type === 'episode') return 'series'
    if (type === 'anime') return 'anime'
    return 'other'
}

function typeLabel(type: string): string {
    if (type === 'movie') return 'Movie'
    if (type === 'series' || type === 'episode') return 'Series'
    if (type === 'anime') return 'Anime'
    return ''
}

function firstName(name: string | undefined | null): string {
    if (!name) return 'you'
    const trimmed = name.trim()
    if (!trimmed) return 'you'
    return trimmed.split(/\s+/)[0]
}

function ProfileSkeleton() {
    return (
        <div className="rounded-2xl border border-border/40 bg-card/50 p-5 shadow-sm space-y-4">
            <div className="h-5 w-44 rounded bg-muted/60 animate-pulse" />
            <div className="space-y-2">
                <div className="h-3 w-24 rounded bg-muted/40 animate-pulse" />
                <div className="flex gap-1.5">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="h-7 w-20 rounded-full bg-muted/50 animate-pulse" />
                    ))}
                </div>
            </div>
            <div className="space-y-2">
                <div className="h-3 w-20 rounded bg-muted/40 animate-pulse" />
                <div className="h-2 w-full rounded-full bg-muted/50 animate-pulse" />
            </div>
        </div>
    )
}

export function AccountDetailPage({ accountId, onBack }: AccountDetailPageProps) {
    const accounts = useAccountStore(s => s.accounts)
    const account = useMemo(() => accounts.find(a => a.id === accountId), [accounts, accountId])
    const accountName = account?.name || account?.email?.split('@')[0] || 'Account'

    const RAIL_SIZE = useRailSize(accountId)
    const catalogs = useCatalogs(accountId)
    const enabledCatalogIds = useMemo(() => {
        const s = new Set<string>()
        for (const c of catalogs) if (c.enabled || c.locked) s.add(c.id)
        return s
    }, [catalogs])

    const { history: allHistory, loading: historyLoading } = useWatchHistory()

    const allActivity = useMemo(
        () => allHistory.map(historyEntryToActivityItem).filter(item => !item.backfill),
        [allHistory]
    )

    const accountActivity = useMemo(
        () => allActivity.filter(item => item.accountId === accountId),
        [allActivity, accountId]
    )

    const watchersByItemId = useMemo(() => {
        const map = new Map<string, RailWatcher[]>()
        for (const h of allHistory) {
            const acc = accounts.find(a => a.id === h.accountId)
            if (!acc) continue
            const key = h.itemId
            const existing = map.get(key) || []
            if (!existing.some(a => a.id === acc.id)) {
                existing.push({ id: acc.id, name: acc.name || 'Account', emoji: acc.emoji, avatar: acc.avatar })
                map.set(key, existing)
            }
        }
        return map
    }, [allHistory, accounts])

    const externalRatings = useExternalRatings()
    const externalWatchlist = useExternalWatchlist()

    const tasteProfile = useMemo(
        () => buildTasteProfile(accountId, allActivity, externalRatings),
        [allActivity, accountId, externalRatings]
    )

    const otherProfiles = useMemo(() => {
        const otherAccountIds = new Set<string>()
        for (const item of allActivity) {
            if (item.accountId !== accountId) otherAccountIds.add(item.accountId)
        }
        const profiles: TasteProfile[] = []
        for (const id of otherAccountIds) {
            profiles.push(buildTasteProfile(id, allActivity, externalRatings))
        }
        return profiles
    }, [allActivity, accountId, externalRatings])

    const similarAccounts = useMemo(
        () => findSimilarAccounts(tasteProfile, otherProfiles),
        [tasteProfile, otherProfiles]
    )

    const discoveryPrefs = useDiscoveryPrefs(accountId || HOUSEHOLD_CONTEXT)

    const seeds = useMemo(
        () => {
            const fromActivity = accountActivity.map(activityItemToSeed)
            const existingIds = new Set(fromActivity.map(s => s.itemId))
            const fromWatchlist = externalWatchlist
                .filter(w => w.imdbId && !existingIds.has(w.imdbId))
                .map(w => ({
                    itemId: w.imdbId!,
                    title: w.title,
                    type: w.type,
                    progress: 0.5,
                    timestamp: Date.now(),
                }))
            return [...fromActivity, ...fromWatchlist]
        },
        [accountActivity, externalWatchlist]
    )

    const [rails, setRails] = useState<RankedRail[]>([])
    const [recsLoading, setRecsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [reloadKey, setReloadKey] = useState(0)
    const hasRailsRef = useRef(false)
    const lastPublishedRef = useRef(0)
    const [detailItem, setDetailItem] = useState<DetailItem | null>(null)
    const [catalogUrl, setCatalogUrl] = useState<string | null>(null)
    const [urlOpen, setUrlOpen] = useState(false)
    const [urlLoading, setUrlLoading] = useState(false)
    const [copied, setCopied] = useState(false)
    const [catalogOpen, setCatalogOpen] = useState(false)

    const handleItemClick = useCallback((item: ScoredRecommendation) => {
        const itemId = item.id.imdb ?? (typeof item.id.tmdb === 'number' ? `tmdb:${item.id.tmdb}` : item.id.slug)
        setDetailItem({
            itemId,
            type: item.type === 'series' || item.type === 'anime' ? 'series' : item.type,
            name: item.title,
            poster: item.poster,
            genres: item.genres,
            year: item.year,
            voteAverage: item.voteAverage,
            backdrop: item.backdrop,
        })
    }, [])

    const handleGetCatalogUrl = useCallback(async () => {
        setUrlLoading(true)
        try {
            const url = await getAccountCatalogUrl(accountId, accountName)
            if (url) {
                setCatalogUrl(url)
                setUrlOpen(true)
            } else {
                toast({ variant: 'destructive', title: 'Could not get catalog URL' })
            }
        } catch {
            toast({ variant: 'destructive', title: 'Could not get catalog URL' })
        } finally {
            setUrlLoading(false)
        }
    }, [accountId, accountName])

    const handleCopyUrl = useCallback((url: string) => {
        navigator.clipboard.writeText(url).catch(() => {})
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }, [])

    const [installing, setInstalling] = useState(false)
    const handleInstallCatalog = useCallback(async () => {
        if (!accountId) return
        setInstalling(true)
        try {
            const rawUrl = await getAccountCatalogUrl(accountId, accountName)
            if (!rawUrl) {
                toast({ variant: 'destructive', title: 'Could not generate catalog URL' })
                return
            }
            const url = rawUrl.replace(/^https?:\/\/[^/]+/, window.location.origin)
            const store = useAccountStore.getState()
            const account = store.accounts.find(a => a.id === accountId)
            if (!account) throw new Error('Account not found')
            const existing = account.addons.find(a => a.transportUrl === url || a.manifest?.id?.startsWith('com.aiomanager'))
            if (existing) {
                toast({ title: 'Already installed', description: `Recommendations addon is already on ${accountName || 'this account'}` })
                return
            }
            const fakeManifest = {
                id: `com.aiomanager.account.${accountId}`,
                version: '1.0.0',
                name: `${accountName || 'Account'} Recommendations`,
                description: `Personalized recommendations powered by AIOManager for ${accountName || 'this account'}`,
                logo: `${window.location.origin}/logo.png`,
                resources: ['catalog'],
                types: ['movie', 'series'],
                catalogs: [],
            }
            const newAddon = {
                transportUrl: url,
                transportName: 'AIOManager Catalog',
                manifest: fakeManifest,
                flags: { enabled: true },
                metadata: { lastUpdated: Date.now() },
            }
            const allAccounts = useAccountStore.getState().accounts
            const updatedAccounts = allAccounts.map(a =>
                a.id === accountId ? { ...a, addons: [...a.addons, newAddon] } : a
            )
            useAccountStore.setState({ accounts: updatedAccounts })
            const { persistAccounts } = await import('@/store/accountStore')
            await persistAccounts(updatedAccounts)
            toast({ title: 'Installed', description: `Recommendations addon added to ${accountName || 'this account'}` })
        } catch (err) {
            toast({ variant: 'destructive', title: 'Install failed', description: err instanceof Error ? err.message : 'Unknown error' })
        } finally {
            setInstalling(false)
        }
    }, [accountId, accountName])

    const [watchlistItems, setWatchlistItems] = useState<Array<{ itemId: string; type: string; name?: string; poster?: string; addedAt?: number }>>([])

    const refreshWatchlist = useCallback(() => {
        if (!accountId) return
        getWatchlist(accountId).then(items => {
            if (items.length > 0) setWatchlistItems(items.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)))
            else setWatchlistItems([])
        }).catch(() => setWatchlistItems([]))
    }, [accountId])

    useEffect(() => {
        refreshWatchlist()
    }, [refreshWatchlist])

    const watchlistRailItems = useMemo<ScoredRecommendation[]>(
        () => watchlistItems.map(item => ({
            id: { imdb: item.itemId, slug: item.itemId },
            title: item.name || 'Unknown',
            type: item.type === 'movie' ? 'movie' : 'series',
            poster: item.poster,
            score: 0,
            source: 'watchlist',
        })),
        [watchlistItems]
    )

    const filterKey = JSON.stringify({
        o: discoveryPrefs.obscurity,
        r: discoveryPrefs.minRating,
        e: discoveryPrefs.eraRange,
        t: discoveryPrefs.typeMix,
        g: discoveryPrefs.genreBoosts,
        x: discoveryPrefs.excludedGenres,
        d: discoveryPrefs.dismissedItems,
        l: discoveryPrefs.lovedItems,
    })

    useEffect(() => { lastPublishedRef.current = 0 }, [filterKey])

    useEffect(() => {
        if (accountActivity.length < MIN_ITEMS_FOR_RECS) {
            setRecsLoading(true)
            setError(null)
            let cancelled = false
            const ctrl = new AbortController()
            const coldWatched = new Set<string>()
            try {
                const cache = JSON.parse(localStorage.getItem('aiomanager-imdb-tmdb-cache') || '{}') as Record<string, string>
                for (const v of Object.values(cache)) { if (v) coldWatched.add(v) }
            } catch {}
            for (const s of seeds) { if (s.itemId.startsWith('tmdb:')) coldWatched.add(s.itemId) }
            buildColdStartRails(ctrl.signal, RAIL_SIZE, coldWatched)
                .then(rails => { if (!cancelled) setRails(rails) })
                .catch(() => { if (!cancelled) setError('Failed to load trending content') })
                .finally(() => { if (!cancelled) setRecsLoading(false) })
            return () => { cancelled = true; ctrl.abort() }
        }
        let cancelled = false
        const ctrl = new AbortController()
        const hadRails = hasRailsRef.current
        if (!hadRails) setRecsLoading(true)
        setError(null)
        const themedType = tasteProfile.types.movie >= tasteProfile.types.series ? 'movie' : 'tv'
        const cachedTmdbIds = new Set<string>()
        try {
            const cache = JSON.parse(localStorage.getItem('aiomanager-imdb-tmdb-cache') || '{}') as Record<string, string>
            for (const v of Object.values(cache)) { if (v) cachedTmdbIds.add(v) }
        } catch {}
        Promise.all([
            buildRecommendations(seeds, multiAdapter, {
                signal: ctrl.signal,
                maxSeeds: MAX_SEEDS,
                railSize: RAIL_SIZE,
                tasteProfile,
                watchedTmdbIds: cachedTmdbIds,
                filters: {
                    obscurity: discoveryPrefs.obscurity,
                    minRating: discoveryPrefs.minRating,
                    eraRange: discoveryPrefs.eraRange,
                    typeMix: discoveryPrefs.typeMix,
                    genreBoosts: discoveryPrefs.genreBoosts,
                    excludedGenres: discoveryPrefs.excludedGenres,
                    dismissedItems: discoveryPrefs.dismissedItems,
                    lovedItems: discoveryPrefs.lovedItems,
                },
            }),
            buildThemedRails(tasteProfile.genres, themedType, ctrl.signal, RAIL_SIZE, cachedTmdbIds).catch(() => [] as RankedRail[]),
            buildCreatorsRails(seeds, ctrl.signal, RAIL_SIZE, cachedTmdbIds).catch(() => [] as RankedRail[]),
        ])
            .then(([result, themedRails, creatorsRails]) => {
                if (cancelled) return
                const allSeedsFailed = result.rails.length === 0 && (result.failedSeedCount ?? 0) > 0
                if (allSeedsFailed && hadRails) return
                if (allSeedsFailed && !hadRails) {
                    setError(result.firstError || 'TMDB recommendation provider returned no results. Check the browser console for details.')
                    return
                }
                hasRailsRef.current = true
                const allRails = [...result.rails, ...themedRails, ...creatorsRails]
                setRails(allRails)

                const now = Date.now()
                if (now - lastPublishedRef.current > PUBLISH_THROTTLE_MS && allRails.length > 0) {
                    lastPublishedRef.current = now
                    const itemsByCatalogType = new Map<string, Map<string, { id: string; type: string; name: string; poster?: string; score: number; reason: string }>>()
                    for (const rail of allRails) {
                        const catalogType = railTitleToCatalogType(rail.title)
                        if (!catalogType) continue
                        for (const item of rail.items) {
                            const id = item.id.imdb ?? (typeof item.id.tmdb === 'number' ? `tmdb:${item.id.tmdb}` : item.id.slug)
                            const isAnime = item.type === 'anime' || (item.genres?.some(g => g === 'Animation' || g === 'Anime')) || (item.genreIds?.includes(16))
                            const effectiveType = isAnime && catalogType === 'recommended_series' ? 'recommended_anime' : catalogType
                            let itemMap = itemsByCatalogType.get(effectiveType)
                            if (!itemMap) {
                                itemMap = new Map()
                                itemsByCatalogType.set(effectiveType, itemMap)
                            }
                            if (!itemMap.has(id)) {
                                itemMap.set(id, {
                                    id,
                                    type: 'series',
                                    name: item.title,
                                    poster: sanitizePosterUrl(item.poster) || undefined,
                                    score: item.score,
                                    reason: rail.title,
                                })
                            }
                        }
                    }
                    const railsToPublish = Array.from(itemsByCatalogType.entries()).map(([catalogType, itemMap]) => ({
                        catalogType,
                        scope: 'account' as const,
                        accountId,
                        items: Array.from(itemMap.values()),
                    }))
                    if (railsToPublish.length > 0) {
                        publishRecommendations(railsToPublish).catch(() => {})
                    }
                }
            })
            .catch(err => {
                if (cancelled || ctrl.signal.aborted) return
                setError(err?.message ?? 'Failed to load recommendations')
            })
            .finally(() => {
                if (!cancelled) setRecsLoading(false)
            })
        return () => {
            cancelled = true
            ctrl.abort()
        }
    }, [seeds, accountActivity.length, RAIL_SIZE, accountId, filterKey, reloadKey])

    const visibleRails = useMemo(
        () => rails.filter(rail => {
            const cid = railCatalogId(rail.title)
            return cid === null || enabledCatalogIds.has(cid)
        }),
        [rails, enabledCatalogIds]
    )
    const mainRails = useMemo(
        () => visibleRails.filter(r => !r.title.startsWith(PER_SEED_PREFIX)),
        [visibleRails]
    )
    const perSeedRails = useMemo(
        () => visibleRails.filter(r => r.title.startsWith(PER_SEED_PREFIX)).slice(0, MAX_PER_SEED_RAILS),
        [visibleRails]
    )

    const similarAccountItems = useMemo(() => {
        if (similarAccounts.length === 0) return []
        const itemsByItemId = new Map<string, ActivityItem>()
        for (const item of allActivity) {
            const existing = itemsByItemId.get(item.itemId)
            if (!existing || (!existing.poster && item.poster)) {
                itemsByItemId.set(item.itemId, item)
            }
        }
        const targetItemIds = new Set(tasteProfile.topItems.map(t => t.itemId))
        const seen = new Set<string>()
        const out: ScoredRecommendation[] = []
        for (const { profile, similarity } of similarAccounts) {
            for (const top of profile.topItems) {
                if (out.length >= MAX_SIMILAR_ACCOUNT_ITEMS) break
                if (targetItemIds.has(top.itemId)) continue
                if (seen.has(top.itemId)) continue
                const original = itemsByItemId.get(top.itemId)
                if (!original) continue
                seen.add(top.itemId)
                out.push({
                    id: toCanonicalId(top.itemId),
                    title: top.title,
                    type: normalizeContentType(top.type),
                    poster: original.poster,
                    genres: top.genres,
                    score: similarity * top.engagement,
                    source: 'similar-accounts',
                    reason: 'Watched by accounts with similar taste',
                })
            }
        }
        return out
    }, [similarAccounts, tasteProfile, allActivity])

    if (!account) {
        return (
            <div className="space-y-6 overflow-x-hidden">
                <ToolbarShell>
                    <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
                        <ArrowLeft className="h-4 w-4" />
                        Back
                    </Button>
            </ToolbarShell>

                <EmptyState
                    variant="warning"
                    title="Account not found"
                    description="This account no longer exists."
                />
            </div>
        )
    }

    const first = firstName(accountName)
    const isInitialLoading = historyLoading && allActivity.length === 0
    const hasEnoughHistory = accountActivity.length >= MIN_ITEMS_FOR_RECS
    const hasAnyContent = rails.length > 0 || similarAccountItems.length > 0

    return (
        <div className="space-y-6 overflow-x-hidden">
            <ToolbarShell>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onBack}
                    className="gap-1.5 text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                </Button>
                <div className="hidden sm:block h-6 w-px bg-border/40" />
                <div className="flex items-center gap-2.5 min-w-0">
                    <AccountAvatar account={account} size="md" />
                    <div className="min-w-0">
                        <h1 className="text-sm sm:text-base font-semibold truncate leading-tight">{accountName}</h1>
                    </div>
                </div>
                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setReloadKey(k => k + 1)}
                        disabled={recsLoading}
                        className="h-8 gap-1.5 text-xs font-medium"
                    >
                        <RefreshCw className={recsLoading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
                        Refresh
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCatalogOpen(true)}
                        className="h-8 gap-1.5 text-xs font-medium"
                    >
                        <LayoutGrid className="h-3.5 w-3.5" />
                        Shelves
                    </Button>
                    <Button
                        variant="subtle"
                        size="sm"
                        onClick={handleInstallCatalog}
                        disabled={installing}
                        className="h-8 gap-1.5 text-xs font-medium"
                    >
                        <Download className="h-3.5 w-3.5" />
                        {installing ? 'Installing...' : 'Install'}
                    </Button>
                    <Button
                        variant="subtle"
                        size="sm"
                        onClick={handleGetCatalogUrl}
                        disabled={urlLoading}
                        className="h-8 gap-1.5 text-xs font-medium"
                    >
                        <LinkIcon className="h-3.5 w-3.5" />
                        Catalog URL
                    </Button>
                </div>
            </ToolbarShell>

            {isInitialLoading ? (
                <>
                    <ProfileSkeleton />
                    {Array.from({ length: 2 }).map((_, i) => (
                        <ContentRailSkeleton key={i} />
                    ))}
                </>
            ) : !hasEnoughHistory ? (
                <EmptyState
                    icon={<Sparkles className="h-5 w-5" />}
                    title="Not enough history for personalized recs"
                    description={`Watch at least ${MIN_ITEMS_FOR_RECS} items to unlock ${first}'s taste profile and recommendations.`}
                />
            ) : (
                <>
                    {watchlistRailItems.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3, ease: 'easeOut' }}
                        >
                            <ContentRail
                                title="Watchlist"
                                icon={<Bookmark className="h-4 w-4 text-primary" />}
                                count={watchlistRailItems.length}
                            >
                                {watchlistRailItems.map((item, i) => (
                                    <ContentRailCard
                                        key={`${item.id.slug}-${i}`}
                                        poster={item.poster}
                                        title={item.title}
                                        subtitle={item.year ? String(item.year) : typeLabel(item.type)}
                                        itemId={item.id.imdb ?? item.id.slug}
                                        itemType={item.type}
                                        index={i}
                                        onClick={() => handleItemClick(item)}
                                        watchers={watchersByItemId.get(itemIdFromScoredRec(item.id))}
                                    />
                                ))}
                            </ContentRail>
                        </motion.div>
                    )}

                    {recsLoading ? (
                        <div className="space-y-4">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <ContentRailSkeleton key={i} />
                            ))}
                        </div>
                    ) : error ? (
                        <EmptyState
                            variant="error"
                            title="Couldn't load recommendations"
                            description={error}
                        />
                    ) : !hasAnyContent ? (
                        <EmptyState
                            icon={<Sparkles className="h-5 w-5" />}
                            title="No recommendations yet"
                            description="We couldn't find personalized recommendations for this account right now."
                        />
                    ) : (
                        <div className="space-y-5">
                            {mainRails.length > 0 && (
                                <motion.div
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3, ease: 'easeOut' }}
                                    className="space-y-3"
                                >
                                    {mainRails.filter(r => r.items.length > 0).map(rail => (
                                        <ContentRail
                                            key={rail.title}
                                            title={
                                                rail.title === 'Recommended Movies' ? 'Movies'
                                                    : rail.title === 'Recommended Series' ? 'Series'
                                                    : rail.title
                                            }
                                            subtitle="Drawn from the entire watch history"
                                            count={rail.items.length}
                                        >
                                            {rail.items.map((item, i) => (
                                                <ContentRailCard
                                                    key={`${item.id.slug}-${i}`}
                                                    poster={item.poster}
                                                    title={item.title}
                                                    subtitle={item.year ? String(item.year) : typeLabel(item.type)}
                                                    itemId={item.id.imdb ?? item.id.slug}
                                                    itemType={item.type}
                                                    index={i}
                                                    onClick={() => handleItemClick(item)}
                                                    watchers={watchersByItemId.get(itemIdFromScoredRec(item.id))}
                                                />
                                            ))}
                                        </ContentRail>
                                    ))}
                                </motion.div>
                            )}

                            {perSeedRails.length > 0 && (
                                <motion.div
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3, delay: 0.05, ease: 'easeOut' }}
                                    className="space-y-3"
                                >
                                    {perSeedRails.filter(r => r.items.length > 0).map(rail => (
                                        <ContentRail
                                            key={rail.title}
                                            title={rail.title.replace(PER_SEED_PREFIX, `Because ${first} watched`)}
                                            subtitle="Tailored to the standout picks"
                                            count={rail.items.length}
                                        >
                                            {rail.items.map((item, i) => (
                                                <ContentRailCard
                                                    key={`${item.id.slug}-${i}`}
                                                    poster={item.poster}
                                                    title={item.title}
                                                    subtitle={item.year ? String(item.year) : typeLabel(item.type)}
                                                    itemId={item.id.imdb ?? item.id.slug}
                                                    itemType={item.type}
                                                    index={i}
                                                    onClick={() => handleItemClick(item)}
                                                    watchers={watchersByItemId.get(itemIdFromScoredRec(item.id))}
                                                />
                                            ))}
                                        </ContentRail>
                                    ))}
                                </motion.div>
                            )}

                            {similarAccountItems.length > 0 && (
                                <motion.div
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3, delay: 0.1, ease: 'easeOut' }}
                                >
                                    <ContentRail
                                        title="Accounts with similar taste also watched"
                                        icon={<Users className="h-4 w-4 text-primary" />}
                                        count={similarAccountItems.length}
                                    >
                                        {similarAccountItems.map((item, i) => (
                                            <ContentRailCard
                                                key={`${item.id.slug}-${i}`}
                                                poster={item.poster}
                                                title={item.title}
                                                subtitle={item.year ? String(item.year) : typeLabel(item.type)}
                                                itemId={item.id.imdb ?? item.id.slug}
                                                itemType={item.type}
                                                index={i}
                                                onClick={() => handleItemClick(item)}
                                                watchers={watchersByItemId.get(itemIdFromScoredRec(item.id))}
                                            />
                                        ))}
                                    </ContentRail>
                                </motion.div>
                            )}
                        </div>
                    )}
                </>
            )}

            <ActivityDetailModal
                open={detailItem !== null}
                onOpenChange={(open) => { if (!open) { setDetailItem(null); refreshWatchlist() } }}
                item={detailItem}
            />

            <DiscoveryPreferencesModal
                open={catalogOpen}
                onOpenChange={setCatalogOpen}
                accountId={accountId}
            />

            <Dialog open={urlOpen} onOpenChange={setUrlOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <LinkIcon className="h-4 w-4 text-primary" />
                            {first}'s Catalog URL
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Install this addon URL into Stremio, AIOManager, or any compatible client to get {first}'s personalized recommendations as browsable catalogs.
                        </p>
                        {catalogUrl && (
                            <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/40 p-2 sm:p-3">
                                <code className="flex-1 break-all text-xs text-muted-foreground">{catalogUrl}</code>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleCopyUrl(catalogUrl)}
                                    className="h-7 shrink-0 gap-1 px-2"
                                >
                                    {copied ? (
                                        <><Check className="h-3.5 w-3.5 text-green-500" /> Copied</>
                                    ) : (
                                        <><Copy className="h-3.5 w-3.5" /> Copy</>
                                    )}
                                </Button>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
