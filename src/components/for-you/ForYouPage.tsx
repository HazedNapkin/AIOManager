import { useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, RefreshCw, AlertCircle, Sparkles, Users, Film, Tv, ArrowRight, Copy, Check, Dice3, Info, Search, Bookmark, LayoutGrid } from 'lucide-react'

import { ToolbarShell } from '@/components/ui/toolbar-shell'
import { ContentRail, ContentRailCard, ContentRailSkeleton } from '@/components/ui/content-rail'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { SearchDialog } from '@/components/search/SearchDialog'
import { useWatchHistory } from '@/hooks/useWatchHistory'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useAccountStore } from '@/store/accountStore'
import { useDiscoveryPrefs, useHouseholdSettings, HOUSEHOLD_CONTEXT } from '@/store/discoveryStore'
import { DiscoveryPreferencesModal } from '@/components/for-you/DiscoveryPreferencesModal'
import { historyEntryToActivityItem, sanitizePosterUrl } from '@/lib/activity-utils'
import { cn, maskNameLevel } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { ActivityDetailModal, type DetailItem } from '@/components/activity/ActivityDetailModal'
import { buildTasteProfile, computeHouseholdPopularity, findSimilarAccounts, type TasteProfile } from '@/lib/taste-profile'
import { useExternalRatings } from '@/lib/external-ratings-store'
import { useExternalWatchlist } from '@/lib/external-watchlist-store'
import { useRailSize, useCatalogs } from '@/lib/discovery-prefs-store'
import {
    buildRecommendations,
    buildColdStartRails,
    buildThemedRails,
    type SeedItem,
    type BuildRecommendationsResult,
    type RankedRail,
    type ScoredRecommendation,
} from '@/lib/recommendation-engine'
import { tmdbAdapter, fetchTmdbDetailsAsMeta, proxyFetch } from '@/api/metadata/adapters/tmdb'
import { anilistAdapter } from '@/api/metadata/adapters/anilist'
import { malAdapter } from '@/api/metadata/adapters/mal'
import { createMultiProviderAdapter } from '@/lib/recommendation-engine'
import { getHouseholdCatalogUrl, getAllCatalogUrls, publishRecommendations, getWatchlist, type PublishRail } from '@/lib/catalog-sync'
import { toast } from '@/hooks/use-toast'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const multiAdapter = createMultiProviderAdapter(
    [
        { adapter: anilistAdapter, match: (seed) => seed.type === 'anime' },
        { adapter: malAdapter, match: (seed) => seed.type === 'anime' },
    ],
    tmdbAdapter
)
import type { CanonicalId } from '@/api/metadata/types'
import type { ActivityItem } from '@/types/activity'
import type { Account } from '@/types/account'

const HOUSEHOLD_RAIL_MAX = 12
const PUBLISH_THROTTLE_MS = 6 * 60 * 60 * 1000

function railTitleToCatalogType(title: string): string | null {
    const lower = title.toLowerCase()
    if (lower.startsWith('theme:')) return 'themed_rows'
    if (lower.startsWith('because ')) return 'because_you_watched'
    if (lower.includes('accounts like yours') || lower.includes('similar accounts')) return 'because_you_watched'
    if (lower.startsWith('popular ')) return 'popular_household'
    if (lower.includes('movie')) return 'recommended_movies'
    if (lower.includes('series')) return 'recommended_series'
    return null
}

function railCatalogId(title: string): string | null {
    const lower = title.toLowerCase()
    if (lower.startsWith('more from')) return 'because_you_watched'
    if (lower.startsWith('because you watched') || lower.startsWith('more like')) return 'because_you_watched'
    if (lower.includes('accounts like yours') || lower.includes('similar accounts')) return 'because_you_watched'
    if (lower.startsWith('theme:')) return 'themed_rows'
    if (lower.startsWith('trending ')) return 'trending_household'
    if (lower.startsWith('popular ')) return 'popular_household'
    if (lower.startsWith('recommended movies')) return 'recommended_movies'
    if (lower.startsWith('recommended series')) return 'recommended_series'
    return null
}

export interface ForYouPageProps {
    onAccountClick?: (accountId: string) => void
    onItemClick?: (item: { itemId: string; type: string; name: string }) => void
}

// ─── Hero ──────────────────────────────────────────────────────────────────

interface HeroItem {
    title: string
    backdrop?: string
    poster?: string
    year?: number
    genres?: string[]
    voteAverage?: number
    description?: string
    itemId?: string
    type?: string
    confidence?: number
}

interface ForYouHeroProps {
    item: HeroItem | null
    loading: boolean
    onMoreInfo?: () => void
    onSurpriseMe?: () => void
    surpriseSpinning?: boolean
}

function ForYouHero({ item, loading, onMoreInfo, onSurpriseMe, surpriseSpinning }: ForYouHeroProps) {
    const [fetchedBackdrop, setFetchedBackdrop] = useState<string | null>(null)
    const [backdropFailed, setBackdropFailed] = useState(false)

    useEffect(() => {
        setBackdropFailed(false)
        if (!item || item.backdrop) {
            setFetchedBackdrop(null)
            return
        }
        let active = true
        const isImdb = item.itemId?.startsWith('tt')
        const tmdbMatch = item.itemId?.match(/^tmdb:(\d+)$/i)

        if (tmdbMatch) {
            const tmdbId = Number(tmdbMatch[1])
            const mediaType = item.type === 'series' || item.type === 'anime' ? 'tv' : 'movie'
            fetchTmdbDetailsAsMeta(tmdbId, mediaType).then(res => {
                if (active && res.meta.background) setFetchedBackdrop(res.meta.background)
            }).catch(() => {})
        } else if (isImdb && item.itemId) {
            proxyFetch<any>(`find/${encodeURIComponent(item.itemId)}?external_source=imdb_id`).then(data => {
                const result = data?.movie_results?.[0] || data?.tv_results?.[0]
                if (result?.id) {
                    const mediaType = data?.movie_results?.[0] ? 'movie' : 'tv'
                    fetchTmdbDetailsAsMeta(result.id, mediaType).then(res => {
                        if (active && res.meta.background) setFetchedBackdrop(res.meta.background)
                    }).catch(() => {})
                }
            }).catch(() => {})
        }
        return () => { active = false }
    }, [item?.itemId, item?.backdrop, item?.type])

    const activeBackdrop = item?.backdrop || fetchedBackdrop

    return (
        <div className="relative w-full overflow-hidden rounded-3xl bg-black text-white shadow-2xl ring-1 ring-border/30" style={{ height: 'clamp(280px, 42vh, 420px)' }}>
            {!loading && activeBackdrop && !backdropFailed && (
                <img
                    src={activeBackdrop}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 h-full w-full object-cover filter blur-3xl opacity-50 scale-125"
                    onError={() => setBackdropFailed(true)}
                />
            )}

            <AnimatePresence mode="wait">
                {loading || !item ? (
                    <motion.div
                        key="hero-skeleton"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-white/5"
                    >
                        <div className="absolute inset-0 animate-pulse bg-white/5" />
                    </motion.div>
                ) : (
                    <motion.div
                        key={`hero-${item.itemId}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.6, ease: 'easeInOut' }}
                        className="absolute inset-0 bg-black"
                    >
                        {activeBackdrop && !backdropFailed ? (
                            <img
                                src={activeBackdrop}
                                alt=""
                                aria-hidden="true"
                                className="absolute inset-0 h-full w-full object-cover opacity-95 transition-opacity duration-300 sm:object-[center_25%]"
                                style={{
                                    maskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 70%, rgba(0,0,0,0) 100%)',
                                    WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 70%, rgba(0,0,0,0) 100%)',
                                }}
                                onError={() => setBackdropFailed(true)}
                            />
                        ) : item.poster ? (
                            <>
                                <div className="absolute inset-0 bg-gradient-to-r from-black via-black/90 to-black" />
                                <div className="absolute right-0 top-0 bottom-0 w-1/2 overflow-hidden opacity-75">
                                    <img
                                        src={item.poster}
                                        alt=""
                                        aria-hidden="true"
                                        className="h-full w-full object-cover object-top"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-r from-black via-transparent to-transparent" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
                                </div>
                            </>
                        ) : (
                            <div className="absolute inset-0 bg-black/90" />
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/50 via-black/15 to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 left-0 w-3/5 bg-gradient-to-r from-black/60 via-black/20 to-transparent" />

            {/* Content Container */}
            <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 px-4 pb-6 pt-8 sm:px-6 sm:pb-8 sm:pt-12 sm:px-10">
                {loading || !item ? (
                    <div className="space-y-3">
                        <div className="h-8 w-64 animate-pulse rounded-lg bg-white/20" />
                        <div className="h-4 w-48 animate-pulse rounded bg-white/10" />
                    </div>
                ) : (
                    <motion.div
                        key={`hero-content-${item.itemId}`}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15, duration: 0.4 }}
                        className="space-y-3 max-w-3xl text-white"
                    >
                        {/* Apple TV Badges Row */}
                        <div className="flex flex-wrap items-center gap-2">
                            {item.genres && item.genres[0] && (
                                <span className="rounded-md border border-white/20 bg-black/60 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white backdrop-blur-md">
                                    {item.genres[0]}
                                </span>
                            )}
                        </div>

                        {/* Title — Always Crisp White */}
                        <h2 className="text-2xl sm:text-3xl font-black leading-tight tracking-tight text-white drop-shadow-lg sm:text-5xl">
                            {item.title}
                        </h2>

                        {/* Meta Subtitle — High contrast text-white/80 */}
                        <p className="text-sm font-semibold text-white/80 drop-shadow">
                            {[
                                item.year,
                                typeof item.voteAverage === 'number' && item.voteAverage > 0 ? `★ ${item.voteAverage.toFixed(1)}` : null,
                                item.genres?.slice(1, 4).join(' · ')
                            ].filter(Boolean).join('  ·  ')}
                        </p>

                        {/* CTAs — Authentic Apple TV Action Pills */}
                        <div className="flex flex-wrap items-center gap-3 pt-2">
                            {onMoreInfo && (
                                <button
                                    type="button"
                                    onClick={onMoreInfo}
                                    className="inline-flex h-11 items-center gap-2.5 rounded-full bg-white px-7 text-sm font-bold text-black shadow-xl transition-all hover:bg-white/90 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                                >
                                    <Info className="h-4 w-4" />
                                    More Info
                                </button>
                            )}
                            {onSurpriseMe && (
                                <button
                                    type="button"
                                    onClick={onSurpriseMe}
                                    className="inline-flex h-11 items-center gap-2.5 rounded-full border border-white/20 bg-white/10 px-6 text-sm font-semibold text-white backdrop-blur-md transition-all hover:bg-white/20 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                                >
                                    <Dice3 className={cn('h-4 w-4', surpriseSpinning && 'animate-spin')} />
                                    {surpriseSpinning ? 'Picking…' : 'Surprise Me'}
                                </button>
                            )}
                        </div>
                    </motion.div>
                )}
            </div>
        </div>
    )
}

function recommendationIcon(title: string): ReactNode {
    if (/movie/i.test(title)) return <Film className="h-4 w-4 text-primary" />
    if (/series/i.test(title)) return <Tv className="h-4 w-4 text-primary" />
    return <Sparkles className="h-4 w-4 text-primary" />
}

function itemIdFromCanonical(id: CanonicalId): string {
    if (id.imdb) return id.imdb
    if (typeof id.tmdb === 'number') return `tmdb:${id.tmdb}`
    return id.slug
}

function makeCanonicalId(itemId: string): CanonicalId {
    if (itemId.startsWith('tt')) return { imdb: itemId, slug: itemId }
    const tmdbMatch = itemId.match(/^tmdb:(\d+)$/i)
    if (tmdbMatch) return { tmdb: Number(tmdbMatch[1]), slug: itemId }
    return { slug: itemId }
}

export function ForYouPage({ onAccountClick }: ForYouPageProps) {
    useDocumentTitle('For You')

    const RAIL_MAX = useRailSize()
    const catalogs = useCatalogs()
    const enabledCatalogIds = useMemo(() => {
        const s = new Set<string>()
        for (const c of catalogs) if (c.enabled || c.locked) s.add(c.id)
        return s
    }, [catalogs])
    const accounts = useAccountStore(s => s.accounts)
    const isPrivacyModeEnabled = useUIStore(s => s.isPrivacyModeEnabled)
    const privacyLevelNames = useUIStore(s => s.privacyLevelNames)
    const namePrivacy = isPrivacyModeEnabled ? privacyLevelNames : 0
    const { history: watchHistory, loading: historyLoading } = useWatchHistory()
    const discoveryPrefs = useDiscoveryPrefs(HOUSEHOLD_CONTEXT)
    const householdSettings = useHouseholdSettings()
    const [catalogOpen, setCatalogOpen] = useState(false)
    const [subTab, setSubTab] = useState<'unified' | 'accounts'>('unified')
    const [heroIndex, setHeroIndex] = useState(0)
    const [heroPaused, setHeroPaused] = useState(false)

    const allItems = useMemo<ActivityItem[]>(
        () => watchHistory.map(historyEntryToActivityItem).filter(item => !item.backfill),
        [watchHistory]
    )

    const filteredItems = useMemo(() => {
        if (householdSettings.enabledAccounts === 'all') return allItems
        return allItems.filter(item => householdSettings.enabledAccounts.includes(item.accountId))
    }, [allItems, householdSettings.enabledAccounts])

    const itemsByAccount = useMemo(() => {
        const m = new Map<string, ActivityItem[]>()
        for (const item of allItems) {
            const arr = m.get(item.accountId)
            if (arr) arr.push(item)
            else m.set(item.accountId, [item])
        }
        return m
    }, [allItems])

    const watchersByItemId = useMemo(() => {
        const map = new Map<string, Array<{ id: string; name: string; emoji?: string; avatar?: string }>>()
        for (const h of watchHistory) {
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
    }, [watchHistory, accounts])

    const externalRatings = useExternalRatings()
    const externalWatchlist = useExternalWatchlist()

    const profiles = useMemo(() => {
        const m = new Map<string, TasteProfile>()
        for (const [accId, items] of itemsByAccount) {
            if (items.length === 0) continue
            m.set(accId, buildTasteProfile(accId, items, externalRatings))
        }
        return m
    }, [itemsByAccount, externalRatings])

    const householdGenres = useMemo(() => {
        const merged: Record<string, { weight: number; count: number }> = {}
        for (const profile of profiles.values()) {
            for (const [genre, data] of Object.entries(profile.genres)) {
                if (!merged[genre]) merged[genre] = { weight: 0, count: 0 }
                merged[genre].weight += data.weight
                merged[genre].count += data.count
            }
        }
        return merged
    }, [profiles])

    const householdDominantType = useMemo(() => {
        let movie = 0, series = 0
        for (const profile of profiles.values()) {
            movie += profile.types.movie
            series += profile.types.series
        }
        return movie >= series ? 'movie' : 'tv'
    }, [profiles])

    const householdProfile = useMemo(() => {
        if (profiles.size === 0) return undefined
        let best: TasteProfile | undefined
        for (const p of profiles.values()) {
            if (!best || p.totalItems > best.totalItems) best = p
        }
        return best
    }, [profiles])

    const seeds = useMemo<SeedItem[]>(
        () => {
            const fromActivity = filteredItems.map(item => ({
                itemId: item.itemId,
                title: item.name,
                type: item.type,
                genres: item.genres,
                progress: item.progress,
                timestamp: item.timestamp.getTime(),
                season: item.season,
                episode: item.episode,
            }))
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
        [filteredItems, externalWatchlist]
    )

    const [recsResult, setRecsResult] = useState<BuildRecommendationsResult | null>(null)
    const [recsLoading, setRecsLoading] = useState(false)
    const [recsError, setRecsError] = useState<string | null>(null)
    const [reloadKey, setReloadKey] = useState(0)
    const hasResultsRef = useRef(false)
    const lastPublishedRef = useRef(0)

    const [watchlistItems, setWatchlistItems] = useState<Array<{ itemId: string; type: string; name?: string; poster?: string; addedAt?: number }>>([])

    const refreshWatchlist = useCallback(() => {
        getWatchlist().then(items => {
            if (items.length > 0) setWatchlistItems(items.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)))
            else setWatchlistItems([])
        }).catch(() => setWatchlistItems([]))
    }, [])

    useEffect(() => {
        refreshWatchlist()
    }, [refreshWatchlist])

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

    useEffect(() => {
        if (seeds.length < 5) {
            setRecsLoading(true)
            setRecsError(null)
            const ac = new AbortController()
            const coldStartWatched = new Set<string>()
            try {
                const cache = JSON.parse(localStorage.getItem('aiomanager-imdb-tmdb-cache') || '{}') as Record<string, string>
                for (const v of Object.values(cache)) { if (v) coldStartWatched.add(v) }
            } catch {}
            for (const s of seeds) { if (s.itemId.startsWith('tmdb:')) coldStartWatched.add(s.itemId) }
            buildColdStartRails(ac.signal, RAIL_MAX, coldStartWatched)
                .then(rails => {
                    if (ac.signal.aborted) return
                    setRecsResult({ rails, totalCandidates: rails.reduce((s, r) => s + r.items.length, 0) })
                })
                .catch(err => { if (ac.signal.aborted || err?.name === 'AbortError') return; setRecsError('Failed to load trending content') })
                .finally(() => { if (!ac.signal.aborted) setRecsLoading(false) })
            return () => ac.abort()
        }
        const ac = new AbortController()
        const hadResults = hasResultsRef.current
        if (!hadResults) setRecsLoading(true)
        setRecsError(null)
        performance.mark('foryou:recommend:start')
        ;(async () => {
            const watchedTmdbIds = new Set<string>()
            const cacheKey = 'aiomanager-imdb-tmdb-cache'
            let cache: Record<string, string> = {}
            try { cache = JSON.parse(localStorage.getItem(cacheKey) || '{}') } catch {}
            let cacheDirty = false
            const watchedIds = seeds.filter(s => s.progress > 30 && s.itemId?.startsWith('tt')).map(s => s.itemId).slice(0, 20)
            const needsResolve = watchedIds.filter(id => !cache[id])
            const BATCH = 3
            for (let i = 0; i < needsResolve.length; i += BATCH) {
                if (ac.signal.aborted) break
                const batch = needsResolve.slice(i, i + BATCH)
                await Promise.all(batch.map(async (imdbId) => {
                    try {
                        const data = await proxyFetch<{ movie_results?: Array<{ id: number }>, tv_results?: Array<{ id: number }> }>(`find/${imdbId}?external_source=imdb_id`, ac.signal)
                        const tmdbId = data?.movie_results?.[0]?.id ?? data?.tv_results?.[0]?.id
                        if (tmdbId) {
                            cache[imdbId] = `tmdb:${tmdbId}`
                            cacheDirty = true
                        }
                    } catch {}
                }))
                if (i + BATCH < needsResolve.length) await new Promise(r => setTimeout(r, 200))
            }
            if (cacheDirty) { try { localStorage.setItem(cacheKey, JSON.stringify(cache)) } catch {} }
            for (const id of watchedIds) { if (cache[id]) watchedTmdbIds.add(cache[id]) }
            return watchedTmdbIds
        })().then(watchedTmdbIds =>
            Promise.all([
                buildRecommendations(seeds, multiAdapter, {
                    signal: ac.signal,
                    railSize: RAIL_MAX,
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
                    tasteProfile: householdProfile,
                    watchedTmdbIds,
                }),
                buildThemedRails(householdGenres, householdDominantType, ac.signal, RAIL_MAX, watchedTmdbIds).catch(() => [] as RankedRail[]),
            ])
        )
            .then(([result, themedRails]) => {
                if (ac.signal.aborted) return
                const allSeedsFailed = result.rails.length === 0 && (result.failedSeedCount ?? 0) > 0
                if (allSeedsFailed) {
                    setRecsError(result.firstError || 'TMDB recommendation provider returned no results. Check the browser console for details.')
                    if (hadResults) return
                }
                hasResultsRef.current = true

                const similarRails: RankedRail[] = []
                if (householdProfile) {
                    const otherProfiles = Array.from(profiles.values()).filter(p => p.accountId !== householdProfile.accountId)
                    const similar = findSimilarAccounts(householdProfile, otherProfiles)
                    if (similar.length > 0) {
                        const householdWatched = new Set<string>()
                        for (const it of allItems) householdWatched.add(it.itemId)
                        const seen = new Set<string>()
                        const items: ScoredRecommendation[] = []
                        for (const sim of similar) {
                            for (const top of sim.profile.topItems) {
                                if (householdWatched.has(top.itemId)) continue
                                if (seen.has(top.itemId)) continue
                                seen.add(top.itemId)
                                const meta = itemMetaById.get(top.itemId)
                                items.push({
                                    id: makeCanonicalId(top.itemId),
                                    title: top.title,
                                    type: top.type === 'movie' ? 'movie' : (top.type === 'anime' ? 'anime' : 'series'),
                                    poster: meta?.poster,
                                    genres: top.genres,
                                    score: top.engagement * sim.similarity,
                                    source: 'similar-accounts',
                                    reason: 'Accounts Like Yours Also Watched',
                                })
                            }
                        }
                        if (items.length > 0) {
                            similarRails.push({
                                title: 'Accounts Like Yours Also Watched',
                                source: 'similar-accounts',
                                items: items.slice(0, RAIL_MAX),
                            })
                        }
                    }
                }

                const allRails = [...result.rails, ...themedRails, ...similarRails]
                setRecsResult({ ...result, rails: allRails })

                const now = Date.now()
                if (now - lastPublishedRef.current > PUBLISH_THROTTLE_MS && allRails.length > 0) {
                    lastPublishedRef.current = now
                    const itemsByCatalogType = new Map<string, Map<string, { id: string; type: string; name: string; poster?: string; score: number; reason: string }>>()
                    for (const rail of allRails) {
                        const catalogType = railTitleToCatalogType(rail.title)
                        if (!catalogType) continue
                        for (const item of rail.items) {
                            const id = itemIdFromCanonical(item.id)
                            const isAnime = item.type === 'anime' || (item.genres?.some(g => g === 'Animation' || g === 'Anime'))
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
                    if (householdRail.length > 0) {
                        let hhMap = itemsByCatalogType.get('popular_household')
                        if (!hhMap) {
                            hhMap = new Map()
                            itemsByCatalogType.set('popular_household', hhMap)
                        }
                        for (const row of householdRail) {
                            if (!hhMap.has(row.itemId)) {
                                hhMap.set(row.itemId, {
                                    id: row.itemId,
                                    type: row.type === 'movie' ? 'movie' : 'series',
                                    name: row.title,
                                    poster: row.poster,
                                    score: row.watchers,
                                    reason: 'Popular Across Your Accounts',
                                })
                            }
                        }
                    }
                    const railsToPublish = Array.from(itemsByCatalogType.entries()).map(([catalogType, itemMap]) => ({
                        catalogType,
                        scope: 'household' as const,
                        items: Array.from(itemMap.values()),
                    }))
                    const allRailsToPublish: PublishRail[] = [...railsToPublish]

                    for (const account of accounts) {
                        try {
                            const accountItems = itemsByAccount.get(account.id) ?? []
                            if (accountItems.length < 3) continue
                            const accountWatched = new Set<string>()
                            for (const it of accountItems) accountWatched.add(it.itemId)
                            const accountProfile = profiles.get(account.id)
                            const genreWeights = accountProfile?.genres ?? {}
                            const accByCatalogType = new Map<string, Map<string, { id: string; type: string; name: string; poster?: string; score: number; reason: string }>>()
                            for (const rail of allRails) {
                                const catalogType = railTitleToCatalogType(rail.title)
                                if (!catalogType) continue
                                let itemMap = accByCatalogType.get(catalogType)
                                if (!itemMap) {
                                    itemMap = new Map()
                                    accByCatalogType.set(catalogType, itemMap)
                                }
                                for (const item of rail.items) {
                                    const id = itemIdFromCanonical(item.id)
                                    if (accountWatched.has(id)) continue
                                    if (itemMap.has(id)) continue
                                    let score = item.score
                                    if (item.genres && item.genres.length > 0) {
                                        let boost = 1
                                        for (const g of item.genres.slice(0, 3)) {
                                            const w = genreWeights[g]?.weight
                                            if (typeof w === 'number' && w > 0) boost += w
                                        }
                                        score = item.score * boost
                                    }
                                    itemMap.set(id, {
                                        id,
                                        type: item.type === 'series' || item.type === 'anime' ? 'series' : 'movie',
                                        name: item.title,
                                        poster: item.poster,
                                        score,
                                        reason: rail.title,
                                    })
                                }
                            }
                            if (householdRail.length > 0) {
                                let hhMap = accByCatalogType.get('popular_household')
                                if (!hhMap) {
                                    hhMap = new Map()
                                    accByCatalogType.set('popular_household', hhMap)
                                }
                                for (const row of householdRail) {
                                    if (accountWatched.has(row.itemId)) continue
                                    if (hhMap.has(row.itemId)) continue
                                    hhMap.set(row.itemId, {
                                        id: row.itemId,
                                        type: row.type === 'movie' ? 'movie' : 'series',
                                        name: row.title,
                                        poster: row.poster,
                                        score: row.watchers,
                                        reason: 'Popular Across Your Accounts',
                                    })
                                }
                            }
                            const accountRails = Array.from(accByCatalogType.entries()).map(([catalogType, itemMap]) => ({
                                catalogType,
                                scope: 'account' as const,
                                accountId: account.id,
                                items: Array.from(itemMap.values()).sort((a, b) => b.score - a.score).slice(0, RAIL_MAX),
                            })).filter(r => r.items.length > 0)
                            if (accountRails.length > 0) {
                                allRailsToPublish.push(...accountRails)
                            }
                        } catch {}
                    }
                    if (allRailsToPublish.length > 0) {
                        publishRecommendations(allRailsToPublish).catch(() => {})
                    }
                }
            })
            .catch(err => {
                if (ac.signal.aborted || err?.name === 'AbortError') return
                setRecsError(err instanceof Error ? err.message : 'Failed to load recommendations')
            })
            .finally(() => {
                if (!ac.signal.aborted) {
                    performance.mark('foryou:recommend:end')
                    performance.measure('foryou:recommend', 'foryou:recommend:start', 'foryou:recommend:end')
                    setRecsLoading(false)
                }
            })
        return () => ac.abort()
    }, [seeds, reloadKey, filterKey, RAIL_MAX])

    const itemMetaById = useMemo(() => {
        const m = new Map<string, { title: string; poster?: string; type?: string; genres?: string[] }>()
        for (const item of allItems) {
            const existing = m.get(item.itemId)
            if (!existing) {
                m.set(item.itemId, {
                    title: item.name,
                    poster: item.poster || undefined,
                    type: item.type,
                    genres: item.genres,
                })
            } else {
                if (!existing.poster && item.poster) existing.poster = item.poster
                if ((!existing.genres || existing.genres.length === 0) && item.genres && item.genres.length > 0) {
                    existing.genres = item.genres
                }
            }
        }
        return m
    }, [allItems])

    const householdRail = useMemo(() => {
        if (profiles.size === 0) return []
        const rows = computeHouseholdPopularity(Array.from(profiles.values()), allItems)
        return rows.slice(0, HOUSEHOLD_RAIL_MAX).map(row => {
            const meta = itemMetaById.get(row.itemId)
            return {
                itemId: row.itemId,
                title: meta?.title || row.title,
                poster: meta?.poster,
                type: meta?.type,
                genres: meta?.genres,
                watchers: row.watchers,
            }
        })
    }, [profiles, allItems, itemMetaById])

    const accountStats = useMemo(() => {
        const out: Array<{ account: Account; itemCount: number; topGenres: string[] }> = []
        for (const account of accounts) {
            const items = itemsByAccount.get(account.id) ?? []
            if (items.length === 0) continue
            const profile = profiles.get(account.id)
            const topGenres = profile
                ? Object.entries(profile.genres)
                    .sort((a, b) => b[1].weight - a[1].weight)
                    .slice(0, 3)
                    .map(([g]) => g)
                : []
            out.push({ account, itemCount: items.length, topGenres })
        }
        return out
    }, [accounts, itemsByAccount, profiles])

    const handleReload = useCallback(() => setReloadKey(k => k + 1), [])

    const [urlOpen, setUrlOpen] = useState(false)
    const [searchOpen, setSearchOpen] = useState(false)
    const [copied, setCopied] = useState(false)
    const [detailItem, setDetailItem] = useState<DetailItem | null>(null)
    const [allCatalogUrls, setAllCatalogUrls] = useState<{ household: string; accounts: Array<{ accountId: string; accountName?: string; url: string }> } | null>(null)

    const handleGetInstallUrl = useCallback(async () => {
        const data = await getAllCatalogUrls()
        if (data) {
            setAllCatalogUrls(data)
            setUrlOpen(true)
        } else {
            const url = await getHouseholdCatalogUrl()
            if (url) {
                setAllCatalogUrls({ household: url, accounts: [] })
                setUrlOpen(true)
            } else {
                toast({ variant: 'destructive', title: 'Could not get catalog URLs' })
            }
        }
    }, [])

    const handleCopyUrl = useCallback((url: string) => {
        navigator.clipboard.writeText(url).catch(() => {})
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }, [])

    const hasHistory = allItems.length > 0
    const showInitialSkeleton = historyLoading
    const showBuildingSkeleton = !historyLoading && recsLoading && recsResult === null
    const showError = recsError !== null && recsResult === null && !recsLoading
    const showRails = recsResult !== null

    // ── Surprise Me ────────────────────────────────────────────────────────
    const [surpriseSpinning, setSurpriseSpinning] = useState(false)
    const surpriseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => () => { if (surpriseTimerRef.current) clearTimeout(surpriseTimerRef.current) }, [])
    const handleSurpriseMe = useCallback(() => {
        const pool = recsResult?.rails
            .flatMap(r => r.items)
            .filter(item => !discoveryPrefs.dismissedItems.includes(itemIdFromCanonical(item.id)))
            ?? []
        if (pool.length === 0) return
        setSurpriseSpinning(true)
        if (surpriseTimerRef.current) clearTimeout(surpriseTimerRef.current)
        surpriseTimerRef.current = setTimeout(() => {
            setSurpriseSpinning(false)
            const pick = pool[Math.floor(Math.random() * pool.length)]
            const id = itemIdFromCanonical(pick.id)
            setDetailItem({
                itemId: id,
                type: pick.type === 'series' || pick.type === 'anime' ? 'series' : pick.type,
                name: pick.title,
                poster: pick.poster,
                genres: pick.genres,
                year: pick.year,
                voteAverage: pick.voteAverage,
                backdrop: pick.backdrop,
            })
        }, 700)
    }, [recsResult, discoveryPrefs.dismissedItems])

    // ── Hero item: first item of highest-confidence rail ───────────────────
    const heroItems = useMemo((): HeroItem[] => {
        if (!recsResult || recsResult.rails.length === 0) return []
        const seen = new Set<string>()
        const items: HeroItem[] = []
        for (const rail of recsResult.rails) {
            if (items.length >= 5) break
            const item = rail.items[0]
            if (!item) continue
            const id = itemIdFromCanonical(item.id)
            if (seen.has(id)) continue
            seen.add(id)
            const maxScore = Math.max(...rail.items.map(i => i.score), 0.001)
            items.push({
                title: item.title,
                backdrop: item.backdrop,
                poster: item.poster,
                year: item.year,
                genres: item.genres,
                voteAverage: item.voteAverage,
                itemId: id,
                type: item.type,
                confidence: item.score / maxScore,
            })
        }
        return items
    }, [recsResult])

    const heroItem = heroItems[heroIndex] ?? heroItems[0] ?? null

    useEffect(() => {
        if (heroPaused || heroItems.length <= 1) return
        const timer = setTimeout(() => {
            setHeroIndex(i => (i + 1) % heroItems.length)
        }, 8000)
        return () => clearTimeout(timer)
    }, [heroIndex, heroPaused, heroItems.length])

    useEffect(() => {
        if (heroIndex >= heroItems.length) setHeroIndex(0)
    }, [heroItems.length, heroIndex])

    return (
        <div className="space-y-4 sm:space-y-6 overflow-x-hidden">
            <Tabs value={subTab} onValueChange={v => setSubTab(v as 'unified' | 'accounts')}>
                <TabsList>
                    <TabsTrigger value="unified">Discover</TabsTrigger>
                    <TabsTrigger value="accounts">Accounts</TabsTrigger>
                </TabsList>
            </Tabs>

            <ToolbarShell contentClassName="gap-3">
                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleReload}
                        disabled={recsLoading || historyLoading}
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
                        Preferences
                    </Button>
                    {hasHistory && (
                            <Button
                                variant="subtle"
                                size="sm"
                                onClick={handleGetInstallUrl}
                                className="h-8 gap-1.5 text-xs font-medium"
                            >
                                Catalog URLs
                            </Button>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSearchOpen(true)}
                        className="h-8 gap-1.5 text-xs font-medium"
                    >
                        <Search className="h-3.5 w-3.5" />
                        Search
                    </Button>
                </div>
            </ToolbarShell>

            {showBuildingSkeleton && (
                <div className="rounded-2xl border border-border/40 bg-card shadow-sm p-4 space-y-3">
                    <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 shrink-0">
                            <Sparkles className="h-4 w-4 text-primary animate-pulse" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold">
                                Building Your Recommendations
                            </div>
                            <div className="text-xs text-muted-foreground">
                                Analyzing watch history and taste profile
                            </div>
                        </div>
                    </div>
                    <Progress shimmer className="h-1.5 bg-muted" />
                </div>
            )}

            {subTab === 'accounts' ? (
                <div className="space-y-4 pt-2">
                    <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {accountStats.map(({ account, topGenres }) => (
                            <div
                                key={account.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => onAccountClick?.(account.id)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAccountClick?.(account.id) } }}
                                className="group relative flex h-full cursor-pointer flex-col rounded-[1.35rem] border border-border/45 bg-card/80 shadow-sm transition-[background-color,border-color,box-shadow,transform,opacity] duration-200 hover:-translate-y-0.5 hover:border-border/70 hover:bg-card/95 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                            >
                                <div className="flex items-center justify-between px-4 pb-3 pt-4">
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                        <AccountAvatar account={account} size="lg" />
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-bold text-foreground">
                                                {maskNameLevel(account.name || account.email?.split('@')[0] || 'Account', namePrivacy)}
                                            </p>
                                        </div>
                                    </div>
                                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
                                </div>

                                {topGenres.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 px-3 sm:px-4 pb-3">
                                        {topGenres.map(genre => (
                                            <span key={genre} className="rounded-md border border-border/40 bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                                {genre}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <>
            <div
                className="relative"
                onMouseEnter={() => setHeroPaused(true)}
                onMouseLeave={() => setHeroPaused(false)}
            >
            <ForYouHero
                item={heroItem}
                loading={showInitialSkeleton || showBuildingSkeleton}
                onMoreInfo={heroItem ? () => setDetailItem({
                    itemId: heroItem.itemId!,
                    type: heroItem.type!,
                    name: heroItem.title,
                    poster: heroItem.poster,
                    genres: heroItem.genres,
                    year: heroItem.year,
                    voteAverage: heroItem.voteAverage,
                    backdrop: heroItem.backdrop,
                }) : undefined}
                onSurpriseMe={recsResult && recsResult.rails.length > 0 ? handleSurpriseMe : undefined}
                surpriseSpinning={surpriseSpinning}
            />

            {heroItems.length > 1 && !showInitialSkeleton && !showBuildingSkeleton && (
                <>
                    <button
                        type="button"
                        onClick={() => setHeroIndex(i => (i - 1 + heroItems.length) % heroItems.length)}
                        className="absolute left-3 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/70 hover:scale-105"
                        aria-label="Previous"
                    >
                        <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                        type="button"
                        onClick={() => setHeroIndex(i => (i + 1) % heroItems.length)}
                        className="absolute right-3 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/70 hover:scale-105"
                        aria-label="Next"
                    >
                        <ChevronRight className="h-5 w-5" />
                    </button>
                    <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-1.5">
                        {heroItems.map((_, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={() => setHeroIndex(i)}
                                className={cn(
                                    'h-1.5 rounded-full transition-all',
                                    i === heroIndex ? 'w-6 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/60'
                                )}
                                aria-label={`Go to slide ${i + 1}`}
                            />
                        ))}
                    </div>
                </>
            )}
            </div>

            {watchlistItems.length > 0 && enabledCatalogIds.has('watchlist') && (
                <ContentRail
                    title="Group Watchlist"
                    icon={<Bookmark className="h-4 w-4" />}
                >
                    {watchlistItems.map((item, i) => (
                        <ContentRailCard
                            key={`wl-${item.itemId}`}
                            title={item.name || 'Unknown'}
                            poster={item.poster}
                            itemId={item.itemId}
                            itemType={item.type === 'movie' ? 'movie' : 'series'}
                            watchers={watchersByItemId.get(item.itemId || '') || undefined}
                            index={i}
                            onClick={() => setDetailItem({
                                itemId: item.itemId,
                                type: item.type === 'movie' ? 'movie' : 'series',
                                name: item.name || 'Unknown',
                                poster: item.poster,
                            })}
                        />
                    ))}
                </ContentRail>
            )}

            {(showInitialSkeleton || showBuildingSkeleton) && (
                <div className="space-y-8">
                    <ContentRailSkeleton />
                    <ContentRailSkeleton />
                    <ContentRailSkeleton />
                </div>
            )}

            {showError && (
                <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
                            <div className="flex items-start gap-3">
                                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                                <div className="flex-1">
                                    <p className="font-medium text-destructive">Recommendations failed to load</p>
                                    <p className="mt-0.5 text-sm text-muted-foreground">{recsError}</p>
                                </div>
                                <Button variant="outline" size="sm" onClick={handleReload}>Retry</Button>
                            </div>
                        </div>
                    )}

                    {showRails && (
                        <div className="space-y-8">
                            {(() => {
                                const surfaced = new Set<string>()
                                return (
                                    <>
                                        {householdRail.length > 0 && enabledCatalogIds.has('popular_household') && (
                                            <ContentRail
                                                title="Popular Across Your Accounts"
                                                subtitle="Most-loved titles across your household"
                                                icon={<Users className="h-4 w-4" />}
                                            >
                                                {householdRail.map((row, i) => {
                                                    surfaced.add(row.itemId)
                                                    return (
                                                        <ContentRailCard
                                                            key={`hh-${row.itemId}`}
                                                            title={row.title}
                                                            poster={row.poster}
                                                            itemId={row.itemId}
                                                            itemType={row.type}
                                                            subtitle={row.genres?.[0]}
                                                            watchers={watchersByItemId.get(row.itemId || '') || undefined}
                                                            index={i}
                                                            onClick={() => setDetailItem({
                                                                itemId: row.itemId,
                                                                type: row.type || 'movie',
                                                                name: row.title,
                                                                poster: row.poster,
                                                                genres: row.genres,
                                                            })}
                                                        />
                                                    )
                                                })}
                                            </ContentRail>
                                        )}

                                        {recsResult?.rails.filter(rail => {
                                            const cid = railCatalogId(rail.title)
                                            return cid === null || enabledCatalogIds.has(cid)
                                        }).map((rail, railIdx) => {
                                            const dedupedItems = rail.items.filter(item => {
                                                const key = itemIdFromCanonical(item.id)
                                                if (surfaced.has(key)) return false
                                                surfaced.add(key)
                                                return true
                                            })
                                            if (dedupedItems.length === 0) return null
                                            return (
                                                <ContentRail
                                                    key={`rec-${railIdx}-${rail.title}`}
                                                    title={rail.title}
                                                    icon={recommendationIcon(rail.title)}
                                                >
                                                    {dedupedItems.map((item, i) => (
                                                        <ContentRailCard
                                                            key={`${railIdx}-${rail.title}-${item.id.slug}-${i}`}
                                                            title={item.title}
                                                            poster={item.poster}
                                                            itemId={itemIdFromCanonical(item.id)}
                                                            itemType={item.type === 'series' || item.type === 'anime' ? 'series' : item.type}
                                                            subtitle={[item.year, item.genres?.[0]].filter(Boolean).join(' · ')}
                                                            watchers={watchersByItemId.get(itemIdFromCanonical(item.id)) || undefined}
                                                            index={i}
                                                            onClick={() => {
                                                                const id = itemIdFromCanonical(item.id)
                                                                setDetailItem({
                                                                    itemId: id,
                                                                    type: item.type === 'series' || item.type === 'anime' ? 'series' : item.type,
                                                                    name: item.title,
                                                                    poster: item.poster,
                                                                    genres: item.genres,
                                                                    year: item.year,
                                                                    voteAverage: item.voteAverage,
                                                                    backdrop: item.backdrop,
                                                                })
                                                            }}
                                                        />
                                                    ))}
                                                </ContentRail>
                                            )
                                        })}

                                        {recsResult !== null && recsResult.rails.length === 0 && householdRail.length === 0 && (
                                            <div className="rounded-2xl border border-border/40 bg-card/50 p-8 text-center">
                                                <Sparkles className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                                                <p className="font-medium">No recommendations yet</p>
                                                <p className="mt-1 text-sm text-muted-foreground">
                                                    Keep watching across your accounts and check back.
                                                </p>
                                            </div>
                                        )}
                                    </>
                                )
                            })()}
                        </div>
                    )}
                </>
            )}

            <DiscoveryPreferencesModal open={catalogOpen} onOpenChange={setCatalogOpen} />

            <Dialog open={urlOpen} onOpenChange={setUrlOpen}>
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Catalog Addon URLs</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                        <p className="text-sm text-muted-foreground">
                            Add these in AIOMetadata, AIOStreams, Stremio, Nuvio, or any compatible addon manager.
                        </p>
                        {allCatalogUrls && (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                                    <span className="text-xs font-semibold text-primary shrink-0">All Accounts</span>
                                    <code className="min-w-0 flex-1 break-all text-xs text-muted-foreground">{allCatalogUrls.household}</code>
                                    <Button variant="ghost" size="sm" onClick={() => handleCopyUrl(allCatalogUrls.household)} className="h-7 shrink-0">
                                        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                                    </Button>
                                </div>
                                {allCatalogUrls.accounts.filter((acc, i, arr) => acc.url !== allCatalogUrls.household && arr.findIndex(a => a.url === acc.url) === i).map((acc) => (
                                    <div key={acc.accountId} className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                                        <span className="text-xs font-medium text-muted-foreground shrink-0 truncate max-w-[100px]">{acc.accountName || acc.accountId}</span>
                                        <code className="min-w-0 flex-1 break-all text-xs text-muted-foreground">{acc.url}</code>
                                        <Button variant="ghost" size="sm" onClick={() => handleCopyUrl(acc.url)} className="h-7 shrink-0">
                                            <Copy className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            <SearchDialog
                open={searchOpen}
                onOpenChange={setSearchOpen}
                onResultClick={(result) => {
                    setDetailItem({
                        itemId: result.id,
                        type: result.type,
                        name: result.name,
                        poster: result.poster,
                        backdrop: result.backdrop,
                        year: result.year ? parseInt(result.year, 10) : undefined,
                        voteAverage: result.voteAverage,
                    })
                }}
            />

            <ActivityDetailModal
                open={detailItem !== null}
                onOpenChange={(open) => { if (!open) { setDetailItem(null); refreshWatchlist() } }}
                item={detailItem}
            />
        </div>
    )
}
