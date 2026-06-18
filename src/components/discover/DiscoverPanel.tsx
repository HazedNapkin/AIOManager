import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircle, ArrowLeft, Clock, Flame, Heart, LayoutGrid, Loader2, RefreshCw, Search, Sparkles } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { useAddonStore } from '@/store/addonStore'
import { useAccountStore } from '@/store/accountStore'
import { useProfileStore } from '@/store/profileStore'
import { cn, normalizeAddonUrl } from '@/lib/utils'
import { mapConcurrent } from '@/lib/concurrency'
import {
  fetchDiscoverAddons,
  fetchDiscoverCategories,
  getAddonResources,
  getConfigureUrl,
  type DiscoverAddon,
  type DiscoverCategory,
  type DiscoverSortBy,
} from '@/api/discover'
import { StaggerContainer, StaggerItem } from '@/components/ui/stagger'
import { motion } from 'framer-motion'
import { DiscoverToolbar } from './DiscoverToolbar'
import { DiscoverCard } from './DiscoverCard'
import { DiscoverHero } from './DiscoverHero'
import { DiscoverRow } from './DiscoverRow'
import { DiscoverDeck } from './DiscoverDeck'
import { DiscoverDetailModal } from './DiscoverDetailModal'
import { DiscoverSaveDialog, type DiscoverSavePayload } from './DiscoverSaveDialog'
import { AccountPickerDialog } from '@/components/accounts/AccountPickerDialog'

const PAGE_SIZE = 36
const SHELF_SIZE = 18
// Trending feeds both the hero (up to 10) and the row, so pull a deeper pool.
const TRENDING_SIZE = 30

// Favorites are bookmarked addons the user wants to revisit without installing. The full
// DiscoverAddon is persisted (not just the id) so the shelf renders offline without refetching.
const FAVORITES_KEY = 'aio-discover-favorites'
const PREFS_KEY = 'aio-discover-prefs'
const LAST_VISIT_KEY = 'aio-discover-last-visit'

type DiscoverViewMode = 'store' | 'deck'

interface DiscoverPrefs {
  sortBy?: DiscoverSortBy
  showAdult?: boolean
  selectedCategories?: string[]
  compact?: boolean
  viewMode?: DiscoverViewMode
}

function shuffle<T>(input: T[]): T[] {
  const arr = [...input]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function loadFavorites(): DiscoverAddon[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveFavorites(list: DiscoverAddon[]) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list))
  } catch {
    // Best-effort: a full localStorage quota shouldn't break the page.
  }
}

function loadPrefs(): DiscoverPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function savePrefs(prefs: DiscoverPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // best-effort; ignore quota errors
  }
}

function normalizeCategoryKey(s: string): string {
  return s.toLowerCase().replace(/s$/, '')
}

export function DiscoverPanel({ replayKey = 0 }: { replayKey?: number }) {
  const { toast } = useToast()
  const library = useAddonStore((state) => state.library)
  const createSavedAddon = useAddonStore((state) => state.createSavedAddon)
  const createProfile = useProfileStore((state) => state.createProfile)
  const accounts = useAccountStore((state) => state.accounts)

  const initialPrefs = useMemo(() => loadPrefs(), [])

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortBy, setSortBy] = useState<DiscoverSortBy>(initialPrefs.sortBy === 'createdAt' ? 'createdAt' : 'stars')
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    Array.isArray(initialPrefs.selectedCategories) ? initialPrefs.selectedCategories : []
  )
  const [selectedResources, setSelectedResources] = useState<string[]>([])
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [showAdult, setShowAdult] = useState<boolean>(!!initialPrefs.showAdult)
  const [forceGrid, setForceGrid] = useState(false)
  const [compact, setCompact] = useState<boolean>(!!initialPrefs.compact)
  const [favorites, setFavorites] = useState<DiscoverAddon[]>(() => loadFavorites())

  const [viewMode, setViewMode] = useState<DiscoverViewMode>(initialPrefs.viewMode === 'deck' ? 'deck' : 'store')
  const [deckPool, setDeckPool] = useState<DiscoverAddon[]>([])
  const [deckLoading, setDeckLoading] = useState(false)
  const [deckKey, setDeckKey] = useState(0)

  const initialLastVisit = useMemo(() => {
    const raw = Number(localStorage.getItem(LAST_VISIT_KEY))
    return Number.isFinite(raw) && raw > 0 ? raw : null
  }, [])

  const [trending, setTrending] = useState<DiscoverAddon[]>([])
  const [newest, setNewest] = useState<DiscoverAddon[]>([])
  const [storeLoading, setStoreLoading] = useState(true)
  const [storeError, setStoreError] = useState(false)
  const [storeReloadKey, setStoreReloadKey] = useState(0)
  const [categories, setCategories] = useState<DiscoverCategory[]>([])
  const [categoryShelves, setCategoryShelves] = useState<{ category: DiscoverCategory; addons: DiscoverAddon[] }[]>([])
  const [userCategoryShelves, setUserCategoryShelves] = useState<{ category: DiscoverCategory; addons: DiscoverAddon[] }[]>([])

  const [addons, setAddons] = useState<DiscoverAddon[]>([])
  const [page, setPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [detailAddon, setDetailAddon] = useState<DiscoverAddon | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [saveAddon, setSaveAddon] = useState<DiscoverAddon | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [deployAddon, setDeployAddon] = useState<DiscoverAddon | null>(null)
  const [deployOpen, setDeployOpen] = useState(false)

  const requestRef = useRef(0)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)

  const [reducedMotion, setReducedMotion] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mq.matches)
    const handler = () => setReducedMotion(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const isFiltering = debouncedSearch.trim() !== '' || selectedCategories.length > 0 || selectedResources.length > 0 || selectedTypes.length > 0
  const gridMode = isFiltering || forceGrid

  const isFavorite = useCallback((addon: DiscoverAddon) => favorites.some((f) => f.uuid === addon.uuid), [favorites])
  const toggleFavorite = useCallback((addon: DiscoverAddon) => {
    setFavorites((prev) => {
      const exists = prev.some((f) => f.uuid === addon.uuid)
      const next = exists ? prev.filter((f) => f.uuid !== addon.uuid) : [addon, ...prev]
      saveFavorites(next)
      return next
    })
  }, [])

  const handleSearchChange = (val: string) => {
    setSearch(val)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => setDebouncedSearch(val), 300)
  }

  const categoryKey = selectedCategories.join(',')

  const userCategories = useMemo<DiscoverCategory[]>(() => {
    if (categories.length === 0) return []
    const counts = new Map<string, number>()
    const libraryList = Object.values(library)
    for (const category of categories) {
      const key = normalizeCategoryKey(category.slug)
      let n = 0
      for (const addon of libraryList) {
        const types = Array.isArray(addon.manifest?.types) ? addon.manifest.types : []
        if (types.some((t) => typeof t === 'string' && normalizeCategoryKey(t) === key)) n++
      }
      if (n > 0) counts.set(category.slug, n)
    }
    return categories
      .filter((c) => counts.has(c.slug))
      .sort((a, b) => (counts.get(b.slug) ?? 0) - (counts.get(a.slug) ?? 0))
      .slice(0, 3)
  }, [library, categories])

  const userCategorySlugs = useMemo(() => new Set(userCategories.map((c) => c.slug)), [userCategories])
  const userCategoryKey = userCategories.map((c) => c.slug).join(',')

  useEffect(() => {
    savePrefs({ sortBy, showAdult, selectedCategories, compact, viewMode })
  }, [sortBy, showAdult, selectedCategories, compact, viewMode])

  useEffect(() => {
    return () => { try { localStorage.setItem(LAST_VISIT_KEY, String(Date.now())) } catch { /* quota */ } }
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    fetchDiscoverCategories(ac.signal).then(setCategories).catch(() => {})
    return () => ac.abort()
  }, [storeReloadKey])

  useEffect(() => {
    if (categories.length === 0) return
    const ac = new AbortController()
    const nsfw = showAdult ? undefined : 'exclude'
    const picks = categories.filter((c) => !userCategorySlugs.has(c.slug)).slice(0, 6)
    Promise.all(
      picks.map((category) =>
        fetchDiscoverAddons({ category: [category.slug], sortBy: 'stars', order: 'desc', nsfw, limit: SHELF_SIZE }, ac.signal)
          .then((res) => ({ category, addons: res.addons }))
          .catch(() => ({ category, addons: [] as DiscoverAddon[] }))
      )
    ).then((shelves) => {
      if (!ac.signal.aborted) setCategoryShelves(shelves.filter((s) => s.addons.length >= 4))
    })
    return () => ac.abort()
  }, [categories, showAdult, userCategorySlugs])

  useEffect(() => {
    if (userCategories.length === 0) { setUserCategoryShelves([]); return }
    const ac = new AbortController()
    const nsfw = showAdult ? undefined : 'exclude'
    const picks = userCategories
    Promise.all(
      picks.map((category) =>
        fetchDiscoverAddons({ category: [category.slug], sortBy: 'stars', order: 'desc', nsfw, limit: SHELF_SIZE }, ac.signal)
          .then((res) => ({ category, addons: res.addons }))
          .catch(() => ({ category, addons: [] as DiscoverAddon[] }))
      )
    ).then((shelves) => {
      if (!ac.signal.aborted) setUserCategoryShelves(shelves.filter((s) => s.addons.length >= 4))
    })
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCategoryKey, showAdult])

  useEffect(() => {
    const ac = new AbortController()
    setStoreLoading(true)
    setStoreError(false)
    const nsfw = showAdult ? undefined : 'exclude'
    Promise.all([
      fetchDiscoverAddons({ sortBy: 'stars', order: 'desc', nsfw, limit: TRENDING_SIZE }, ac.signal),
      fetchDiscoverAddons({ sortBy: 'createdAt', order: 'desc', nsfw, limit: SHELF_SIZE }, ac.signal),
    ])
      .then(([top, fresh]) => {
        if (ac.signal.aborted) return
        setTrending(top.addons)
        setNewest(fresh.addons)
      })
      .catch(() => { if (!ac.signal.aborted) { setTrending([]); setNewest([]); setStoreError(true) } })
      .finally(() => { if (!ac.signal.aborted) setStoreLoading(false) })
    return () => ac.abort()
  }, [showAdult, storeReloadKey])

  const runQuery = useCallback(
    async (targetPage: number, signal?: AbortSignal) => {
      const token = ++requestRef.current
      if (targetPage === 1) setLoading(true)
      else setLoadingMore(true)
      setError(null)
      try {
        const res = await fetchDiscoverAddons({
          search: debouncedSearch,
          sortBy,
          order: 'desc',
          category: selectedCategories,
          nsfw: showAdult ? undefined : 'exclude',
          page: targetPage,
          limit: PAGE_SIZE,
        }, signal)
        if (token !== requestRef.current) return
        setAddons((prev) => (targetPage === 1 ? res.addons : [...prev, ...res.addons]))
        setHasNextPage(res.pagination?.hasNextPage ?? false)
        setPage(targetPage)
      } catch (err) {
        if (token !== requestRef.current) return
        setError(err instanceof Error ? err.message : 'Failed to load addons')
        if (targetPage === 1) setAddons([])
      } finally {
        if (token === requestRef.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [debouncedSearch, sortBy, selectedCategories, showAdult]
  )

  useEffect(() => {
    if (!gridMode) return
    const ac = new AbortController()
    runQuery(1, ac.signal)
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridMode, debouncedSearch, sortBy, categoryKey, showAdult])

  // Infinite scroll: auto-load the next page when the sentinel nears the viewport. The visible
  // "Load more" button remains as a manual fallback.
  useEffect(() => {
    const el = loadMoreRef.current
    if (!el || !hasNextPage || loading || loadingMore) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) runQuery(page + 1) },
      { rootMargin: '400px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [gridMode, hasNextPage, loading, loadingMore, page, runQuery])

  const savedIndex = useMemo(() => {
    const ids = new Set<string>()
    const urls = new Set<string>()
    for (const addon of Object.values(library)) {
      if (addon.manifest?.id) ids.add(addon.manifest.id)
      if (addon.installUrl) urls.add(normalizeAddonUrl(addon.installUrl))
    }
    return { ids, urls }
  }, [library])

  const isSaved = useCallback(
    (addon: DiscoverAddon) => {
      if (addon.manifest?.id && savedIndex.ids.has(addon.manifest.id)) return true
      return savedIndex.urls.has(normalizeAddonUrl(addon.manifestUrl))
    },
    [savedIndex]
  )

  const deploymentIndex = useMemo(
    () =>
      accounts.map((acc) => {
        const ids = new Set<string>()
        const urls = new Set<string>()
        for (const a of acc.addons || []) {
          if (a?.flags?.enabled === false) continue
          if (a.manifest?.id) ids.add(a.manifest.id)
          if (a.transportUrl) urls.add(normalizeAddonUrl(a.transportUrl))
        }
        return { ids, urls }
      }),
    [accounts]
  )

  const deployedCount = useCallback(
    (addon: DiscoverAddon) => {
      const id = addon.manifest?.id
      const url = normalizeAddonUrl(addon.manifestUrl)
      let n = 0
      for (const acc of deploymentIndex) {
        if ((id && acc.ids.has(id)) || acc.urls.has(url)) n++
      }
      return n
    },
    [deploymentIndex]
  )
  const accountTotal = accounts.length

  const isSavedRef = useRef(isSaved)
  isSavedRef.current = isSaved
  const isFavoriteRef = useRef(isFavorite)
  isFavoriteRef.current = isFavorite

  useEffect(() => {
    if (viewMode !== 'deck') return
    const ac = new AbortController()
    setDeckLoading(true)
    const nsfw = showAdult ? undefined : 'exclude'
    const catPicks = categories.length ? shuffle(categories).slice(0, 3) : []
    Promise.all([
      fetchDiscoverAddons({ sortBy: 'stars', order: 'desc', nsfw, page: 2, limit: 40 }, ac.signal).catch(() => null),
      fetchDiscoverAddons({ sortBy: 'createdAt', order: 'desc', nsfw, limit: 30 }, ac.signal).catch(() => null),
      ...catPicks.map((c) =>
        fetchDiscoverAddons({ category: [c.slug], sortBy: 'stars', order: 'desc', nsfw, page: 2, limit: 20 }, ac.signal).catch(() => null)
      ),
    ])
      .then((results) => {
        if (ac.signal.aborted) return
        const seen = new Set<string>()
        const merged: DiscoverAddon[] = []
        for (const res of results) {
          for (const addon of res?.addons ?? []) {
            if (seen.has(addon.uuid)) continue
            if (isSavedRef.current(addon) || isFavoriteRef.current(addon)) continue
            seen.add(addon.uuid)
            merged.push(addon)
          }
        }
        setDeckPool(shuffle(merged))
      })
      .finally(() => { if (!ac.signal.aborted) setDeckLoading(false) })
    return () => ac.abort()
  }, [viewMode, deckKey, categories, showAdult])

  const newSinceVisit = useMemo(() => {
    if (!initialLastVisit) return []
    return newest.filter((a) => {
      const t = new Date(a.createdAt).getTime()
      return Number.isFinite(t) && t > initialLastVisit
    })
  }, [newest, initialLastVisit])

  const featuredList = useMemo(() => {
    const isTorrentio = (a: DiscoverAddon) => a.slug === 'torrentio' || a.manifest?.id === 'com.stremio.torrentio.addon'
    const eligible = trending.filter((a) => !isTorrentio(a))
    const withBg = eligible.filter((a) => a.manifest?.background)
    const pool = withBg.length >= 3 ? withBg : eligible
    return pool.slice(0, 10)
  }, [trending])
  const featuredIds = useMemo(() => new Set(featuredList.map((a) => a.uuid)), [featuredList])
  const trendingRow = useMemo(
    () => trending.filter((a) => !featuredIds.has(a.uuid)),
    [trending, featuredIds]
  )
  const trendingThisWeek = useMemo(() => trendingRow.slice(0, 12), [trendingRow])
  const recentlyUpdated = useMemo(
    () =>
      [...trending]
        .filter((a) => a.updatedAt && Number.isFinite(new Date(a.updatedAt).getTime()))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, SHELF_SIZE),
    [trending]
  )

  const visibleAddons = useMemo(() => {
    if (selectedResources.length === 0 && selectedTypes.length === 0) return addons
    return addons.filter((a) => {
      const res = getAddonResources(a)
      const types = Array.isArray(a.manifest?.types) ? a.manifest.types : []
      const resOk = selectedResources.length === 0 || selectedResources.some((r) => res.includes(r))
      const typeOk = selectedTypes.length === 0 || selectedTypes.some((t) => types.includes(t as string))
      return resOk && typeOk
    })
  }, [addons, selectedResources, selectedTypes])

  const openSave = (addon: DiscoverAddon) => { setSaveAddon(addon); setSaveOpen(true) }
  const openDeploy = (addon: DiscoverAddon) => { setDeployAddon(addon); setDeployOpen(true) }
  const openDetail = (addon: DiscoverAddon) => { setDetailAddon(addon); setDetailOpen(true) }

  const handleConfigure = (addon: DiscoverAddon) => {
    const url = getConfigureUrl(addon)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
    else toast({ title: 'No configuration page', description: 'This addon does not expose a configure URL.', variant: 'destructive' })
  }

  const handleSaveConfirm = async (payload: DiscoverSavePayload) => {
    if (!saveAddon) return
    setSavingKey(saveAddon.uuid)
    try {
      let profileId = payload.profileId
      if (payload.newProfileName) {
        const profile = await createProfile(payload.newProfileName)
        profileId = profile.id
      }
      await createSavedAddon(payload.name, saveAddon.manifestUrl, payload.tags, profileId, saveAddon.manifest)
      toast({ title: 'Saved to Library', description: `${payload.name} is now in your library.` })
      setSaveOpen(false)
    } catch (err) {
      toast({ title: 'Save Failed', description: err instanceof Error ? err.message : 'Could not save this addon', variant: 'destructive' })
    } finally {
      setSavingKey(null)
    }
  }

  const handleDeployConfirm = async (accountIds: string[]) => {
    if (!deployAddon || accountIds.length === 0) return
    const accountStore = useAccountStore.getState()
    let ok = 0
    let fail = 0
    await mapConcurrent(accountIds, 5, async (id) => {
      try {
        await accountStore.installAddonToAccount(id, deployAddon.manifestUrl)
        ok++
      } catch {
        fail++
      }
    })
    toast({
      title: 'Deploy Complete',
      description: `Installed to ${ok} account${ok !== 1 ? 's' : ''}.${fail > 0 ? ` Failed: ${fail}.` : ''}`,
      variant: fail > 0 && ok === 0 ? 'destructive' : 'default',
    })
    setDeployOpen(false)
  }

  const toggleCategory = (slug: string) => {
    setSelectedCategories((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]))
  }
  const toggleResource = (resource: string) => {
    setSelectedResources((prev) => (prev.includes(resource) ? prev.filter((r) => r !== resource) : [...prev, resource]))
  }
  const toggleType = (type: string) => {
    setSelectedTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))
  }
  const clearFilters = () => { setSearch(''); setDebouncedSearch(''); setSelectedCategories([]); setSelectedResources([]); setSelectedTypes([]) }

  const seeAll = (sort: DiscoverSortBy) => { setSortBy(sort); setForceGrid(true) }
  const seeAllCategory = (slug: string) => { setSelectedCategories([slug]); setSortBy('stars') }
  const backToStore = () => { setForceGrid(false); setSortBy('stars'); setSelectedResources([]); setSelectedTypes([]) }

  const cardCallbacks = {
    onSave: openSave,
    onDeploy: openDeploy,
    onConfigure: handleConfigure,
    onOpenDetail: openDetail,
    onToggleFavorite: toggleFavorite,
    deployedCount,
    accountTotal,
  }

  return (
    <div className="flex flex-col gap-5">
      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as DiscoverViewMode)}>
        <TabsList>
          <TabsTrigger value="store" className="h-8 px-4 text-xs">
            <LayoutGrid className="h-3.5 w-3.5" />
            Browse
          </TabsTrigger>
          <TabsTrigger value="deck" className="h-8 px-4 text-xs data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-500/10 data-[state=active]:to-purple-500/10 data-[state=active]:text-amber-600 dark:data-[state=active]:text-amber-400">
            {reducedMotion ? (
              <Sparkles className="h-3.5 w-3.5" />
            ) : (
              <motion.span
                animate={{ rotate: [0, 10, -10, 0] }}
                transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                className="inline-flex"
              >
                <Sparkles className="h-3.5 w-3.5" />
              </motion.span>
            )}
            Discover Deck
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {viewMode === 'deck' && (
          <DiscoverDeck
            pool={deckPool}
            loading={deckLoading}
            onReshuffle={() => setDeckKey((k) => k + 1)}
            isSaved={isSaved}
            savingKey={savingKey}
            onSave={openSave}
            onOpenDetail={openDetail}
            onDeploy={openDeploy}
            deployedCount={deployedCount}
            accountTotal={accountTotal}
          />
      )}

      {viewMode === 'store' && (
        <DiscoverToolbar
          search={search}
          onSearchChange={handleSearchChange}
          sortBy={sortBy}
          onSortByChange={(s) => { setSortBy(s); setForceGrid(true) }}
          categories={categories}
          selectedCategories={selectedCategories}
          onToggleCategory={toggleCategory}
          selectedResources={selectedResources}
          onToggleResource={toggleResource}
          selectedTypes={selectedTypes}
          onToggleType={toggleType}
          showAdult={showAdult}
          onToggleAdult={() => setShowAdult((v) => !v)}
          showSort={gridMode}
          compact={compact}
          onToggleCompact={() => setCompact((v) => !v)}
        />
      )}

      {/* Keyed so the entrance animation replays each time Discover is opened, without refetching. */}
      {viewMode === 'store' && (
      <div key={replayKey} className="flex flex-col gap-5">

      {!gridMode && (
        <>
          {newSinceVisit.length > 0 && (
            <DiscoverRow
              title="New Since Your Last Visit"
              icon={<Clock className="h-4 w-4 text-primary" />}
              addons={newSinceVisit}
              isSaved={isSaved}
              savingKey={savingKey}
              onSeeAll={() => seeAll('createdAt')}
              isFavorite={isFavorite}
              {...cardCallbacks}
            />
          )}
          {favorites.length > 0 && (
            <DiscoverRow
              title="Favorites"
              icon={<Heart className="h-4 w-4 fill-primary text-primary" />}
              addons={favorites}
              isSaved={isSaved}
              savingKey={savingKey}
              isFavorite={isFavorite}
              {...cardCallbacks}
            />
          )}

          {storeLoading && (
            <>
              <Skeleton className="h-56 w-full rounded-xl" />
              <div className="flex gap-4 overflow-hidden">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-52 w-[260px] sm:w-[300px] shrink-0 rounded-xl" />)}
              </div>
            </>
          )}

          {!storeLoading && storeError && (
            <Card className="border-destructive">
              <CardContent className="flex flex-col items-start gap-3 pt-6">
                <p className="text-destructive">Could not reach the addon directory. Check your connection and try again.</p>
                <Button variant="outline" size="sm" onClick={() => setStoreReloadKey((k) => k + 1)}>Retry</Button>
              </CardContent>
            </Card>
          )}

          {!storeLoading && !storeError && featuredList.length > 0 && (
            <DiscoverHero
              addons={featuredList}
              isSaved={isSaved}
              savingKey={savingKey}
              onSave={openSave}
              onConfigure={handleConfigure}
              onOpenDetail={openDetail}
              onDeploy={openDeploy}
              deployedCount={deployedCount}
              accountTotal={accountTotal}
            />
          )}

          {!storeLoading && !storeError && (
            <>
              {userCategoryShelves.map(({ category, addons: shelf }) => (
                <DiscoverRow
                  key={`user-${category.slug}`}
                  title={`Your ${category.name}`}
                  icon={<Sparkles className="h-4 w-4 text-primary" />}
                  addons={shelf}
                  isSaved={isSaved}
                  savingKey={savingKey}
                  onSeeAll={() => seeAllCategory(category.slug)}
                  isFavorite={isFavorite}
                  {...cardCallbacks}
                />
              ))}
              <DiscoverRow
                title="Trending This Week"
                icon={<Flame className="h-4 w-4 text-warning" />}
                addons={trendingThisWeek}
                isSaved={isSaved}
                savingKey={savingKey}
                onSeeAll={() => seeAll('stars')}
                isFavorite={isFavorite}
                {...cardCallbacks}
              />
              <DiscoverRow
                title="Recently Updated"
                icon={<RefreshCw className="h-4 w-4 text-primary" />}
                addons={recentlyUpdated}
                isSaved={isSaved}
                savingKey={savingKey}
                onSeeAll={() => seeAll('stars')}
                isFavorite={isFavorite}
                {...cardCallbacks}
              />
              <DiscoverRow
                title="New & Noteworthy"
                icon={<Sparkles className="h-4 w-4 text-primary" />}
                addons={newest}
                isSaved={isSaved}
                savingKey={savingKey}
                onSeeAll={() => seeAll('createdAt')}
                isFavorite={isFavorite}
                {...cardCallbacks}
              />
              {categoryShelves.map(({ category, addons: shelf }) => (
                <DiscoverRow
                  key={category.slug}
                  title={category.name}
                  icon={<Sparkles className="h-4 w-4 text-primary" />}
                  addons={shelf}
                  isSaved={isSaved}
                  savingKey={savingKey}
                  onSeeAll={() => seeAllCategory(category.slug)}
                  isFavorite={isFavorite}
                  {...cardCallbacks}
                />
              ))}
            </>
          )}

        </>
      )}

      <p className="pt-1 text-center text-xs text-muted-foreground">
        Addon data from{' '}
        <a href="https://stremio-addons.net" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
          stremio-addons.net
        </a>
      </p>

      {gridMode && (
        <>
          {forceGrid && !isFiltering && (
            <Button variant="ghost" size="sm" className="h-8 w-fit gap-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={backToStore}>
              <ArrowLeft className="h-4 w-4" />
              Back to Discover
            </Button>
          )}

          {error && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="flex items-start gap-3 pt-6">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <div className="flex-1">
                  <p className="font-medium text-destructive">Couldn't load addons</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{error}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => runQuery(1)}>Retry</Button>
              </CardContent>
            </Card>
          )}

          {loading && (
            <div className={cn('grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4', compact && 'gap-2 lg:grid-cols-3 xl:grid-cols-3')}>
              {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className={cn('rounded-xl', compact ? 'h-20' : 'h-[252px]')} />)}
            </div>
          )}

          {!loading && !error && visibleAddons.length === 0 && (
            <Card className="border-border/40 bg-muted/20">
              <CardContent className="flex flex-col items-center py-12 text-center">
                <Search className="mb-3 h-10 w-10 text-muted-foreground/40" />
                <p className="text-lg font-medium">No addons found</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {(selectedResources.length > 0 || selectedTypes.length > 0) && addons.length > 0
                    ? 'None of the loaded addons match these refine filters.'
                    : 'Try a different search or clear your filters.'}
                </p>
                {isFiltering && (
                  <Button variant="ghost" size="sm" className="mt-4" onClick={clearFilters}>Clear filters</Button>
                )}
              </CardContent>
            </Card>
          )}

          {!loading && visibleAddons.length > 0 && (
            <StaggerContainer className={cn(
              'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
              compact ? 'gap-2 lg:grid-cols-3 xl:grid-cols-3' : 'gap-4'
            )}>
              {visibleAddons.map((addon) => (
                <StaggerItem key={addon.uuid}>
                  <DiscoverCard
                    addon={addon}
                    saved={isSaved(addon)}
                    saving={savingKey === addon.uuid}
                    favorite={isFavorite(addon)}
                    compact={compact}
                    {...cardCallbacks}
                  />
                </StaggerItem>
              ))}
            </StaggerContainer>
          )}

          {!loading && hasNextPage && (
            <div ref={loadMoreRef} className="flex justify-center pt-2">
              <Button variant="outline" onClick={() => runQuery(page + 1)} disabled={loadingMore} className="gap-2">
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
      </div>
      )}

      <DiscoverDetailModal
        addon={detailAddon}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        saved={detailAddon ? isSaved(detailAddon) : false}
        isSaved={isSaved}
        onSave={openSave}
        onDeploy={openDeploy}
        onConfigure={handleConfigure}
      />

      <DiscoverSaveDialog
        addon={saveAddon}
        open={saveOpen}
        onOpenChange={setSaveOpen}
        saving={savingKey === saveAddon?.uuid}
        onSave={handleSaveConfirm}
      />

      <AccountPickerDialog
        open={deployOpen}
        onOpenChange={setDeployOpen}
        title="Deploy Addon"
        description={`Install "${deployAddon?.manifest?.name ?? 'this addon'}" to the selected accounts.`}
        onConfirm={handleDeployConfirm}
        confirmLabel="Deploy"
      />
    </div>
  )
}
