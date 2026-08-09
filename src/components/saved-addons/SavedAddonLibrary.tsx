import { checkSavedAddonUpdates } from '@/api/addons'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { useAddonStore } from '@/store/addonStore'
import { useUIStore } from '@/store/uiStore'
import { useAccountStore } from '@/store/accountStore'
import { TagManagerDialog } from './TagManagerDialog'

import {
  User,
  Pencil, Send, Layers,
  ArrowLeft, Link2,
  Check, Compass, Info
} from 'lucide-react'
import { AnimatedTrashIcon, AnimatedRefreshIcon } from '../ui/AnimatedIcons'
import { Progress } from '@/components/ui/progress'
import { useEffect, useRef, useState, useCallback, lazy, Suspense } from 'react'
import { useShallow } from 'zustand/react/shallow'

const DiscoverPanel = lazy(() => import('@/components/discover/DiscoverPanel').then(m => ({ default: m.DiscoverPanel })))
import { useProfileStore } from '@/store/profileStore'
import { cn, getLatestAddonVersion, isNewerVersion } from '@/lib/utils'
import { describeManifestChanges } from '@/lib/addon-manifest-diff'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { BulkEditDialog } from './BulkEditDialog'
import { AccountPickerDialog } from '../accounts/AccountPickerDialog'
import { BulkUrlReplaceDialog } from './BulkUrlReplaceDialog'
import { FloatingActionBar } from '@/components/ui/floating-action-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { ToolbarShell } from '@/components/ui/toolbar-shell'
import { StatusChip } from '@/components/ui/status-chip'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LibraryEmptyState } from '@/components/common/PageEmptyStates'
import { useRelativeTime } from '@/hooks/use-relative-time'
import { AddSavedAddonDialog } from './AddSavedAddonDialog'
import { LibraryToolbar } from './LibraryToolbar'
import { SavedAddonGrid } from './SavedAddonGrid'
import { LibrarySidebar } from './LibrarySidebar'
import { LibrarySyncTab } from './LibrarySyncTab'
import { DeploymentPreview } from './DeploymentPreview'
import { LibraryInjectDialog } from './LibraryInjectDialog'
import { useAIOStreamsInstances } from '@/hooks/useAIOStreamsInstances'
import type { SavedAddon } from '@/types/saved-addon'
import { useSavedAddonLibraryData } from './hooks/useSavedAddonLibraryData'
import { useSavedAddonSyncActions } from './hooks/useSavedAddonSyncActions'
import { useSavedAddonSelectionActions } from './hooks/useSavedAddonSelectionActions'
import { useScrollRestoration } from '@/hooks/use-scroll-restoration'

export function SavedAddonLibrary() {
  useScrollRestoration('saved-addons')
  const formatRelativeTime = useRelativeTime()


  const {
    library, getAllTags, initialize, loading, isUpdatingAddon, error,
    checkAllHealth, checkingHealth, lastHealthCheck, createSavedAddon,
    updateSavedAddonManifest, accountStates, latestVersions,
    manifestChangeHints, updateLatestVersions, updateManifestChangeHints
  } = useAddonStore(useShallow(state => ({
    library: state.library,
    getAllTags: state.getAllTags,
    initialize: state.initialize,
    loading: state.loading,
    isUpdatingAddon: state.isUpdatingAddon,
    error: state.error,
    checkAllHealth: state.checkAllHealth,
    checkingHealth: state.checkingHealth,
    lastHealthCheck: state.lastHealthCheck,
    createSavedAddon: state.createSavedAddon,
    updateSavedAddonManifest: state.updateSavedAddonManifest,
    accountStates: state.accountStates,
    latestVersions: state.latestVersions,
    manifestChangeHints: state.manifestChangeHints,
    updateLatestVersions: state.updateLatestVersions,
    updateManifestChangeHints: state.updateManifestChangeHints,
  })))
  const accounts = useAccountStore(state => state.accounts)
  const { instances: aioStreamsInstances } = useAIOStreamsInstances()
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = (val: string) => {
    setSearchQuery(val)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearchQuery(val)
    }, 150)
  }
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)

  const [addUrl, setAddUrl] = useState('')
  const [addName, setAddName] = useState('')
  const [addTags, setAddTags] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [updatingAll, setUpdatingAll] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<{ current: number; total: number } | null>(null)
  const { toast } = useToast()

  const profiles = useProfileStore(s => s.profiles)
  const initProfiles = useProfileStore(s => s.initialize)
  const deleteProfile = useProfileStore(s => s.deleteProfile)

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null) // null = all, 'unassigned' = no profile
  const [deleteProfileId, setDeleteProfileId] = useState<string | null>(null)

  const viewMode = useUIStore(s => s.libraryViewMode)
  const setViewMode = useUIStore(s => s.setLibraryViewMode)
  const isMounted = useRef(true)
  useEffect(() => {
    return () => { isMounted.current = false }
  }, [])
  const [collapsedProfiles, setCollapsedProfiles] = useState<Set<string>>(new Set())
  const [showTagManager, setShowTagManager] = useState(false)
  const [showBulkUrlReplaceDialog, setShowBulkUrlReplaceDialog] = useState(false)
  const [showInjectDialog, setShowInjectDialog] = useState(false)
  const [injectAddons, setInjectAddons] = useState<SavedAddon[]>([])
  const [showMobileFilters, setShowMobileFilters] = useState(false)
  const [libraryTab, setLibraryTab] = useState<'library' | 'discover' | 'sync'>(() => {
    const hash = window.location.hash.replace('#', '')
    const legacy = new URLSearchParams(window.location.search).get('tab')
    const tab = hash || legacy
    if (tab === 'sync') return 'sync'
    if (tab === 'discover') return 'discover'
    return 'library'
  })

  // Latch: once Discover is opened, keep it mounted (hidden when inactive) so
  // switching back is instant, with no remount, refetch, or animation replay.
  const [discoverVisited, setDiscoverVisited] = useState(libraryTab === 'discover')
  // Bumped on each switch INTO Discover so its entrance animation replays (like Library)
  // without remounting the panel, so no refetch.
  const [discoverReplayKey, setDiscoverReplayKey] = useState(0)
  useEffect(() => {
    if (libraryTab === 'discover') setDiscoverVisited(true)
  }, [libraryTab])

  const toggleProfile = (id: string) => {
    setCollapsedProfiles(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useEffect(() => {
    initProfiles()
  }, [initProfiles])

  const {
    savedAddons,
    allTags,
    filteredAddons,
    healthSummary,
    updatesCount,
    tagCounts,
    profileAddonCounts,
    unassignedCount,
    deploymentSummaryByAddonId,
    syncOverviewData,
    notSyncingDeployed,
  } = useSavedAddonLibraryData({
    library,
    getAllTags,
    profiles,
    accountStates,
    accounts,
    selectedProfileId,
    selectedTag,
    debouncedSearchQuery,
    latestVersions,
    manifestChangeHints,
  })

  const {
    syncFilter,
    setSyncFilter,
    pushingUpdates,
    enablingSyncIds,
    disablingSyncIds,
    handlePushAllSyncUpdates,
    handlePushSyncAddonUpdate,
    handleDisableSync,
    handleEnableSync,
  } = useSavedAddonSyncActions({
    syncOverviewData,
    latestVersions,
    manifestChangeHints,
  })

  const {
    isSelectionMode,
    selectedIds,
    setSelectedIds,
    showBulkEditDialog,
    setShowBulkEditDialog,
    showBulkDeleteConfirmation,
    setShowBulkDeleteConfirmation,
    showAccountPicker,
    setShowAccountPicker,
    showRemoveAccountPicker,
    setShowRemoveAccountPicker,
    clearSelection,
    enterSelectionMode,
    toggleSelectionMode,
    handleToggleSelect,
    handleSelectAll,
    handleRemoveFromAccounts,
    handleBulkDelete,
    handleBulkEdit,
    handleDeployToAccounts,
  } = useSavedAddonSelectionActions({
    filteredAddons,
    library,
  })

  const librarySearchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement
      const isInput = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (e.key === 'Escape' && isSelectionMode && !isInput) {
        clearSelection()
      }
      if (e.key === '/' && !isSelectionMode && !isInput) {
        e.preventDefault()
        librarySearchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isSelectionMode, clearSelection])

  const handleRefresh = useCallback(async () => {
    if (checkingUpdates) return
    if (savedAddons.length === 0) return

    setCheckingUpdates(true)
    try {
      await useAddonStore.getState().checkAllHealth()

      const updateInfoList = await checkSavedAddonUpdates(savedAddons)
      const versions: Record<string, string> = {}
      const manifestHints: typeof manifestChangeHints = {}

      const healthUpdates = updateInfoList.map(info => ({
        id: info.addonId,
        isOnline: info.health.isOnline,
        error: info.health.error
      }))
      useAddonStore.getState().updateHealthStatus(healthUpdates)

      updateInfoList.forEach((info) => {
        const addon = savedAddons.find((a) => a.id === info.addonId)
        if (addon) {
          versions[info.versionKey] = info.latestVersion
          versions[addon.manifest.id] = info.latestVersion
        }
        if (info.hasManifestShapeChange && info.manifestChanges) {
          manifestHints[info.addonId] = info.manifestChanges
        }
      })
      updateLatestVersions(versions)
      updateManifestChangeHints(manifestHints)

      const updatesCount = updateInfoList.filter((info) => info.hasUpdate).length
      const shapeChangeCount = updateInfoList.filter((info) => info.hasManifestShapeChange).length

      if (updatesCount > 0) {
        toast({
          title: 'Refresh Complete',
          description: shapeChangeCount > 0
            ? `${updatesCount} addon${updatesCount !== 1 ? 's have' : ' has'} updates available, including ${shapeChangeCount} manifest shape change${shapeChangeCount !== 1 ? 's' : ''}.`
            : `${updatesCount} addon${updatesCount !== 1 ? 's have' : ' has'} updates available.`,
        })
      } else {
        toast({
          title: 'Refresh Complete',
          description: 'All addons are up to date.',
        })
      }
    } catch (err) {
      toast({
        title: 'Refresh Failed',
        description: 'Failed to check for updates',
        variant: 'destructive',
      })
    } finally {
      setCheckingUpdates(false)
    }
  }, [checkingUpdates, savedAddons, toast, updateLatestVersions, updateManifestChangeHints])

  const handleDeploySingle = useCallback((savedAddonId: string) => {
    setSelectedIds(new Set([savedAddonId]))
    setShowAccountPicker(true)
  }, [])

  const handleOpenInjectDialog = useCallback(() => {
    const addons = Array.from(selectedIds)
      .map((id) => library[id])
      .filter((a): a is SavedAddon => !!a)
    if (addons.length === 0) return
    setInjectAddons(addons)
    setShowInjectDialog(true)
  }, [selectedIds, library])

  const handleUpdateSavedAddon = useCallback(
    async (savedAddonId: string, addonName: string) => {
      try {
        const result = await updateSavedAddonManifest(savedAddonId)
        const manifestChangeText = describeManifestChanges(result)
        const description = result.versionChanged
          ? `Updated ${addonName} from v${result.previousVersion} to v${result.latestVersion}${manifestChangeText ? ` (${manifestChangeText})` : ''}.`
          : manifestChangeText
            ? `Refreshed ${addonName}: ${manifestChangeText}.`
            : `${addonName} is already current.`

        toast({
          title: result.libraryChanged ? 'Addon Updated' : 'Already Current',
          description,
        })
      } catch (err) {
        toast({
          title: 'Update Failed',
          description: err instanceof Error ? err.message : 'Failed to update addon',
          variant: 'destructive',
        })
      }
    },
    [updateSavedAddonManifest, toast]
  )

  const handleUpdateAll = useCallback(async () => {
    const addonsWithUpdates = savedAddons.filter((addon) => {
      const latest = getLatestAddonVersion(latestVersions, {
        transportUrl: addon.installUrl,
        manifest: addon.manifest,
      })
      return (latest && isNewerVersion(addon.manifest.version, latest)) || manifestChangeHints[addon.id]?.hasManifestShapeChange
    })

    if (addonsWithUpdates.length === 0) return

    setUpdatingAll(true)
    setUpdateProgress({ current: 0, total: addonsWithUpdates.length })

    let successCount = 0
    let failCount = 0
    let shapeChangeCount = 0

    for (let i = 0; i < addonsWithUpdates.length; i++) {
      const addon = addonsWithUpdates[i]
      try {
        const result = await updateSavedAddonManifest(addon.id)
        if (result.hasManifestShapeChange) shapeChangeCount++
        successCount++
      } catch (err) {
        if (import.meta.env.DEV) console.error(`Failed to update ${addon.name}:`, err)
        failCount++
      }
      setUpdateProgress({ current: i + 1, total: addonsWithUpdates.length })
    }

    setUpdatingAll(false)
    setUpdateProgress(null)

    if (isMounted.current) {
      toast({
        title: 'Bulk Update Complete',
        description: `Successfully updated ${successCount} addon${successCount !== 1 ? 's' : ''}${shapeChangeCount > 0 ? `, including ${shapeChangeCount} manifest shape change${shapeChangeCount !== 1 ? 's' : ''}` : ''}. ${failCount > 0 ? `Failed: ${failCount}` : ''}`,
      })
    }
  }, [savedAddons, latestVersions, manifestChangeHints, updateSavedAddonManifest, toast])

  useEffect(() => {
    const init = async () => {
      await initialize()
      // Defer health check to prevent state update during mount warning
      setTimeout(() => checkAllHealth(), 0)
    }
    init()
  }, [initialize, checkAllHealth])

  const handleOpenAddDialog = () => {
    setAddUrl('')
    setAddName('')
    setAddTags([])
    setAddError(null)
    setShowAddDialog(true)
  }

  const handleAddDialogOpenChange = (open: boolean) => {
    if (!open) {
      setAddUrl('')
      setAddName('')
      setAddTags([])
      setAddError(null)
    }
    setShowAddDialog(open)
  }

  const handleAddAddon = async () => {
    if (!addUrl.trim()) {
      setAddError('Enter at least one addon URL')
      return
    }

    setAdding(true)
    setAddError(null)
    try {
      const urls = addUrl.split(/\n/).map(u => u.trim()).filter(Boolean)

      if (urls.length === 0) {
        setAddError('No valid URLs found')
        setAdding(false)
        return
      }

      let successCount = 0
      let lastError = null

      for (const url of urls) {
        try {
          // createSavedAddon will fetch the manifest automatically
          await createSavedAddon(
            urls.length === 1 ? addName.trim() : '', // Only apply custom name if single URL
            url,
            addTags,
            selectedProfileId !== 'unassigned' ? selectedProfileId || undefined : undefined
          )
          successCount++
        } catch (err) {
          if (import.meta.env.DEV) console.error(`Failed to add ${url}:`, err)
          lastError = err
        }
      }

      if (successCount > 0) {
        toast({
          title: successCount === 1 ? 'Saved to Library' : 'Batch Addition Complete',
          description: successCount === 1
            ? 'Addon has been saved to your library'
            : `Successfully added ${successCount} addon${successCount !== 1 ? 's' : ''} to your library.`,
        })
        setShowAddDialog(false)
      } else if (lastError) {
        setAddError(lastError instanceof Error ? lastError.message : 'Failed to add addons')
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add addons')
    } finally {
      setAdding(false)
    }
  }

  const handleLibraryTabChange = (value: string) => {
    const nextTab = value === 'sync' ? 'sync' : value === 'discover' ? 'discover' : 'library'
    if (nextTab === 'discover') setDiscoverReplayKey((k) => k + 1)
    setLibraryTab(nextTab)

    const url = new URL(window.location.href)
    url.search = ''
    url.hash = nextTab === 'library' ? '' : nextTab
    window.history.replaceState(null, '', `${url.pathname}${url.hash}`)
  }

  const handleDeleteProfile = async () => {
    if (deleteProfileId) {
      await useAddonStore.getState().deleteSavedAddonsByProfile(deleteProfileId)

      await deleteProfile(deleteProfileId)

      if (selectedProfileId === deleteProfileId) {
        setSelectedProfileId(null)
      }

      setDeleteProfileId(null)
      toast({ title: 'Profile and associated addons deleted' })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Tab strip, same spot for every tab. Library shows its title below; Discover/Sync need none. */}
      <div className="flex flex-col gap-3">
        <Tabs value={libraryTab} onValueChange={handleLibraryTabChange}>
          <TabsList>
            <TabsTrigger value="library" className="h-8 px-4 text-xs">
              Library
            </TabsTrigger>
            <Tooltip content="Browse community addons from stremio-addons.net.">
              <TooltipTrigger asChild>
                <TabsTrigger value="discover" className="h-8 px-4 text-xs">
                  <Compass className="h-3.5 w-3.5" />
                  Discover
                </TabsTrigger>
              </TooltipTrigger>
            </Tooltip>
            <Tooltip content="Track which library addons are synced to installed accounts.">
              <TooltipTrigger asChild>
                <TabsTrigger
                  value="sync"
                  className="h-8 px-4 text-xs"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Sync
                  {syncOverviewData.length > 0 && (
                    <span className={cn("flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-xs font-bold leading-none", libraryTab === 'sync' ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground")}>{syncOverviewData.length}</span>
                  )}
                </TabsTrigger>
              </TooltipTrigger>
            </Tooltip>
          </TabsList>
        </Tabs>

        {libraryTab === 'library' && (
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {selectedProfileId && (
              <ToolbarShell className="w-fit max-w-full p-2" contentClassName="gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSelectedProfileId(null)} className="h-8 shrink-0 gap-1.5 rounded-xl border border-border/40 bg-card px-2.5 text-xs font-medium text-muted-foreground shadow-sm hover:bg-muted/50 hover:text-foreground">
                  <ArrowLeft className="h-4 w-4" />
                  All Addons
                </Button>
              </ToolbarShell>
            )}
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight truncate">
              {selectedProfileId
                ? selectedProfileId === 'unassigned'
                  ? 'Unassigned Addons'
                  : profiles.find(p => p.id === selectedProfileId)?.name || 'Profile'
                : 'All Addons'}
            </h1>
            <StatusChip className="rounded-lg hidden sm:inline-flex">
              {filteredAddons.length} saved addon{filteredAddons.length !== 1 ? 's' : ''}
            </StatusChip>
            {selectedProfileId && (() => {
              const p = profiles.find(p => p.id === selectedProfileId)
              if (p?.description && p.description.trim() !== '' && p.description.trim() !== p.name.trim()) {
                return <span className="text-xs font-medium text-foreground break-all hidden md:block flex-1 min-w-0">{p.description}</span>
              }
              return null
            })()}
          </div>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {libraryTab === 'library' && (
          <LibrarySidebar
          profiles={profiles}
          selectedProfileId={selectedProfileId}
          onSelectProfile={setSelectedProfileId}
          savedAddonCount={savedAddons.length}
          unassignedCount={unassignedCount}
          profileAddonCounts={profileAddonCounts}
          allTags={allTags}
          selectedTag={selectedTag}
          onSelectTag={setSelectedTag}
          tagCounts={tagCounts}
          showMobileFilters={showMobileFilters}
          onCloseMobileFilters={() => setShowMobileFilters(false)}
          onManageTags={() => setShowTagManager(true)}
          onDeleteProfile={setDeleteProfileId}
        />
      )}


      <div className="flex flex-col min-w-0 space-y-4 w-full flex-1">

        <div className="flex flex-col gap-3 w-full">


        <FloatingActionBar
          open={selectedIds.size > 0}
          selectedCount={selectedIds.size}
                totalCount={filteredAddons.length}
          onClearSelection={clearSelection}
          actions={[
            {
              label: selectedIds.size === filteredAddons.length && filteredAddons.length > 0 ? 'Deselect All' : 'Select All',
              onClick: handleSelectAll,
              variant: 'outline',
              icon: <Check className="h-4 w-4" />,
              tooltip: selectedIds.size === filteredAddons.length && filteredAddons.length > 0 ? 'Deselect all addons' : 'Select all addons',
            },
            {
              label: 'Deploy',
              onClick: () => setShowAccountPicker(true),
              variant: 'outline',
              icon: <Send className="h-4 w-4" />,
              tooltip: 'Deploy to accounts',
            },
            ...(aioStreamsInstances.length > 0 ? [{
              label: 'Add to AIOStreams',
              onClick: handleOpenInjectDialog,
              variant: 'outline' as const,
              icon: <Layers className="h-4 w-4" />,
              tooltip: 'Add to AIOStreams instances',
            }] : []),
            {
              label: 'Remove',
              onClick: () => setShowRemoveAccountPicker(true),
              variant: 'outline',
              icon: <User className="h-4 w-4" />,
              tooltip: 'Remove from accounts',
            },
            {
              label: 'Edit',
              onClick: () => { setShowBulkEditDialog(true) },
              variant: 'outline',
              icon: <Pencil className="h-4 w-4" />,
              tooltip: 'Edit selected addons',
            },
            {
              label: 'Delete',
              onClick: () => setShowBulkDeleteConfirmation(true),
              variant: 'destructive',
              icon: <AnimatedTrashIcon className="h-4 w-4" />,
              tooltip: 'Delete selected addons',
            },
          ]}
        />


        {error && (
          <Card className="border-destructive">
            <CardContent className="pt-6">
              <p className="text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}

        {discoverVisited && (
          <div className={cn(libraryTab !== 'discover' && 'hidden')}>
            <Suspense fallback={
              <div className="flex flex-col gap-5">
                <Skeleton className="h-[240px] w-full rounded-xl" />
                <div className="flex gap-4 overflow-hidden">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-52 w-[300px] shrink-0 rounded-xl" />)}
                </div>
              </div>
            }>
              <DiscoverPanel replayKey={discoverReplayKey} />
            </Suspense>
          </div>
        )}

        {libraryTab === 'sync' && (
          <LibrarySyncTab
            syncOverviewData={syncOverviewData}
            notSyncingDeployed={notSyncingDeployed}
            latestVersions={latestVersions}
            manifestChangeHints={manifestChangeHints}
            syncFilter={syncFilter}
            onSyncFilterChange={setSyncFilter}
            lastCheckedLabel={lastHealthCheck ? formatRelativeTime(lastHealthCheck) : null}
            pushingUpdates={pushingUpdates}
            enablingSyncIds={enablingSyncIds}
            disablingSyncIds={disablingSyncIds}
            profiles={profiles}
            onBackToLibrary={() => setLibraryTab('library')}
            onPushAllUpdates={handlePushAllSyncUpdates}
            onPushAddonUpdate={handlePushSyncAddonUpdate}
            onDisableSync={handleDisableSync}
            onEnableSync={handleEnableSync}
          />
        )}


        {libraryTab === 'library' && <div className="space-y-6">
          {(isUpdatingAddon || updateProgress || checkingUpdates) && (
            <div className="rounded-2xl border border-border/40 bg-card shadow-sm p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 shrink-0">
                    <AnimatedRefreshIcon className="h-4 w-4 text-primary" isAnimating={true} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">
                        {updateProgress
                            ? `Updating ${updateProgress.current} of ${updateProgress.total} addons`
                            : checkingUpdates
                            ? 'Checking library for updates'
                            : 'Updating addon'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                        {updateProgress
                            ? `${updateProgress.total - updateProgress.current} remaining`
                            : checkingUpdates
                            ? 'Comparing versions and manifest changes'
                            : 'Syncing changes to Stremio'}
                    </div>
                </div>
                {updateProgress && (
                    <span className="text-sm font-bold tabular-nums text-primary shrink-0">
                        {Math.round((updateProgress.current / updateProgress.total) * 100)}%
                    </span>
                )}
              </div>
              <Progress
                value={updateProgress ? Math.round((updateProgress.current / updateProgress.total) * 100) : 100}
                shimmer
                className="h-1.5 bg-muted"
              />
            </div>
          )}
          {loading && savedAddons.length === 0 && (
            <div className="space-y-4">
              <ToolbarShell contentClassName="w-full" className="mb-4">
                  <Skeleton className="h-8 w-full min-w-[160px] max-w-[320px]" />
                  <div className="flex items-center gap-1.5 sm:ml-auto shrink-0">
                    <Skeleton className="h-8 w-20" />
                    <Skeleton className="h-8 w-20" />
                    <Skeleton className="h-8 w-24" />
                  </div>
              </ToolbarShell>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-40 rounded-xl" />
                ))}
              </div>
            </div>
          )}
          {!loading && (
            <div className="flex flex-col gap-6">
              <LibraryToolbar
                showMobileFilters={showMobileFilters}
                selectedProfileId={selectedProfileId}
                selectedTag={selectedTag}
                profiles={profiles}
                searchQuery={searchQuery}
                onSearchChange={handleSearchChange}
                searchRef={librarySearchRef}
                viewMode={viewMode}
                onViewModeChange={(mode) => { setViewMode(mode); setCollapsedProfiles(new Set()) }}
                savedAddonsCount={savedAddons.length}
                healthSummary={healthSummary}
                checkingUpdates={checkingUpdates}
                checkingHealth={checkingHealth}
                updatingAll={updatingAll}
                updatesCount={updatesCount}
                onRefresh={handleRefresh}
                onUpdateAll={handleUpdateAll}
                onOpenBulkUrlReplace={() => setShowBulkUrlReplaceDialog(true)}
                isSelectionMode={isSelectionMode}
                onToggleSelectionMode={toggleSelectionMode}
                onOpenAddDialog={handleOpenAddDialog}
                onToggleMobileFilters={() => setShowMobileFilters(v => !v)}
              />
              <div className="flex items-start gap-2.5 rounded-xl border border-border/40 bg-muted/25 px-3.5 py-2.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                <p>
                  <span className="font-medium text-foreground/80">Version numbers are informational.</span>{' '}
                  An addon keeps working whether or not you update; updating just re-fetches the latest manifest. It's
                  only worth doing when an addon's capabilities actually change, which is flagged separately as a manifest change.
                </p>
              </div>
            </div>
          )}


          {filteredAddons.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                {searchQuery || selectedTag || selectedProfileId ? (
                  <div>
                    <p className="text-lg font-medium mb-2">No saved addons found</p>
                    <p className="text-muted-foreground mb-4">Try adjusting your search, filters, or selected profile</p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSearchQuery('')
                        setSelectedTag(null)
                        setSelectedProfileId(null)
                      }}
                    >
                      Clear All Filters
                    </Button>
                  </div>
                ) : (
                  <LibraryEmptyState onAdd={handleOpenAddDialog} onImport={() => setShowAccountPicker(true)} />
                )}
              </CardContent>
            </Card>
          )}

          {filteredAddons.length > 0 && (
            <div className={cn(
              "transition-opacity duration-200",
              isUpdatingAddon ? "opacity-70 pointer-events-none" : "opacity-100"
            )}>
              <SavedAddonGrid
                addons={filteredAddons}
                profiles={profiles}
                selectedProfileId={selectedProfileId}
                collapsedProfiles={collapsedProfiles}
                onToggleProfile={toggleProfile}
                viewMode={viewMode}
                latestVersions={latestVersions}
                manifestChangeHints={manifestChangeHints}
                deploymentSummaryByAddonId={deploymentSummaryByAddonId}
                onUpdate={handleUpdateSavedAddon}
                onDeploy={handleDeploySingle}
                isSelectionMode={isSelectionMode}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onEnterSelectionMode={enterSelectionMode}
                highlight={debouncedSearchQuery}
              />
            </div>
          )}

        <AddSavedAddonDialog
          open={showAddDialog}
          onOpenChange={handleAddDialogOpenChange}
          addUrl={addUrl}
          setAddUrl={setAddUrl}
          addName={addName}
          setAddName={setAddName}
          addTags={addTags}
          setAddTags={setAddTags}
          allTags={allTags}
          addError={addError}
          adding={adding}
          onAdd={handleAddAddon}
        />


        <ConfirmationDialog
          open={!!deleteProfileId}
          onOpenChange={(open) => !open && setDeleteProfileId(null)}
          title="Delete Profile?"
          description={
            <>
              This will permanently delete the profile <b>"{profiles.find(p => p.id === deleteProfileId)?.name}"</b> AND <b>{Object.values(library).filter(a => a.profileId === deleteProfileId).length}</b> associated addons. This action cannot be undone.
            </>
          }
          confirmText="Delete Everything"
          isDestructive={true}
          onConfirm={handleDeleteProfile}
        />

        <BulkEditDialog
          open={showBulkEditDialog}
          onOpenChange={setShowBulkEditDialog}
          selectedCount={selectedIds.size}
          availableTags={allTags}
          onSave={handleBulkEdit}
        />

        <BulkUrlReplaceDialog
          open={showBulkUrlReplaceDialog}
          onOpenChange={setShowBulkUrlReplaceDialog}
        />

        <ConfirmationDialog
          open={showBulkDeleteConfirmation}
          onOpenChange={setShowBulkDeleteConfirmation}
          title={`Delete ${selectedIds.size} Saved Addons?`}
          description="This will permanently delete these addons from your library. This action cannot be undone."
          confirmText="Delete"
          isDestructive={true}
          onConfirm={handleBulkDelete}
          isLoading={loading}
          impactItems={Array.from(selectedIds).slice(0, 10).map(id => library[id]?.name || id)}
        />

        <AccountPickerDialog
          open={showAccountPicker}
          onOpenChange={setShowAccountPicker}
          title={`Deploy ${selectedIds.size} Addon${selectedIds.size !== 1 ? 's' : ''}`}
          description="Select the accounts where you want to install these addons."
          onConfirm={handleDeployToAccounts}
          confirmLabel="Deploy"
          renderPreview={(accountIds) => (
            <DeploymentPreview
              selectedAddonIds={selectedIds}
              library={library}
              accountIds={accountIds}
            />
          )}
        />

        <AccountPickerDialog
          open={showRemoveAccountPicker}
          onOpenChange={setShowRemoveAccountPicker}
          title="Remove from Accounts"
          description={`Select accounts to REMOVE the ${selectedIds.size} selected addons from.`}
          onConfirm={handleRemoveFromAccounts}
          confirmLabel="Remove"
          confirmVariant="destructive"
          renderPreview={(accountIds) => (
            <DeploymentPreview
              selectedAddonIds={selectedIds}
              library={library}
              accountIds={accountIds}
              operation="remove"
              allowProtected={false}
            />
          )}
        />


        <TagManagerDialog isOpen={showTagManager} onClose={() => setShowTagManager(false)} />

        <LibraryInjectDialog
          open={showInjectDialog}
          onOpenChange={setShowInjectDialog}
          addons={injectAddons}
          instances={aioStreamsInstances}
        />
      </div>}
        </div>
      </div>
      </div>

    </div>
  )
}
