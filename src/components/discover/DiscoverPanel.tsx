import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircle, ArrowLeft, Bookmark, Flame, Loader2, Search, Sparkles } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { useAddonStore } from '@/store/addonStore'
import { useAccountStore } from '@/store/accountStore'
import { useProfileStore } from '@/store/profileStore'
import { normalizeAddonUrl } from '@/lib/utils'
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
import { DiscoverToolbar } from './DiscoverToolbar'
import { DiscoverCard } from './DiscoverCard'
import { DiscoverHero } from './DiscoverHero'
import { DiscoverRow } from './DiscoverRow'
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

export function DiscoverPanel({ replayKey = 0 }: { replayKey?: number }) {
  const { toast } = useToast()
  const library = useAddonStore((state) => state.library)
  const createSavedAddon = useAddonStore((state) => state.createSavedAddon)
  const createProfile = useProfileStore((state) => state.createProfile)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortBy, setSortBy] = useState<DiscoverSortBy>('stars')
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [selectedResources, setSelectedResources] = useState<string[]>([])
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [showAdult, setShowAdult] = useState(false)
  const [forceGrid, setForceGrid] = useState(false)
  const [favorites, setFavorites] = useState<DiscoverAddon[]>(() => loadFavorites())

  // Storefront shelves
  const [trending, setTrending] = useState<DiscoverAddon[]>([])
  const [newest, setNewest] = useState<DiscoverAddon[]>([])
  const [storeLoading, setStoreLoading] = useState(true)
  const [storeError, setStoreError] = useState(false)
  const [storeReloadKey, setStoreReloadKey] = useState(0)
  const [categories, setCategories] = useState<DiscoverCategory[]>([])
  const [categoryShelves, setCategoryShelves] = useState<{ category: DiscoverCategory; addons: DiscoverAddon[] }[]>([])

  // Filtered grid
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

  useEffect(() => {
    fetchDiscoverCategories().then(setCategories).catch(() => {})
  }, [storeReloadKey])

  // Category shelves: top addons in the first handful of categories.
  useEffect(() => {
    if (categories.length === 0) return
    let active = true
    const nsfw = showAdult ? undefined : 'exclude'
    const picks = categories.slice(0, 6)
    Promise.all(
      picks.map((category) =>
        fetchDiscoverAddons({ category: [category.slug], sortBy: 'stars', order: 'desc', nsfw, limit: SHELF_SIZE })
          .then((res) => ({ category, addons: res.addons }))
          .catch(() => ({ category, addons: [] as DiscoverAddon[] }))
      )
    ).then((shelves) => {
      if (active) setCategoryShelves(shelves.filter((s) => s.addons.length >= 4))
    })
    return () => { active = false }
  }, [categories, showAdult])

  // Storefront shelves: trending + newest.
  useEffect(() => {
    let active = true
    setStoreLoading(true)
    setStoreError(false)
    const nsfw = showAdult ? undefined : 'exclude'
    Promise.all([
      fetchDiscoverAddons({ sortBy: 'stars', order: 'desc', nsfw, limit: TRENDING_SIZE }),
      fetchDiscoverAddons({ sortBy: 'createdAt', order: 'desc', nsfw, limit: SHELF_SIZE }),
    ])
      .then(([top, fresh]) => {
        if (!active) return
        setTrending(top.addons)
        setNewest(fresh.addons)
      })
      .catch(() => { if (active) { setTrending([]); setNewest([]); setStoreError(true) } })
      .finally(() => { if (active) setStoreLoading(false) })
    return () => { active = false }
  }, [showAdult, storeReloadKey])

  const runQuery = useCallback(
    async (targetPage: number) => {
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
        })
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
    runQuery(1)
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

  // Resource/type facets refine the already-loaded grid client-side: the public directory API
  // ignores resource/type query params, so we narrow what's been fetched (infinite scroll keeps
  // growing the pool). Within a facet group it's match-any; across groups it's match-all.
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
    for (const id of accountIds) {
      try {
        await accountStore.installAddonToAccount(id, deployAddon.manifestUrl)
        ok++
      } catch {
        fail++
      }
    }
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
  }

  return (
    <div className="flex flex-col gap-5">
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
      />

      {/* Keyed so the entrance animation replays each time Discover is opened, without refetching. */}
      <div key={replayKey} className="flex flex-col gap-5">

      {!gridMode && (
        <>
          {favorites.length > 0 && (
            <DiscoverRow
              title="Favorites"
              icon={<Bookmark className="h-4 w-4 fill-primary text-primary" />}
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
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-52 w-[300px] shrink-0 rounded-xl" />)}
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
            />
          )}

          {!storeLoading && !storeError && (
            <>
              <DiscoverRow
                title="Trending"
                icon={<Flame className="h-4 w-4 text-warning" />}
                addons={trendingRow}
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

          <p className="pt-1 text-center text-xs text-muted-foreground">
            Addon data from{' '}
            <a href="https://stremio-addons.net" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
              stremio-addons.net
            </a>
          </p>
        </>
      )}


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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-[252px] rounded-xl" />)}
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
            <StaggerContainer className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleAddons.map((addon) => (
                <StaggerItem key={addon.uuid}>
                  <DiscoverCard
                    addon={addon}
                    saved={isSaved(addon)}
                    saving={savingKey === addon.uuid}
                    favorite={isFavorite(addon)}
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
