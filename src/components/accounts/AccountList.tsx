import { Button } from '@/components/ui/button'
import type { SavedAddonManifestChangeSummary } from '@/types/saved-addon'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAccounts } from '@/hooks/useAccounts'
import { useUIStore } from '@/store/uiStore'
import { useFailoverStore } from '@/store/failoverStore'
import { AlertCircle, Search, Trash2, RefreshCw, Users, GripHorizontal, X, Layers, Check, ChevronDown, ArrowUpCircle, Loader2, LayoutGrid, List, Plus, History } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useState, useRef, useMemo, useCallback, lazy, Suspense, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { AccountCard } from './AccountCard'
import { StaggerContainer, StaggerItem } from '@/components/ui/stagger'
const BatchOperationsDialog = lazy(() => import('./BatchOperationsDialog').then(m => ({ default: m.BatchOperationsDialog })))
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { SquircleOverlay } from '@/components/ui/squircle-overlay'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { useToast } from '@/hooks/use-toast'
import { EmptyState } from '@/components/common/EmptyState'
import { FloatingActionBar } from '@/components/ui/floating-action-bar'
import { ToolbarShell } from '@/components/ui/toolbar-shell'
import { AnimatedRefreshIcon } from '@/components/ui/AnimatedIcons'
import { checkAddonUpdates } from '@/api/addons'
import { useAddonStore } from '@/store/addonStore'
import { getLatestAddonVersion, isNewerVersion } from '@/lib/utils'
import { getPlatformEntry } from '@/lib/platform-registry'
import { useAccountStore, getStremioAuthKey, getAccountEmail, hasPlatformConnection } from '@/store/accountStore'
import { useScrollRestoration } from '@/hooks/use-scroll-restoration'

import { Skeleton } from '@/components/ui/skeleton'
import { AccountListRow } from './AccountListRow'
import { AccountReorderDialog } from './AccountReorderDialog'

export function AccountList() {
  useScrollRestoration('accounts')
  const openAddAccountDialog = useUIStore((state) => state.openAddAccountDialog)
  const { accounts, error, clearError, syncAllAccounts, removeAccount, loading } = useAccounts()
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [refreshMenuOpen, setRefreshMenuOpen] = useState(false)
  const { toast } = useToast()

  const handleCheckAllAddonUpdates = async () => {
    if (checkingUpdates) return
    setCheckingUpdates(true)
    try {
      // Collect all addons across all accounts and deduplicate by transportUrl
      // globally to avoid hitting the same addon server multiple times (429 bursts)
      const seenUrls = new Set<string>()
      const allAddons = accounts.flatMap(account => account.addons).filter(addon => {
        if (seenUrls.has(addon.transportUrl)) return false
        seenUrls.add(addon.transportUrl)
        return true
      })

      const updateInfoList = await checkAddonUpdates(allAddons, 'All-Accounts-Update-Check')
      const versions: Record<string, string> = {}
      const hints: Record<string, SavedAddonManifestChangeSummary> = {}
      updateInfoList.forEach((info) => {
        versions[info.versionKey] = info.latestVersion
        versions[info.addonId] = info.latestVersion
        if (info.hasManifestShapeChange && info.manifestChanges) {
          hints[info.versionKey] = info.manifestChanges
          hints[info.addonId] = info.manifestChanges
        }
      })
      useAddonStore.getState().updateLatestVersions(versions)
      useAddonStore.getState().updateManifestChangeHints(hints)
      toast({ title: 'Update Check Complete', description: 'All account addons have been checked for updates.' })
    } catch (err) {
      toast({ title: 'Update Check Failed', variant: 'destructive' })
    } finally {
      setCheckingUpdates(false)
    }
  }

  const latestVersions = useAddonStore((state) => state.latestVersions)

  const totalUpdateCount = useMemo(() =>
    accounts.reduce((total, account) =>
      total + account.addons.filter(addon => {
        const latest = getLatestAddonVersion(latestVersions, addon)
        return latest && isNewerVersion(addon.manifest.version, latest)
      }).length,
      0),
    [accounts, latestVersions])

  const totalChangelogCount = useAccountStore(
    useShallow((state) => state.changelog.filter(
      e => Date.now() - new Date(e.timestamp).getTime() < 24 * 60 * 60 * 1000
    ).length)
  )

  const [updatingAll, setUpdatingAll] = useState(false)

  const handleUpdateAll = async () => {
    if (updatingAll) return
    setUpdatingAll(true)
    try {
      const updatableUrls = new Set<string>()
      const accountsWithUpdates: { id: string; authKey: string }[] = []

      for (const account of accounts) {
        const addonsToUpdate = account.addons.filter(addon => {
          const latest = getLatestAddonVersion(latestVersions, addon)
          return latest && isNewerVersion(addon.manifest.version, latest)
        })
        if (addonsToUpdate.length > 0) {
          accountsWithUpdates.push({ id: account.id, authKey: getStremioAuthKey(account) })
          addonsToUpdate.forEach(a => updatableUrls.add(a.transportUrl))
        }
      }

      if (updatableUrls.size === 0) {
        toast({ title: 'No Updates', description: 'All addons are up to date.' })
        return
      }

      const result = await useAddonStore.getState().bulkReinstallAddons(
        Array.from(updatableUrls),
        accountsWithUpdates,
        true
      )

      toast({
        title: 'Updates Complete',
        description: `Updated ${result.success} account${result.success !== 1 ? 's' : ''}${result.failed > 0 ? ` (${result.failed} failed)` : ''}`,
      })
    } catch (err) {
      toast({ title: 'Update Failed', variant: 'destructive' })
    } finally {
      setUpdatingAll(false)
    }
  }

  const handleClearAllChangelog = async () => {
    try {
      await useAccountStore.getState().clearChangelog()
      toast({ title: 'Notifications Cleared', description: 'All changelog notifications have been dismissed.' })
    } catch {
      toast({ title: 'Clear Failed', variant: 'destructive' })
    }
  }

  const handleSearchChange = (val: string) => {
    setSearchQuery(val)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearchQuery(val)
    }, 150)
  }

  const [showBulkActions, setShowBulkActions] = useState(false)
  const [reorderDialogOpen, setReorderDialogOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    open: boolean;
    accountIds: string[];
  }>({ open: false, accountIds: [] })

  const deleteConfirmationDetails = useMemo(() => {
    return deleteConfirmation.accountIds.map(id => {
      const account = accounts.find(a => a.id === id)
      return account ? { name: account.name || getAccountEmail(account) || 'Unknown', addonCount: account.addons.length } : null
    }).filter(Boolean)
  }, [deleteConfirmation.accountIds, accounts])

  const totalAddonsInDeletion = deleteConfirmationDetails.reduce((sum, d) => sum + (d?.addonCount || 0), 0)

  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const isPrivacyModeEnabled = useUIStore((state) => state.isPrivacyModeEnabled)
  const accountsView = useUIStore((state) => state.accountsView)
  const setAccountsView = useUIStore((state) => state.setAccountsView)
  const expiredAccounts = useMemo(() => accounts.filter(account => account.status === 'expired'), [accounts])
  const isSessionExpiredError = error ? /session does not exist|session.*expired|invalid.*auth|auth.*expired|unauthorized/i.test(error) : false
  const firstExpiredAccount = expiredAccounts[0]
  const expiredPlatformLabel = useMemo(() => {
    const names = new Set<string>()
    for (const account of expiredAccounts) {
      const failing = (account.connections || []).filter(c => c.status === 'expired' || c.status === 'error')
      if (failing.length === 0) {
        names.add(hasPlatformConnection(account) ? 'Stremio' : 'Account')
      } else {
        for (const c of failing) names.add(getPlatformEntry(c.platform)?.name || c.platform)
      }
    }
    return names.size === 1 ? [...names][0] : null
  }, [expiredAccounts])

  const toggleAccountSelection = useCallback((accountId: string) => {
    setSelectedAccountIds((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(accountId)) {
        newSet.delete(accountId)
      } else {
        newSet.add(accountId)
      }
      return newSet
    })
  }, [])

  const toggleSelectionMode = () => {
    const nextSelectionMode = !(isSelectionMode || selectedAccountIds.size > 0)
    setIsSelectionMode(nextSelectionMode)
    if (!nextSelectionMode) {
      setSelectedAccountIds(new Set())
    }
  }

  const selectAll = () => {
    if (selectedAccountIds.size === accounts.length) {
      setSelectedAccountIds(new Set())
    } else {
      setSelectedAccountIds(new Set(accounts.map((a) => a.id)))
    }
  }

  const clearSelection = () => {
    setSelectedAccountIds(new Set())
  }

  const handleDeleteSingle = useCallback((accountId: string) => {
    setDeleteConfirmation({ open: true, accountIds: [accountId] })
  }, [])

  const handleDeleteSelected = () => {
    setDeleteConfirmation({
      open: true,
      accountIds: Array.from(selectedAccountIds)
    })
  }

  const confirmDelete = async () => {
    const ids = deleteConfirmation.accountIds
    await Promise.all(ids.map(id => removeAccount(id)))
    setDeleteConfirmation({ open: false, accountIds: [] })
    clearSelection()
  }



  const filteredAccounts = useMemo(() => {
    const query = debouncedSearchQuery.toLowerCase().trim()
    if (!query) return accounts
    return accounts.filter(a => {
      if (a.name.toLowerCase().includes(query)) return true
      if (getAccountEmail(a)?.toLowerCase().includes(query)) return true
      if (a.status === 'expired' && 'expired'.includes(query)) return true
      if (a.status === 'error' && ('error'.includes(query) || 'failed'.includes(query))) return true
      if (a.connections?.some(c => c.platform.toLowerCase().includes(query))) return true
      if (hasPlatformConnection(a) && 'stremio'.includes(query)) return true
      return false
    })
  }, [accounts, debouncedSearchQuery])

  const checkRules = useFailoverStore((state) => state.checkRules)
  const isSelectionActive = isSelectionMode || selectedAccountIds.size > 0

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !isSelectionActive) {
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isSelectionActive])

  const handleRefreshAll = async () => {
    await syncAllAccounts()
    await checkRules()
  }

  if (loading && accounts.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center animate-in fade-in slide-in-from-bottom-4">
        <div className="relative w-20 h-20 flex items-center justify-center mb-6">
          <SquircleOverlay />
          <Users className="relative z-10 h-9 w-9 text-muted-foreground" />
        </div>
        <h2 className="text-3xl font-bold tracking-tight mb-2">No accounts connected</h2>
        <p className="text-muted-foreground max-w-sm mb-8">
          Manage all your streaming platforms from a single dashboard. Securely add your first account to get started.
        </p>
        <Button size="lg" onClick={() => openAddAccountDialog()} className="px-8">
          Add Account
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className={`${isSessionExpiredError ? 'border-warning/35 bg-warning/10 text-warning' : 'border-destructive/35 bg-destructive/10 text-destructive'} rounded-xl border px-4 py-3`}>
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-semibold">
                {isSessionExpiredError ? (expiredPlatformLabel ? `${expiredPlatformLabel} session expired` : 'Session expired') : 'Account sync failed'}
              </p>
              <p className="text-xs opacity-85">
                {isSessionExpiredError
                  ? (expiredPlatformLabel
                    ? `${expiredPlatformLabel} rejected a stored token. Re-authenticate this account to refresh it.`
                    : 'Session tokens were rejected. Re-authenticate the affected accounts to refresh them.')
                  : error}
              </p>
              {isSessionExpiredError && firstExpiredAccount && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    openAddAccountDialog(firstExpiredAccount)
                  }}
                  className="mt-2 h-8 border-warning/35 bg-background/60 text-warning hover:bg-warning/10"
                >
                  Fix {expiredAccounts.length > 1 ? `${expiredAccounts.length} expired accounts` : 'expired account'}
                </Button>
              )}
            </div>
            <button onClick={clearError} className="rounded-full p-1 opacity-70 transition-opacity hover:opacity-100" aria-label="Dismiss account error">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {isSessionExpiredError && !firstExpiredAccount && (
            <p className="mt-2 text-xs opacity-75">If this keeps appearing, run Refresh and re-authenticate any account that changes to Session expired.</p>
          )}
        </div>
      )}


      <ToolbarShell contentClassName="gap-2 sm:gap-3">

        <div className="grid w-full grid-cols-[1fr_auto] items-center gap-2 sm:flex sm:w-auto sm:flex-none">
          <div className="relative flex-1 sm:w-72 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Search accounts..."
              className="pl-9 pr-9 h-8 text-xs bg-muted/30 border border-border/40 focus:bg-muted/40 transition-colors w-full"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              data-search-focus
            />
            {searchQuery && (
              <button
                onClick={() => handleSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 hover:bg-accent rounded-full transition-colors focus:outline-none"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
          <div className="flex items-center bg-muted/50 rounded-lg p-0.5 border border-border/40 gap-0.5 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 w-8 rounded-lg p-0 ${accountsView === 'grid' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setAccountsView('grid')}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 w-8 rounded-lg p-0 ${accountsView === 'list' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setAccountsView('list')}
              aria-label="List view"
            >
              <List className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>


        <div className="grid w-full grid-cols-2 items-center gap-2 sm:ml-auto sm:flex sm:w-auto sm:flex-wrap shrink-0">
          {!isSelectionActive && (
            <>
              <DropdownMenu open={refreshMenuOpen || checkingUpdates} onOpenChange={(o) => { if (!checkingUpdates) setRefreshMenuOpen(o) }}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5 h-8 text-xs font-medium sm:w-auto"
                    disabled={loading || accounts.length === 0}
                  >
                    <AnimatedRefreshIcon className="h-3.5 w-3.5" isAnimating={loading} />
                    <span>Refresh</span>
                    <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" collisionPadding={16} className="w-64 max-w-[calc(100vw-2rem)] p-1.5">
                  <DropdownMenuItem
                    onClick={handleRefreshAll}
                    disabled={loading}
                    className="py-2.5 px-3 rounded-lg gap-2 text-sm font-medium"
                  >
                    <RefreshCw className={`h-4 w-4 shrink-0 ${loading ? 'animate-spin' : ''}`} />
                    Refresh Addon Lists
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleCheckAllAddonUpdates}
                    disabled={checkingUpdates}
                    onSelect={(e) => e.preventDefault()}
                    className="py-2.5 px-3 rounded-lg gap-2 text-sm font-medium"
                  >
                    {checkingUpdates
                      ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                      : <ArrowUpCircle className="h-4 w-4 shrink-0" />
                    }
                    {checkingUpdates ? 'Checking for updates...' : 'Check for Addon Updates'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {totalUpdateCount > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleUpdateAll}
                  disabled={updatingAll}
                  className="order-first col-span-full w-full gap-1.5 h-8 text-xs font-medium sm:order-none sm:col-span-auto sm:w-auto sm:flex-none"
                >
                  {updatingAll
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <ArrowUpCircle className="h-3.5 w-3.5" />
                  }
                  {updatingAll ? 'Updating...' : `Update All (${totalUpdateCount})`}
                </Button>
              )}

              {totalChangelogCount > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleClearAllChangelog}
                  className="w-full gap-1.5 h-8 text-xs font-medium sm:w-auto"
                >
                  <History className="h-3.5 w-3.5" />
                  Clear All ({totalChangelogCount})
                </Button>
              )}
              {accounts.length >= 2 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 h-8 text-xs font-medium sm:w-auto"
                  onClick={() => setReorderDialogOpen(true)}
                >
                  <GripHorizontal className="h-3.5 w-3.5" />
                  <span>Reorder</span>
                </Button>
              )}
            </>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={toggleSelectionMode}
            className={`ml-0 w-full gap-1.5 h-8 text-xs font-medium ${isSelectionActive ? 'col-span-full' : ''} sm:w-auto sm:col-span-auto`}
          >
            {isSelectionActive ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
            <span>{isSelectionActive ? 'Cancel' : 'Select'}</span>
          </Button>
          {!isSelectionActive && (
            <Button size="sm" className="w-full gap-1.5 h-8 text-xs font-medium sm:w-auto" onClick={() => openAddAccountDialog()}>
              <Plus className="h-3.5 w-3.5" />
              <span className="sm:hidden">Add</span>
              <span className="hidden sm:inline">Add Account</span>
            </Button>
          )}
        </div>
      </ToolbarShell>


      <FloatingActionBar
        open={selectedAccountIds.size > 0}
        selectedCount={selectedAccountIds.size}
        totalCount={accounts.length}
        onClearSelection={() => { setSelectedAccountIds(new Set()); setIsSelectionMode(false) }}
        actions={[
          {
            label: selectedAccountIds.size === accounts.length ? 'Deselect All' : 'Select All',
            onClick: selectAll,
            variant: 'outline',
            icon: <Check className="h-4 w-4" />,
            tooltip: selectedAccountIds.size === accounts.length ? 'Deselect all accounts' : 'Select all accounts',
          },
          {
            label: 'Bulk Actions',
            onClick: () => setShowBulkActions(true),
            variant: 'outline',
            icon: <Layers className="h-4 w-4" />,
            tooltip: 'Open bulk actions',
          },
          {
            label: `Delete (${selectedAccountIds.size})`,
            onClick: handleDeleteSelected,
            variant: 'destructive',
            icon: <Trash2 className="h-4 w-4" />,
            tooltip: 'Delete selected accounts',
          },
        ]}
      />

      {accountsView === 'list' ? (
        <div className="flex flex-col gap-2">
          {filteredAccounts.length === 0 && searchQuery ? (
            <EmptyState
              className="animate-in fade-in zoom-in-95"
              icon={<Search className="text-muted-foreground" />}
              title="No accounts found"
              description={`No matches for "${searchQuery}"`}
              action={
                <Button variant="link" onClick={() => handleSearchChange('')}>
                  Clear search
                </Button>
              }
            />
          ) : (
            filteredAccounts.map((account) => (
              <AccountListRow
                key={account.id}
                account={account}
                isPrivacyMode={isPrivacyModeEnabled}
                isSelected={selectedAccountIds.has(account.id)}
                isSelectionMode={isSelectionActive}
                onToggleSelect={toggleAccountSelection}
                onDelete={handleDeleteSingle}
              />
            ))
          )}
        </div>
      ) : (
        <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAccounts.length === 0 && searchQuery ? (
            <EmptyState
              className="col-span-full animate-in fade-in zoom-in-95"
              icon={<Search className="text-muted-foreground" />}
              title="No accounts found"
              description={`No matches for "${searchQuery}"`}
              action={
                <Button variant="link" onClick={() => handleSearchChange('')}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <>
              {filteredAccounts.map((account) => (
                <StaggerItem key={account.id}>
                  <AccountCard
                    account={account}
                    isSelected={selectedAccountIds.has(account.id)}
                    onToggleSelect={toggleAccountSelection}
                    onLongPress={toggleAccountSelection}
                    onDelete={handleDeleteSingle}
                    isSelectionMode={isSelectionActive}
                    isPrivacyMode={isPrivacyModeEnabled}
                  />
                </StaggerItem>
              ))}
            </>
          )}
        </StaggerContainer>
      )}

      <AccountReorderDialog
        accounts={accounts}
        open={reorderDialogOpen}
        onOpenChange={setReorderDialogOpen}
        isPrivacyMode={isPrivacyModeEnabled}
      />


      <Dialog open={showBulkActions} onOpenChange={setShowBulkActions}>
        <DialogContent className="max-h-[92vh] max-w-5xl flex flex-col overflow-hidden p-0 gap-0">
          <DialogHeader className="px-6 pb-2 pt-6 pr-16 sm:pr-6">
            <DialogTitle className="text-2xl tracking-tight">Bulk Actions</DialogTitle>
            <DialogDescription>
              Apply installs, syncs, removals, and protection changes across selected accounts.
            </DialogDescription>
          </DialogHeader>
          <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
            <BatchOperationsDialog
              selectedAccounts={accounts.filter((a) => selectedAccountIds.has(a.id))}
              allAccounts={accounts}
              onClose={() => {
                setShowBulkActions(false)
                clearSelection()
              }}
            />
          </Suspense>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={deleteConfirmation.open}
        onOpenChange={(open) => setDeleteConfirmation(prev => ({ ...prev, open }))}
        title={`Delete ${deleteConfirmation.accountIds.length > 1 ? `${deleteConfirmation.accountIds.length} Accounts` : 'Account'}`}
        description={`Are you sure you want to delete ${deleteConfirmation.accountIds.length > 1 ? 'these accounts' : 'this account'}?${totalAddonsInDeletion > 0 ? ` This will also remove ${totalAddonsInDeletion} addon${totalAddonsInDeletion !== 1 ? 's' : ''}.` : ''} This action cannot be undone.`}
        confirmText="Delete"
        isDestructive={true}
        isLoading={loading}
        onConfirm={confirmDelete}
        impactItems={deleteConfirmationDetails.map((d) => d ? `${d.name} (${d.addonCount} addon${d.addonCount !== 1 ? 's' : ''})` : '')}
      />
    </div>
  )
}
