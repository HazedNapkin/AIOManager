import { triggerSync } from '@/lib/sync-trigger'
import { checkAddonUpdates } from '@/api/addons'
import { HealthStatus } from '@/lib/addon-health'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { useAccounts } from '@/hooks/useAccounts'
import { useAddons } from '@/hooks/useAddons'
import { getLatestAddonVersion, maskEmail, isNewerVersion, cn } from '@/lib/utils'
import { AccountSwitcher } from '@/components/common/AccountSwitcher'
import { useAccountStore, getAccountEmail, getStremioAuthKey, hasPlatformConnection } from '@/store/accountStore'
import { pushAddonsToPlatform } from '@/lib/account-compat'
import type { AddonDescriptor } from '@/types/addon'
import { useAddonStore } from '@/store/addonStore'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { useFailoverStore } from '@/store/failoverStore'
import { ArrowLeft, GripVertical, Library, Save, Plus, Search, X, Layers, Trash2, ChevronDown, Zap, Check, Shield, Copy, Download, User, Edit2, LayoutGrid, List, Wand2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { AnimatedRefreshIcon, AnimatedUpdateIcon, AnimatedShieldIcon } from '../ui/AnimatedIcons'
import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from "react"
import { Input } from '@/components/ui/input'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AddonCard } from './AddonCard'
import { StaggerContainer, StaggerItem } from '@/components/ui/stagger'
import { AccountPickerDialog } from '../accounts/AccountPickerDialog'
import { AddonReorderDialog } from './AddonReorderDialog'
import { InstallSavedAddonDialog } from './InstallSavedAddonDialog'
import { BulkSaveDialog } from './BulkSaveDialog'
import { BulkUrlReplaceDialog } from '@/components/saved-addons/BulkUrlReplaceDialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
const FailoverManager = React.lazy(() =>
  import('@/components/accounts/FailoverManager').then((m) => ({ default: m.FailoverManager }))
)
type FailoverView = import('@/components/accounts/FailoverManager').FailoverView
import { ConnectionManager } from '@/components/providers/ConnectionManager'

import { EmptyState } from '@/components/common/EmptyState'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { AddonChangelog } from '@/components/accounts/AddonChangelog'
import { FloatingActionBar } from '@/components/ui/floating-action-bar'
import { ToolbarShell } from '@/components/ui/toolbar-shell'
import { AccountSetupCreateDialog } from '@/components/accounts/AccountSetupCreateDialog'
import { useConfetti } from '@/components/ui/confetti'
import { mapConcurrent } from '@/lib/concurrency'
import { SYNCED_SETTINGS_EVENT } from '@/lib/synced-settings'
import type { AddonCollectionDiff } from '@/lib/addon-collection-diff'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

interface AddonListProps {
  accountId: string
}

const ADDON_REINSTALL_CONCURRENCY = 4
const BULK_ACCOUNT_CONCURRENCY = 5
const BULK_ADDON_FETCH_CONCURRENCY = 4

function getProfileSwitchDescription(result: {
  targetName: string
  addonChanges: AddonCollectionDiff
  remoteWriteSkipped: boolean
}) {
  const { addonChanges } = result
  const parts = []
  if (addonChanges.installs > 0) parts.push(`${addonChanges.installs} installed`)
  if (addonChanges.updates > 0) parts.push(`${addonChanges.updates} updated`)
  if (addonChanges.removals > 0) parts.push(`${addonChanges.removals} removed`)
  if (addonChanges.orderChanged) parts.push('order updated')

  const summary = parts.length > 0 ? parts.join(', ') : 'No add-on changes needed'
  const writeSummary = result.remoteWriteSkipped ? 'No remote add-on write needed.' : 'Remote add-on collection updated.'
  return `${result.targetName}: ${summary}. ${writeSummary}`
}

export function AddonList({ accountId }: AddonListProps) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { accounts } = useAccounts()
  const account = accounts.find((acc) => acc.id === accountId)
  const { addons, removeAddonByIndex } = useAddons(accountId)
  const openAddAddonDialog = useUIStore((state) => state.openAddAddonDialog)
  const addonListView = useUIStore((state) => state.addonListView)
  const setAddonListView = useUIStore((state) => state.setAddonListView)
  const [isDesktopAddonListViewport, setIsDesktopAddonListViewport] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.matchMedia('(min-width: 768px)').matches
  })
  const effectiveAddonListView = addonListView === 'list' && isDesktopAddonListViewport ? 'list' : 'grid'
  const checkRules = useFailoverStore((state) => state.checkRules)
  const pullServerState = useFailoverStore((state) => state.pullServerState)
  const encryptionKey = useAuthStore((state) => state.encryptionKey)
  const syncAccount = useAccountStore(state => state.syncAccount)
  const { toast } = useToast()

  const failoverRules = useFailoverStore(
    useShallow((state) => state.rules.filter(r => r.accountId === accountId))
  )

  const linkedRuleMap = useMemo(() => {
    const map = new Map<string, typeof failoverRules[number]>()
    for (const r of failoverRules) {
      for (let i = 1; i < r.priorityChain.length; i++) {
        map.set(r.priorityChain[i].toLowerCase(), r)
      }
    }
    return map
  }, [failoverRules])

  const primaryRuleMap = useMemo(() => {
    const map = new Map<string, typeof failoverRules[number]>()
    for (const r of failoverRules) {
      if (r.priorityChain[0]) {
        map.set(r.priorityChain[0].toLowerCase(), r)
      }
    }
    return map
  }, [failoverRules])

  const addonUrlMap = useMemo(() => {
    const map = new Map<string, typeof addons[number]>()
    for (const a of addons) {
      map.set(a.transportUrl.toLowerCase(), a)
    }
    return map
  }, [addons])

  const [visibleCount, setVisibleCount] = useState(200)
  const [reorderDialogOpen, setReorderDialogOpen] = useState(false)
  const [installFromLibraryOpen, setInstallFromLibraryOpen] = useState(false)

  const [bulkSaveOpen, setBulkSaveOpen] = useState(false)
  const [bulkUrlReplaceOpen, setBulkUrlReplaceOpen] = useState(false)

  const extractTransportUrl = (id: string) => {
    const idx = id.lastIndexOf('::')
    return idx > 0 ? id.substring(0, idx) : id
  }

  const tabParam = searchParams.get('tab')
  const validTabs = ['addons', 'failover', 'failover-history', 'failover-webhooks', 'changelog', 'connections'] as const
  type AccountTab = typeof validTabs[number]
  const activeTab: AccountTab = validTabs.includes(tabParam as AccountTab) ? tabParam as AccountTab : 'addons'
  const activeAccountTab = activeTab === 'failover-history' || activeTab === 'failover-webhooks' ? 'failover' : activeTab
  const failoverViewByTab: Record<Extract<AccountTab, 'failover' | 'failover-history' | 'failover-webhooks'>, FailoverView> = {
    failover: 'rules',
    'failover-history': 'history',
    'failover-webhooks': 'webhooks',
  }
  const failoverTabByView: Record<FailoverView, AccountTab> = {
    rules: 'failover',
    history: 'failover-history',
    webhooks: 'failover-webhooks',
  }

  const handleTabChange = (val: string) => {
    setSearchParams({ tab: val }, { replace: true })
  }

  const handleFailoverViewChange = (view: FailoverView) => {
    setSearchParams({ tab: failoverTabByView[view] }, { replace: true })
  }

  const [selectedAddonUrls, setSelectedAddonUrls] = useState<Set<string>>(new Set())
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [hideDisabled, setHideDisabled] = useState(() => {
    try { return localStorage.getItem('stremio-manager:hide-disabled-addons') === 'true' } catch { return false }
  })
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handleSyncedSettings = (event: Event) => {
      const value = (event as CustomEvent<{ hideDisabledAddons?: boolean }>).detail?.hideDisabledAddons
      if (typeof value === 'boolean') setHideDisabled(value)
    }

    window.addEventListener(SYNCED_SETTINGS_EVENT, handleSyncedSettings)
    return () => window.removeEventListener(SYNCED_SETTINGS_EVENT, handleSyncedSettings)
  }, [])

  const handleSearchChange = (val: string) => {
    setSearchQuery(val)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearchQuery(val)
    }, 150)
  }

  const toggleHideDisabled = () => {
    setHideDisabled(v => {
      const next = !v
      try {
        localStorage.setItem('stremio-manager:hide-disabled-addons', String(next))
        triggerSync()
      } catch (e) { /* localStorage unavailable */ }
      return next
    })
  }

  const toggleAddonSelection = (addonUrl: string) => {
    setSelectedAddonUrls((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(addonUrl)) {
        newSet.delete(addonUrl)
      } else {
        newSet.add(addonUrl)
      }
      return newSet
    })
  }

  const toggleSelectionMode = () => {
    setIsSelectionMode(!isSelectionMode)
    if (isSelectionMode) {
      setSelectedAddonUrls(new Set())
    }
  }


  // Sync first, then reconcile Autopilot so a fresh Stremio pull cannot
  // re-enable backup addons after the server says a different URL is active.
  useEffect(() => {
    if (!accountId || !encryptionKey) return

    let cancelled = false
    const reconcile = async () => {
      const lastSync = account?.lastSync ? new Date(account.lastSync).getTime() : 0
      const isStale = Date.now() - lastSync > 2 * 60 * 1000
      if (isStale) {
        await syncAccount(accountId, false)
      }
      if (!cancelled) {
        await pullServerState()
      }
    }

    reconcile().catch((error) => {
      if (import.meta.env.DEV) console.warn('[AddonList] Autopilot reconciliation failed:', error)
    })

    return () => {
      cancelled = true
    }
  }, [accountId, syncAccount, encryptionKey, account?.lastSync, pullServerState])

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false)
  const [protectedInSelection, setProtectedInSelection] = useState(0)

  const handleBulkDeleteClick = () => {
    if (selectedAddonUrls.size === 0) return

    const protectedCount = addons.filter((addon, index) => {
      const compositeId = `${addon.transportUrl}::${index}`
      return selectedAddonUrls.has(compositeId) && addon.flags?.protected
    }).length

    if (selectedAddonUrls.size >= addons.length) {
      toast({ variant: 'destructive', title: 'Cannot Delete All Addons', description: 'Anti-wipe protection prevents removing every addon. Keep at least one installed to protect your addon collection.' })
      return
    }

    setProtectedInSelection(protectedCount)
    setShowDeleteConfirm(true)
  }

  const handleBulkDeleteConfirm = async () => {
    if (selectedAddonUrls.size === 0 || !account) return

    try {
      setUpdatingAll(true)

      const updatedAddons = addons.filter((_, index) => {
        const compositeId = `${addons[index].transportUrl}::${index}`
        return !selectedAddonUrls.has(compositeId)
      })
      const removedUrls = addons
        .filter((_, index) => selectedAddonUrls.has(`${addons[index].transportUrl}::${index}`))
        .map(a => a.transportUrl)

      await useAccountStore.getState().bulkDeleteAddons(accountId, updatedAddons, removedUrls)

      toast({ title: 'Addons Deleted', description: `Successfully deleted selected addons.` })
      setIsSelectionMode(false)
      setSelectedAddonUrls(new Set())
      setShowDeleteConfirm(false)
      await syncAccount(accountId)
    } catch (e) {
      const msg = (e as Error)?.message || ''
      if (msg.includes('Anti-wipe guard')) {
        toast({ variant: 'destructive', title: 'Cannot Delete All Addons', description: 'Anti-wipe protection prevents removing every addon. Keep at least one installed to protect your addon collection.' })
      } else {
        toast({ variant: 'destructive', title: 'Delete Failed', description: 'Could not delete selected addons.' })
      }
    } finally {
      setUpdatingAll(false)
    }
  }

  const handleClearAllAddons = useCallback(async () => {
    if (!account) return
    if (account?.addons?.length === 0) return
    if (!hasPlatformConnection(account)) {
      toast({ variant: 'destructive', title: 'Not available', description: 'Clear All Addons requires a platform connection.' })
      setShowClearAllConfirm(false)
      return
    }
    try {
      setUpdatingAll(true)
      await pushAddonsToPlatform(account, [], account.id, {
        allowCollectionShrink: true,
        previousCollection: account.addons,
      })
      useAccountStore.getState().reorderAddons(account.id, [])
      toast({ title: 'All Addons Cleared', description: `Removed ${account.addons.length} addons from ${account.name}.` })
      setShowClearAllConfirm(false)
      await syncAccount(account.id)
    } catch (e) {
      toast({ variant: 'destructive', title: 'Clear Failed', description: (e as Error)?.message || 'Could not clear addons.' })
      setShowClearAllConfirm(false)
    } finally {
      setUpdatingAll(false)
    }
  }, [account, syncAccount, toast])

  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [healthStatus, setHealthStatus] = useState<Record<string, HealthStatus>>({})
  const latestVersions = useAddonStore((state) => state.latestVersions)
  const library = useAddonStore(useShallow((state) => state.library))
  const installedKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const saved of Object.values(library)) {
      keys.add(`${saved.manifest.id}::${saved.installUrl}`)
    }
    return keys
  }, [library])
  const updateLatestVersions = useAccountStore((state) => state.updateLatestVersions)
  const [updatingAll, setUpdatingAll] = useState(false)
  const [showBulkAccountPicker, setShowBulkAccountPicker] = useState(false)
  const [isBulkActionLoading, setIsBulkActionLoading] = useState(false)
  const confetti = useConfetti()

  const [profileToDelete, setProfileToDelete] = useState<{ id: string, name: string } | null>(null)
  const [profileToEdit, setProfileToEdit] = useState<{ id: string, name: string } | null>(null)
  const [profileEditName, setProfileEditName] = useState('')
  const [profileEditLoading, setProfileEditLoading] = useState(false)
  const [isCreateProfileOpen, setIsCreateProfileOpen] = useState(false)

  const handleSwitchProfile = useCallback(async (targetProfileId: string) => {
    try {
      const { useAccountStore } = await import('@/store/accountStore')
      const result = await useAccountStore.getState().switchProfile(accountId, targetProfileId)
      toast({ title: 'Setup Switched', description: getProfileSwitchDescription(result) })
    } catch (err) {
      toast({ variant: 'destructive', title: 'Swap Failed', description: 'Failed to switch setup' })
    }
  }, [accountId, toast])

  const handleDeleteProfile = useCallback(async () => {
    if (!profileToDelete) return
    try {
      const { useAccountStore } = await import('@/store/accountStore')
      await useAccountStore.getState().deleteSubProfile(accountId, profileToDelete.id)
      toast({ title: 'Setup Deleted', description: `Deleted ${profileToDelete.name}` })
    } catch (err) {
      toast({ variant: 'destructive', title: 'Deletion Failed', description: 'Failed to delete setup' })
    } finally {
      setProfileToDelete(null)
    }
  }, [accountId, profileToDelete, toast])

  const handleSaveProfile = useCallback(async () => {
    if (!profileToEdit || !profileEditName.trim()) return
    setProfileEditLoading(true)
    try {
      const { useAccountStore } = await import('@/store/accountStore')
      await useAccountStore.getState().renameSubProfile(accountId, profileToEdit.id, profileEditName)
      toast({ title: 'Setup Renamed', description: `Renamed to ${profileEditName}` })
      setProfileToEdit(null)
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to rename setup', description: `Could not rename setup` })
    } finally {
      setProfileEditLoading(false)
    }
  }, [accountId, profileToEdit, profileEditName, toast])

  const handleCreateProfileConfirm = useCallback(async (name: string, clone: boolean) => {
    try {
      const { useAccountStore } = await import('@/store/accountStore')
      toast({ title: 'Creating Setup...', description: clone ? `Copying current setup to ${name}` : `Creating empty setup ${name}` })
      await useAccountStore.getState().createSubProfile(accountId, name, clone)
      confetti.fire({ particleCount: 80, spread: 70, origin: { x: 0.5, y: 0.4 } })
      toast({ title: 'Setup Created', description: `Created and switched to ${name}` })
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to create setup', description: `Could not create setup` })
    }
  }, [accountId, confetti, toast])

  const addonIndexMap = useMemo(() => {
    const map = new Map<AddonDescriptor, number>()
    addons.forEach((addon, i) => map.set(addon, i))
    return map
  }, [addons])

  const filteredAddons = useMemo(() => {
    let result = addons
    if (hideDisabled) result = result.filter(a => a.flags?.enabled !== false)
    if (!debouncedSearchQuery.trim()) return result
    const query = debouncedSearchQuery.toLowerCase()
    return result.filter((addon) =>
      addon.manifest.name?.toLowerCase().includes(query) ||
      addon.manifest.id?.toLowerCase().includes(query) ||
      addon.manifest.description?.toLowerCase().includes(query)
    )
  }, [addons, debouncedSearchQuery, hideDisabled])

  const selectAllAddons = useCallback(() => {
    const newSelected = new Set<string>()
    filteredAddons.forEach(addon => {
      const originalIndex = addonIndexMap.get(addon)
      if (originalIndex !== undefined) {
        newSelected.add(`${addon.transportUrl}::${originalIndex}`)
      }
    })
    setSelectedAddonUrls(newSelected)
  }, [filteredAddons, addonIndexMap])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement
      const isInput = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (e.key === 'Escape' && isSelectionMode) {
        setIsSelectionMode(false)
        setSelectedAddonUrls(new Set())
      }

      if ((e.key === 's' || e.key === 'S') && isSelectionMode && selectedAddonUrls.size > 0 && !bulkSaveOpen && !isInput) {
        setBulkSaveOpen(true)
      }

      if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey) && isSelectionMode) {
        e.preventDefault()
        selectAllAddons()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSelectionMode, selectedAddonUrls, bulkSaveOpen, filteredAddons, selectAllAddons])

  const updatesAvailable = useMemo(() => addons.filter((addon) => {
    const latest = getLatestAddonVersion(latestVersions, addon)
    return latest && isNewerVersion(addon.manifest.version, latest)
  }), [addons, latestVersions])

  const handleCheckUpdates = useCallback(async () => {
    if (checkingUpdates) return
    if (!account) return

    setCheckingUpdates(true)
    try {
      await syncAccount(accountId)

      await pullServerState()
      await checkRules()

      const updateInfoList = await checkAddonUpdates(addons, accountId)
      const versions: Record<string, string> = {}
      const health: Record<string, HealthStatus> = {}

      updateInfoList.forEach((info) => {
        versions[info.versionKey] = info.latestVersion
        versions[info.addonId] = info.latestVersion
        health[info.addonId] = info.health
      })
      updateLatestVersions(versions)
      setHealthStatus(prev => ({ ...prev, ...health }))

      const updatesCount = updateInfoList.filter((info) => info.hasUpdate).length
      const offlineCount = updateInfoList.filter((info) => !info.health.isOnline).length

      let description = ''
      if (updatesCount > 0) {
        description = `${updatesCount} addon${updatesCount !== 1 ? 's have' : ' has'} updates available`
      } else {
        description = 'All addons are up to date'
      }
      if (offlineCount > 0) {
        description += `. ${offlineCount} addon${offlineCount !== 1 ? 's are' : ' is'} offline`
      }

      toast({
        title: 'Refresh Complete',
        description,
      })
    } catch (error) {
      toast({
        title: 'Refresh Failed',
        description: 'Failed to refresh addons',
        variant: 'destructive',
      })
    } finally {
      setCheckingUpdates(false)
    }
  }, [account, addons, toast, updateLatestVersions, syncAccount, accountId, checkRules, pullServerState, checkingUpdates])

  const handleUpdateAddon = useCallback(
    async (_accountId: string, transportUrl: string) => {
      if (!account) return
      await useAccountStore.getState().reinstallAddon(accountId, transportUrl)
    },
    [account, accountId]
  )

  const handleProtectAll = useCallback(async () => {
    if (!account) return

    try {
      const changedCount = await useAccountStore.getState().bulkProtectAddons(accountId, true)

      toast({
        title: changedCount > 0 ? 'Addons Protected' : 'Already Protected',
        description: changedCount > 0
          ? `Protected ${changedCount} addon${changedCount !== 1 ? 's' : ''}.`
          : 'No add-ons needed to change.'
      })
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to Protect Addons',
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }, [account, accountId, toast])

  const handleUnprotectAll = useCallback(async () => {
    if (!account) return

    try {
      const changedCount = await useAccountStore.getState().bulkProtectAddons(accountId, false)

      toast({
        title: changedCount > 0 ? 'Addons Unprotected' : 'Already Unprotected',
        description: changedCount > 0
          ? `Unprotected ${changedCount} addon${changedCount !== 1 ? 's' : ''}.`
          : 'No add-ons needed to change.'
      })
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to Unprotect Addons',
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }, [account, accountId, toast])

  const handleEnableAll = useCallback(async () => {
    if (!account || addons.length === 0) return
    const allUrls = addons.map(a => a.transportUrl)
    try {
      await useAccountStore.getState().bulkToggleAddonEnabled(accountId, allUrls, true)
      toast({ title: 'All Addons Enabled', description: `Enabled ${allUrls.length} addon${allUrls.length !== 1 ? 's' : ''}.` })
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed', description: 'Could not enable addons.' })
    }
  }, [account, addons, accountId, toast])

  const handleDisableAll = useCallback(async () => {
    if (!account || addons.length === 0) return
    const allUrls = addons.map(a => a.transportUrl)
    try {
      await useAccountStore.getState().bulkToggleAddonEnabled(accountId, allUrls, false)
      toast({ title: 'All Addons Disabled', description: `Disabled ${allUrls.length} addon${allUrls.length !== 1 ? 's' : ''}.` })
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed', description: 'Could not disable addons.' })
    }
  }, [account, addons, accountId, toast])

  const handleProtectSelected = useCallback(async () => {
    if (!account || selectedAddonUrls.size === 0) return

    try {
      const urls = Array.from(selectedAddonUrls).map(extractTransportUrl)
      const changedCount = await useAccountStore.getState().bulkProtectSelectedAddons(accountId, urls, true)

      toast({
        title: changedCount > 0 ? 'Selection Protected' : 'Already Protected',
        description: changedCount > 0
          ? `Protected ${changedCount} selected addon${changedCount !== 1 ? 's' : ''}.`
          : 'No selected add-ons needed changes.'
      })
      setIsSelectionMode(false)
      setSelectedAddonUrls(new Set())
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Protection Failed',
        description: 'Could not protect selected addons.'
      })
    }
  }, [account, accountId, selectedAddonUrls, toast])

  const handleUnprotectSelected = useCallback(async () => {
    if (!account || selectedAddonUrls.size === 0) return

    try {
      const urls = Array.from(selectedAddonUrls).map(extractTransportUrl)
      const changedCount = await useAccountStore.getState().bulkProtectSelectedAddons(accountId, urls, false)

      toast({
        title: changedCount > 0 ? 'Selection Unprotected' : 'Already Unprotected',
        description: changedCount > 0
          ? `Unprotected ${changedCount} selected addon${changedCount !== 1 ? 's' : ''}.`
          : 'No selected add-ons needed changes.'
      })
      setIsSelectionMode(false)
      setSelectedAddonUrls(new Set())
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Unprotection Failed',
        description: 'Could not unprotect selected addons.'
      })
    }
  }, [account, accountId, selectedAddonUrls, toast])

  const handleBulkEnable = useCallback(async () => {
    if (!account || selectedAddonUrls.size === 0) return
    const urls = Array.from(selectedAddonUrls).map(extractTransportUrl)
    try {
      await useAccountStore.getState().bulkToggleAddonEnabled(accountId, urls, true)
      toast({ title: 'Addons Enabled', description: `Enabled ${urls.length} addon${urls.length !== 1 ? 's' : ''}.` })
      setIsSelectionMode(false)
      setSelectedAddonUrls(new Set())
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed', description: 'Could not enable addons.' })
    }
  }, [account, accountId, selectedAddonUrls, toast])

  const handleBulkDisable = useCallback(async () => {
    if (!account || selectedAddonUrls.size === 0) return
    const urls = Array.from(selectedAddonUrls).map(extractTransportUrl)
    try {
      await useAccountStore.getState().bulkToggleAddonEnabled(accountId, urls, false)
      toast({ title: 'Addons Disabled', description: `Disabled ${urls.length} addon${urls.length !== 1 ? 's' : ''}.` })
      setIsSelectionMode(false)
      setSelectedAddonUrls(new Set())
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed', description: 'Could not disable addons.' })
    }
  }, [account, accountId, selectedAddonUrls, toast])

  const searchInputRef = useRef<HTMLInputElement>(null)

  const handleCreateRule = useCallback(async () => {
    if (!account || selectedAddonUrls.size < 2) {
      toast({
        variant: 'destructive',
        title: 'Selection too small',
        description: 'Select at least 2 addons to create an autopilot chain.'
      })
      return
    }

    try {
      const urls = Array.from(selectedAddonUrls).map(extractTransportUrl)

      const { useFailoverStore } = await import('@/store/failoverStore')
      const failoverStore = useFailoverStore.getState()

      await failoverStore.addRule(accountId, urls)

      toast({
        title: 'Autopilot Rule Created',
        description: `Created a new rule with ${urls.length} addon${urls.length !== 1 ? 's' : ''}. Switching to configuration...`
      })

      setIsSelectionMode(false)
      setSelectedAddonUrls(new Set())

      setSearchParams({ tab: 'failover' }, { replace: true })

    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Rule Creation Failed',
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }, [account, accountId, selectedAddonUrls, toast, setSearchParams])

  const handleUpdateAll = useCallback(async () => {
    if (!account) return

    const addonsToUpdate = updatesAvailable.map((addon) => ({ id: addon.manifest.id, url: addon.transportUrl }))
    if (addonsToUpdate.length === 0) {
      toast({ title: 'No Updates', description: 'All addons are already up to date.' })
      return
    }

    setUpdatingAll(true)
    try {

      const { successCount } = await useAccountStore.getState().reinstallAddons(
        accountId,
        addonsToUpdate.map(item => item.url),
        ADDON_REINSTALL_CONCURRENCY
      )


      toast({
        title: 'Updates Complete',
        description: `Successfully updated ${successCount} of ${addonsToUpdate.length} addon${addonsToUpdate.length !== 1 ? 's' : ''}`,
      })
    } catch (error) {
      toast({
        title: 'Update Failed',
        description: 'Failed to update addons',
        variant: 'destructive',
      })
    } finally {
      setUpdatingAll(false)
    }
  }, [account, updatesAvailable, accountId, toast])

  const handleReinstallSelected = useCallback(async () => {
    if (!account || selectedAddonUrls.size === 0) return

    setUpdatingAll(true)
    try {
      const urls = Array.from(selectedAddonUrls).map(extractTransportUrl)
      const { successCount } = await useAccountStore.getState().reinstallAddons(
        accountId,
        urls,
        ADDON_REINSTALL_CONCURRENCY
      )

      toast({
        title: 'Reinstallation Complete',
        description: `Successfully reinstalled ${successCount} of ${urls.length} addon${urls.length !== 1 ? 's' : ''}.`,
      })

      setIsSelectionMode(false)
      setSelectedAddonUrls(new Set())
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Reinstall Failed',
        description: 'Failed to reinstall selected addons.'
      })
    } finally {
      setUpdatingAll(false)
    }
  }, [account, accountId, selectedAddonUrls, toast])

  const handleReinstallAll = useCallback(async () => {
    if (!account) return
    setUpdatingAll(true)
    try {
      const urls = addons.map(a => a.transportUrl)
      const { successCount } = await useAccountStore.getState().reinstallAddons(
        accountId,
        urls,
        ADDON_REINSTALL_CONCURRENCY
      )
      toast({
        title: 'Reinstallation Complete',
        description: `Successfully reinstalled ${successCount} of ${urls.length} addon${urls.length !== 1 ? 's' : ''}.`,
      })
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Reinstall Failed',
        description: 'Failed to reinstall addons.'
      })
    } finally {
      setUpdatingAll(false)
    }
  }, [account, accountId, addons, toast])

  const handleBulkCloneToAccounts = useCallback(async (targetAccountIds: string[]) => {
    if (targetAccountIds.length === 0 || selectedAddonUrls.size === 0) return

    setIsBulkActionLoading(true)
    let successCount = 0
    let failCount = 0

    const selectedAddonsList = addons.filter((_, index) => selectedAddonUrls.has(`${addons[index].transportUrl}::${index}`))
    const selectedAddonUrlsToInstall = selectedAddonsList.map(addon => addon.transportUrl)

    await mapConcurrent(targetAccountIds, BULK_ACCOUNT_CONCURRENCY, async (targetId) => {
      try {
        const result = await useAccountStore.getState().installAddonsToAccount(
          targetId,
          selectedAddonUrlsToInstall,
          BULK_ADDON_FETCH_CONCURRENCY
        )
        successCount += result.successCount
        failCount += result.failCount
      } catch (err) {
        if (import.meta.env.DEV) console.error(`Failed to deploy addons to ${targetId}:`, err)
        failCount += selectedAddonsList.length
      }
    })

    toast({
      title: 'Bulk Clone Complete',
      description: `Successfully processed ${successCount} installation${successCount !== 1 ? 's' : ''}. ${failCount > 0 ? `Failed: ${failCount}` : ''}`,
    })
    setIsBulkActionLoading(false)
    setShowBulkAccountPicker(false)
    setIsSelectionMode(false)
    setSelectedAddonUrls(new Set())
  }, [selectedAddonUrls, addons, toast])

  const handleBulkDeployToAll = useCallback(async () => {
    const targetAccountIds = accounts
      .filter(acc => acc.id !== accountId)
      .map(acc => acc.id)

    if (targetAccountIds.length === 0) {
      toast({
        title: 'No other accounts',
        description: 'You need at least one other account to deploy to.'
      })
      return
    }

    if (selectedAddonUrls.size === 0) return

    setIsBulkActionLoading(true)
    try {
      await handleBulkCloneToAccounts(targetAccountIds)
    } finally {
      setIsBulkActionLoading(false)
    }
  }, [accounts, accountId, selectedAddonUrls, handleBulkCloneToAccounts, toast])

  const isPrivacyModeEnabled = useUIStore((state) => state.isPrivacyModeEnabled)
  const selectedAddons = useMemo(() => {
    return addons.filter((_, index) => selectedAddonUrls.has(`${addons[index].transportUrl}::${index}`))
  }, [addons, selectedAddonUrls])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(min-width: 768px)')
    const handleViewportChange = () => setIsDesktopAddonListViewport(mediaQuery.matches)

    handleViewportChange()
    mediaQuery.addEventListener('change', handleViewportChange)

    return () => mediaQuery.removeEventListener('change', handleViewportChange)
  }, [])

  if (!account) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Account not found</p>
        <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="mt-4">
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  const accountEmail = account ? getAccountEmail(account) : undefined
  const isNameCustomized = account.name !== accountEmail && account.name !== 'Account' && account.name !== 'Stremio Account'
  const displayName =
    isPrivacyModeEnabled && !isNameCustomized
      ? account.name.includes('@')
        ? maskEmail(account.name)
        : '********'
      : account.name
  const activeProfileName = account.activeProfileId
    ? (account.profiles?.find(p => p.id === account.activeProfileId)?.name || 'Setup')
    : 'Main Setup'
  const allEnabled = selectedAddons.length > 0 && selectedAddons.every(a => a.flags?.enabled !== false)
  const allProtected = selectedAddons.length > 0 && selectedAddons.every(a => a.flags?.protected)

  const currentIndex = accounts.findIndex(a => a.id === accountId)
  const prevAccount = accounts.length > 1 ? (currentIndex > 0 ? accounts[currentIndex - 1] : accounts[accounts.length - 1]) : null
  const nextAccount = accounts.length > 1 ? (currentIndex < accounts.length - 1 ? accounts[currentIndex + 1] : accounts[0]) : null

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/')}
            className="mt-0.5 h-9 w-9 shrink-0 rounded-xl border border-border/40 bg-card text-muted-foreground shadow-sm hover:bg-muted/50 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="truncate text-2xl font-semibold tracking-tight md:text-3xl">{displayName}</h2>
              {updatesAvailable.length > 0 && (
                <span className="rounded-full bg-primary/12 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                  {updatesAvailable.length} update{updatesAvailable.length !== 1 ? 's' : ''} available
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{addons.length} installed</span>
              <span className="text-border">/</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-7 gap-1 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground">
                    <User className="h-3.5 w-3.5" />
                    <span className="truncate max-w-[140px]">{activeProfileName}</span>
                    <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56 max-w-[calc(100vw-2rem)]">
                  <DropdownMenuItem
                    className="gap-2"
                    onClick={() => handleSwitchProfile('default')}
                    disabled={!account.activeProfileId}
                  >
                    <User className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className={!account.activeProfileId ? 'font-semibold' : ''}>{'Main Setup'}</span>
                    {!account.activeProfileId && <Check className="ml-auto h-4 w-4 text-primary" />}
                  </DropdownMenuItem>
                  {(account.profiles || []).filter(p => p.id !== 'default').map(p => (
                    <div key={p.id} className="group relative">
                      <DropdownMenuItem
                        className="gap-2 pr-20 group-hover:bg-accent group-hover:text-accent-foreground"
                        onClick={() => handleSwitchProfile(p.id)}
                        disabled={account.activeProfileId === p.id}
                      >
                        <User className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className={`truncate flex-1 text-left ${account.activeProfileId === p.id ? 'font-semibold' : ''}`}>{p.name}</span>
                        {account.activeProfileId === p.id && <Check className="h-4 w-4 text-primary shrink-0" />}
                      </DropdownMenuItem>
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                        <DropdownMenuItem
                          className="h-7 w-7 p-0 flex items-center justify-center text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            setProfileEditName(p.name);
                            setProfileToEdit({ id: p.id, name: p.name });
                          }}
                          title={`Rename ${p.name}`}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="h-7 w-7 p-0 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            setProfileToDelete({ id: p.id, name: p.name });
                          }}
                          title={`Delete ${p.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </DropdownMenuItem>
                      </div>
                    </div>
                  ))}
                  <DropdownMenuItem
                    onClick={() => {
                      setIsCreateProfileOpen(true);
                    }}
                    className="gap-2 text-primary focus:text-primary"
                  >
                    <Plus className="h-4 w-4 shrink-0" />
                    Create New Setup
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {accounts.length > 1 && (
          <div className="self-end rounded-2xl border border-border/40 bg-card p-1.5 shadow-sm sm:self-auto" data-account-switcher-pill>
            <AccountSwitcher
            mode="pagination"
            accounts={accounts}
            selectedId={accountId}
            onSelect={(id) => navigate(`/account/${id}?tab=${activeTab}`)}
            onPrev={() => prevAccount && navigate(`/account/${prevAccount?.id}?tab=${activeTab}`)}
            onNext={() => nextAccount && navigate(`/account/${nextAccount?.id}?tab=${activeTab}`)}
            prevLabel={prevAccount ? `Previous: ${prevAccount.name || getAccountEmail(prevAccount)}` : undefined}
            nextLabel={nextAccount ? `Next: ${nextAccount.name || getAccountEmail(nextAccount)}` : undefined}
          />
          </div>
        )}
      </div>

      <Tabs value={activeAccountTab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList>
          <TabsTrigger value="addons" className="relative">
            Installed Addons
            {addons.length > 0 && (
              <span className="ml-2 flex h-5 min-w-5 items-center justify-center rounded-md bg-muted px-1.5 text-xs font-semibold text-muted-foreground">
                {addons.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="failover">
            Autopilot
          </TabsTrigger>
          <TabsTrigger value="changelog">
            Changelog
          </TabsTrigger>
          <TabsTrigger value="connections">
            Connections
          </TabsTrigger>
        </TabsList>

        <TabsContent value="addons" animated={false} className="space-y-4">
          <ToolbarShell contentClassName="gap-2 sm:gap-3">
            {/* Search + view toggle - grouped so they never wrap apart */}
            <div className="grid w-full grid-cols-[1fr_auto] items-center gap-2 sm:flex sm:w-auto sm:flex-none">
              <div className="relative flex-1 min-w-0 sm:min-w-[180px] sm:max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search addons..."
                  className="pl-9 pr-9 h-8 text-xs w-full bg-muted/30 border border-border/40 focus:bg-muted/40 transition-colors"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  data-search-focus
                  disabled={addons.length === 0}
                />
                {searchQuery && (
                  <button
                    onClick={() => handleSearchChange('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 hover:bg-accent rounded-full transition-colors"
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
              <div className="hidden items-center bg-muted/50 rounded-lg p-0.5 border border-border/40 gap-0.5 shrink-0 md:flex">
                <Button variant="ghost" size="sm" className={`h-8 w-8 rounded-lg p-0 ${addonListView === 'grid' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setAddonListView('grid')} aria-label="Grid view">
                  <LayoutGrid className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className={`h-8 w-8 rounded-lg p-0 ${addonListView === 'list' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setAddonListView('list')} aria-label="List view">
                  <List className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="grid w-full grid-cols-2 items-center gap-2 sm:ml-auto sm:flex sm:w-auto sm:flex-wrap sm:justify-end">

              {!isSelectionMode && (
                <>
                  <Button
                    onClick={handleCheckUpdates}
                    disabled={addons.length === 0 || checkingUpdates}
                    size="sm"
                    variant="outline"
                    className="w-full shrink-0 gap-1.5 h-8 text-xs font-medium sm:w-auto"
                  >
                    <AnimatedRefreshIcon className="h-3.5 w-3.5" isAnimating={checkingUpdates} />
                    <span>{checkingUpdates ? 'Refreshing...' : 'Refresh'}</span>
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setReorderDialogOpen(true)}
                    variant="outline"
                    className="hidden shrink-0 gap-1.5 h-8 text-xs font-medium sm:inline-flex"
                    disabled={addons.length < 2}
                  >
                    <GripVertical className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Reorder</span>
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setInstallFromLibraryOpen(true)}
                    variant="outline"
                    className="hidden shrink-0 gap-1.5 h-8 text-xs font-medium sm:flex"
                  >
                    <Library className="h-3.5 w-3.5" />
                    Library
                  </Button>
                </>
              )}
              {!isSelectionMode && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="ml-0 w-full shrink-0 gap-1.5 h-8 text-xs font-medium sm:w-auto">
                      <Layers className="h-3.5 w-3.5" />
                      <span className="sm:hidden">Actions</span>
                      <span className="hidden sm:inline">Bulk Actions</span>
                      {updatesAvailable.length > 0 && (
                        <span className="ml-1 w-4 h-4 flex items-center justify-center text-xs font-semibold bg-primary text-primary-foreground rounded-full shrink-0">
                          {updatesAvailable.length}
                        </span>
                      )}
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 max-w-[calc(100vw-2rem)]">
                    <DropdownMenuItem className="gap-2 sm:hidden" onClick={() => setInstallFromLibraryOpen(true)}>
                      <Library className="h-4 w-4" />
                      Install from Library
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="gap-2 sm:hidden"
                      onClick={() => setReorderDialogOpen(true)}
                      disabled={addons.length < 2}
                    >
                      <GripVertical className="h-4 w-4" />
                      Reorder Addons
                    </DropdownMenuItem>
                    {addons.some(a => a.flags?.enabled === false) && (
                      <DropdownMenuItem className="gap-2 sm:hidden" onClick={toggleHideDisabled}>
                        <List className="h-4 w-4" />
                        {hideDisabled ? 'Show disabled' : 'Hide disabled'}
                      </DropdownMenuItem>
                    )}
                    {updatesAvailable.length > 0 && (
                      <DropdownMenuItem className="gap-2" onClick={handleUpdateAll} disabled={updatingAll}>
                        <AnimatedUpdateIcon className="h-4 w-4" isAnimating={updatingAll} />
                        Update All ({updatesAvailable.length})
                      </DropdownMenuItem>
                    )}
                      <DropdownMenuItem className="gap-2" onClick={handleReinstallAll} disabled={updatingAll}>
                        <Zap className="h-4 w-4 text-success" />
                      Force Reinstall All
                    </DropdownMenuItem>
                      <DropdownMenuItem className="gap-2" onClick={() => setBulkSaveOpen(true)}>
                        <Save className="h-4 w-4" />
                      Save All to Library
                    </DropdownMenuItem>
                    <DropdownMenuItem className="gap-2" onClick={() => setBulkUrlReplaceOpen(true)} disabled={addons.length === 0}>
                        <Wand2 className="h-4 w-4 text-primary" />
                      Find &amp; Replace URL
                    </DropdownMenuItem>
                    {addons.some(a => !a.flags?.protected) ? (
                      <DropdownMenuItem className="gap-2" onClick={handleProtectAll}>
                        <AnimatedShieldIcon className="h-4 w-4 text-primary" />
                        Protect All
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem className="gap-2" onClick={handleUnprotectAll}>
                        <AnimatedShieldIcon className="h-4 w-4 text-muted-foreground" />
                        Unprotect All
                      </DropdownMenuItem>
                    )}
                      <DropdownMenuItem className="gap-2" onClick={handleEnableAll}>
                        <Zap className="h-4 w-4 text-success" />
                      Enable All
                    </DropdownMenuItem>
                    <DropdownMenuItem className="gap-2" onClick={handleDisableAll}>
                        <X className="h-4 w-4 text-destructive" />
                      Disable All
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="gap-2" onClick={() => setShowClearAllConfirm(true)} disabled={!hasPlatformConnection(account) || addons.length === 0}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                        Clear All Addons
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {addons.some(a => a.flags?.enabled === false) && !isSelectionMode && (
                <Button
                  size="sm"
                  onClick={toggleHideDisabled}
                  variant="outline"
                  className="hidden h-8 shrink-0 text-xs font-medium sm:flex"
                >
                  {hideDisabled ? 'Show disabled' : 'Hide disabled'}
                </Button>
              )}

              <Button
                size="sm"
                variant="outline"
                onClick={toggleSelectionMode}
                className="w-full shrink-0 gap-1.5 h-8 px-3 text-xs font-medium sm:w-auto sm:px-4"
              >
                {isSelectionMode ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                <span>{isSelectionMode ? "Cancel" : "Select"}</span>
              </Button>

              {isSelectionMode && (
                <Button
                  size="sm"
                  onClick={selectAllAddons}
                   variant="outline"
                   className="w-full shrink-0 sm:w-auto sm:flex-none h-8 gap-1.5 text-xs font-medium"
                >
                  <Check className="h-3.5 w-3.5" />
                  {selectedAddonUrls.size === filteredAddons.length && filteredAddons.length > 0 ? 'Deselect All' : 'Select All'}
                </Button>
              )}

              {!isSelectionMode && (
                <Button
                  onClick={() => openAddAddonDialog(accountId)}
                  size="sm"
                  className="w-full shrink-0 gap-1.5 h-8 text-xs font-medium sm:w-auto"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Install
                </Button>
              )}
            </div>
          </ToolbarShell>

          {addons.length === 0 ? (
            <EmptyState
              icon={<Library className="h-6 w-6" />}
              title="No addons installed"
              description="Install your first addon to start streaming. Add it from a manifest URL, or pick from your saved Library."
              action={<Button onClick={() => openAddAddonDialog(accountId)}>Install First Addon</Button>}
            />
          ) : filteredAddons.length === 0 ? (
            <EmptyState
              icon={<Search className="h-6 w-6" />}
              title="No addons match your search"
              description="Try a different keyword, or clear the search to see every installed addon."
              action={<Button variant="outline" onClick={() => setSearchQuery('')}>Clear Search</Button>}
            />
          ) : (
            <>
            <StaggerContainer className={effectiveAddonListView === 'list' ? 'flex flex-col gap-2' : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'}>
              {filteredAddons.slice(0, visibleCount).map((addon) => {
                const originalIndex = addonIndexMap.get(addon) ?? 0
                const normUrl = addon.transportUrl.toLowerCase()
                const linkedRule = linkedRuleMap.get(normUrl)
                const primaryUrl = linkedRule?.priorityChain?.[0]
                const primaryAddon = primaryUrl
                  ? addonUrlMap.get(primaryUrl.toLowerCase()) ?? null
                  : null
                const primaryRule = primaryRuleMap.get(normUrl)
                return (
                  <StaggerItem key={`${addon.transportUrl}-${originalIndex}`}>
                    <AddonCard
                      index={originalIndex}
                      addon={addon}
                      accountId={accountId}
                      accountAuthKey={account ? getStremioAuthKey(account) : ''}
                      onRemove={async () => { await removeAddonByIndex(accountId, originalIndex) }}
                      onUpdate={handleUpdateAddon}
                      latestVersion={getLatestAddonVersion(latestVersions, addon)}
                      isOnline={healthStatus[addon.manifest.id]?.isOnline}
                      healthError={healthStatus[addon.manifest.id]?.error}
                      isSelectionMode={isSelectionMode}
                      onToggleSelect={toggleAddonSelection}
                      onLongPress={(id) => { setIsSelectionMode(true); toggleAddonSelection(id) }}
                      selectionId={`${addon.transportUrl}::${originalIndex}`}
                      isSelected={selectedAddonUrls.has(`${addon.transportUrl}::${originalIndex}`)}
                      failoverPrimaryName={linkedRule && primaryAddon ? (primaryAddon.metadata?.customName || primaryAddon.manifest.name) : undefined}
                      failoverPaused={linkedRule ? !linkedRule.isActive : undefined}
                      isPrimary={!!primaryRule}
                      isPrimaryPaused={primaryRule ? !primaryRule.isActive : undefined}
                      isInstalled={installedKeys.has(`${addon.manifest.id}::${addon.transportUrl}`)}
                      compact={effectiveAddonListView === 'list'}
                    />
                  </StaggerItem>
                )
              })}
            </StaggerContainer>
            {visibleCount < filteredAddons.length && (
              <div className="flex justify-center pt-4">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setVisibleCount(prev => prev + 200)}
                  className="gap-1.5 text-xs font-medium"
                >
                  Load More ({filteredAddons.length - visibleCount} remaining)
                </Button>
              </div>
            )}
            </>
          )}
        </TabsContent>

        <TabsContent value="failover">
          <Suspense fallback={null}>
            <FailoverManager
              accountId={accountId}
              activeView={failoverViewByTab[activeTab as keyof typeof failoverViewByTab] ?? 'rules'}
              onActiveViewChange={handleFailoverViewChange}
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="changelog">
          <AddonChangelog accountId={accountId} />
        </TabsContent>

        <TabsContent value="connections">
          <div className="space-y-4">
            <ConnectionManager
              accountId={accountId}
              account={account ?? undefined}
              connections={account?.connections}
            />

          </div>
        </TabsContent>
      </Tabs>

      <AddonReorderDialog
        accountId={accountId}
        addons={addons}
        open={reorderDialogOpen}
        onOpenChange={setReorderDialogOpen}
      />



      {
        account && (
          <>
            <InstallSavedAddonDialog
              accountId={accountId}
              accountAuthKey={account ? getStremioAuthKey(account) : ''}
              open={installFromLibraryOpen}
              onOpenChange={setInstallFromLibraryOpen}
              installedAddons={addons}
            />
          </>
        )
      }

      <BulkSaveDialog
        open={bulkSaveOpen}
        onOpenChange={setBulkSaveOpen}
        addons={isSelectionMode && selectedAddonUrls.size > 0
          ? addons.filter((_, index) => selectedAddonUrls.has(`${addons[index].transportUrl}::${index}`))
          : addons}
        accountId={accountId}
        title={isSelectionMode && selectedAddonUrls.size > 0 ? `Save ${selectedAddonUrls.size} Selected` : 'Save Addons to Library'}
      />

      <BulkUrlReplaceDialog
        open={bulkUrlReplaceOpen}
        onOpenChange={setBulkUrlReplaceOpen}
        accountId={accountId}
        accountAddons={addons}
        accountName={displayName}
      />

      <AccountPickerDialog
        open={showBulkAccountPicker}
        onOpenChange={setShowBulkAccountPicker}
        title="Clone Addons"
        description="Select accounts to clone the selected addons to."
        onConfirm={handleBulkCloneToAccounts}
        confirmLabel="Clone"
      />

      <ConfirmationDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={`Delete ${selectedAddonUrls.size} Addons?`}
        description={
          <>
            Are you sure you want to delete {selectedAddonUrls.size} selected addons? This action cannot be undone.
            {protectedInSelection > 0 && (
              <p className="mt-2 p-2 bg-destructive/10 text-destructive text-xs rounded border border-destructive/20 font-medium">
                Note: This includes {protectedInSelection} protected addon{protectedInSelection !== 1 ? 's' : ''}.
              </p>
            )}
          </>
        }
        confirmText="Delete Addons"
        isDestructive={true}
        onConfirm={handleBulkDeleteConfirm}
        isLoading={updatingAll}
        disabled={updatingAll}
      />

      <ConfirmationDialog
        open={showClearAllConfirm}
        onOpenChange={setShowClearAllConfirm}
        title="Clear All Addons"
        description={`This will permanently remove all ${account?.addons.length || 0} addons from ${displayName}. This action cannot be undone.`}
        confirmText="Clear All"
        isDestructive={true}
        onConfirm={handleClearAllAddons}
        isLoading={updatingAll}
        disabled={updatingAll}
      />

      <FloatingActionBar
        open={isSelectionMode && selectedAddonUrls.size > 0}
        selectedCount={selectedAddonUrls.size}
        totalCount={filteredAddons.length}
        onClearSelection={() => { setIsSelectionMode(false); setSelectedAddonUrls(new Set()) }}
        actions={[
          {
            label: allEnabled ? 'Disable' : 'Enable',
            icon: allEnabled ? <X className="h-3.5 w-3.5 text-destructive" /> : <Zap className="h-3.5 w-3.5 text-success" />,
            onClick: allEnabled ? handleBulkDisable : handleBulkEnable,
          },
          {
            label: allProtected ? 'Unprotect' : 'Protect',
            icon: <Shield className={cn("h-3.5 w-3.5", allProtected ? "fill-primary/20 text-primary" : "")} />,
            onClick: allProtected ? handleUnprotectSelected : handleProtectSelected,
          },
          {
            label: 'Clone',
            icon: <Copy className="h-3.5 w-3.5" />,
            onClick: () => setShowBulkAccountPicker(true),
            disabled: isBulkActionLoading,
          },
          {
            label: 'Deploy to All',
            icon: <Download className="h-3.5 w-3.5" />,
            onClick: handleBulkDeployToAll,
            disabled: isBulkActionLoading,
          },
          {
            label: `Reinstall (${selectedAddonUrls.size})`,
            icon: <AnimatedUpdateIcon className="h-3.5 w-3.5" isAnimating={updatingAll} />,
            onClick: handleReinstallSelected,
            disabled: updatingAll,
          },
          {
            label: 'Save',
            icon: <Save className="h-3.5 w-3.5" />,
            onClick: () => setBulkSaveOpen(true),
          },
          ...(selectedAddonUrls.size >= 2 ? [{
            label: 'Autopilot',
            icon: <Zap className="h-3.5 w-3.5 text-warning" />,
            onClick: handleCreateRule,
            variant: 'default' as const,
          }] : []),
          {
            label: 'Delete',
            icon: <Trash2 className="h-3.5 w-3.5" />,
            onClick: handleBulkDeleteClick,
            disabled: updatingAll,
            variant: 'destructive' as const,
          },
        ]}
      />

      <ConfirmationDialog
        open={!!profileToDelete}
        onOpenChange={(open) => !open && setProfileToDelete(null)}
        title="Delete Setup?"
        description={`Are you sure you want to delete the setup "${profileToDelete?.name}"? This cannot be undone.`}
        confirmText="Delete"
        isDestructive={true}
        onConfirm={handleDeleteProfile}
      />

      <Dialog open={!!profileToEdit} onOpenChange={(open) => !open && setProfileToEdit(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Rename Setup</DialogTitle>
            <DialogDescription>
              Enter a new name for this setup.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Setup Name</Label>
              <Input
                id="profile-name"
                placeholder="e.g. Kids, Secondary, Test"
                value={profileEditName}
                onChange={(e) => setProfileEditName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveProfile()}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="subtle" onClick={() => setProfileToEdit(null)}>Cancel</Button>
            <Button onClick={handleSaveProfile} disabled={profileEditLoading || !profileEditName.trim()}>
              {profileEditLoading ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AccountSetupCreateDialog
        isOpen={isCreateProfileOpen}
        onClose={() => setIsCreateProfileOpen(false)}
        accountName={displayName}
        onConfirm={handleCreateProfileConfirm}
      />
    </div >
  )
}
