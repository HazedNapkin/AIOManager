import { useCallback, useState } from 'react'
import { toast } from '@/hooks/use-toast'
import { useAddonStore } from '@/store/addonStore'
import { getStremioAuthKey } from '@/store/accountStore'
import type { MergeResult, SavedAddon } from '@/types/saved-addon'

interface BulkEditData {
  tags?: string[]
  tagsRemove?: string[]
  profileId?: string | null
  syncWithInstalled?: boolean
}

interface UseSavedAddonSelectionActionsOptions {
  filteredAddons: SavedAddon[]
  library: Record<string, SavedAddon>
}

function getDeploymentSummary(details: Array<{ result: MergeResult }>) {
  const totals = details.reduce(
    (acc, detail) => ({
      added: acc.added + detail.result.added.length,
      removed: acc.removed + (detail.result.removed?.length || 0),
      updated: acc.updated + detail.result.updated.length,
      skipped: acc.skipped + detail.result.skipped.length,
      protected: acc.protected + detail.result.protected.length,
    }),
    { added: 0, removed: 0, updated: 0, skipped: 0, protected: 0 }
  )

  const parts = []
  if (totals.added > 0) parts.push(`${totals.added} installed`)
  if (totals.removed > 0) parts.push(`${totals.removed} removed`)
  if (totals.updated > 0) parts.push(`${totals.updated} refreshed`)
  if (totals.skipped > 0) parts.push(`${totals.skipped} skipped`)
  if (totals.protected > 0) parts.push(`${totals.protected} protected`)

  return parts.length > 0 ? parts.join(', ') : 'No addon changes were needed'
}

export function useSavedAddonSelectionActions({
  filteredAddons,
  library,
}: UseSavedAddonSelectionActionsOptions) {
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkEditDialog, setShowBulkEditDialog] = useState(false)
  const [showBulkDeleteConfirmation, setShowBulkDeleteConfirmation] = useState(false)
  const [showAccountPicker, setShowAccountPicker] = useState(false)
  const [showRemoveAccountPicker, setShowRemoveAccountPicker] = useState(false)


  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setIsSelectionMode(false)
  }, [])

  const closeDeployFlow = useCallback(() => {
    clearSelection()
    setShowAccountPicker(false)
  }, [clearSelection])

  const closeRemoveFlow = useCallback(() => {
    clearSelection()
    setShowRemoveAccountPicker(false)
  }, [clearSelection])

  const enterSelectionMode = useCallback(() => {
    setIsSelectionMode(true)
  }, [])

  const toggleSelectionMode = useCallback(() => {
    setIsSelectionMode((prev) => {
      if (prev) {
        setSelectedIds(new Set())
        return false
      }
      return true
    })
  }, [])

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    const allIds = filteredAddons.map(a => a.id)
    setSelectedIds(prev => prev.size === allIds.length ? new Set() : new Set(allIds))
  }, [filteredAddons])



  const handleRemoveFromAccounts = useCallback(async (accountIds: string[]) => {
    if (selectedIds.size === 0 || accountIds.length === 0) {
      closeRemoveFlow()
      return
    }

    try {
      const { useAccountStore } = await import('@/store/accountStore')
      const accountStore = useAccountStore.getState()
      const targetAccounts = accountIds.map(accountId => {
        const account = accountStore.accounts.find(a => a.id === accountId)
        return account ? { id: account.id, authKey: getStremioAuthKey(account) } : null
      }).filter(Boolean) as { id: string, authKey: string }[]

      if (targetAccounts.length === 0) {
        closeRemoveFlow()
        return
      }

      const addonUrls = Array.from(selectedIds)
        .map(id => library[id]?.installUrl)
        .filter(Boolean) as string[]

      if (addonUrls.length === 0) {
        closeRemoveFlow()
        return
      }

      const result = await useAddonStore.getState().bulkRemoveAddons(addonUrls, targetAccounts, false)
      const removalSummary = getDeploymentSummary(result.details)

      if (result.failed === 0) {
        toast({
          title: 'Removal Complete',
          description: `${removalSummary} across ${result.success} account${result.success !== 1 ? 's' : ''}.`,
        })
      } else {
        toast({
          title: 'Removal Completed with Errors',
          description: `${removalSummary}. Succeeded: ${result.success}, failed: ${result.failed}.`,
          variant: 'destructive',
        })
      }

      closeRemoveFlow()
    } catch (err) {
      toast({
        title: 'Removal Failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }, [selectedIds, library, closeRemoveFlow])

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return

    await useAddonStore.getState().bulkDeleteSavedAddons(Array.from(selectedIds))

    toast({
      title: 'Bulk Delete Complete',
      description: `Deleted ${selectedIds.size} saved addon${selectedIds.size !== 1 ? 's' : ''}.`,
    })

    setIsSelectionMode(false)
    setSelectedIds(new Set())
    setShowBulkDeleteConfirmation(false)
  }, [selectedIds])

  const handleBulkEdit = useCallback(async (data: BulkEditData) => {
    if (selectedIds.size === 0) return

    const updates: Partial<SavedAddon> & { tagsRemove?: string[] } = {}
    if (data.tags) {
      updates.tags = data.tags
    }
    if (data.tagsRemove) {
      updates.tagsRemove = data.tagsRemove
    }
    if (data.profileId !== undefined) {
      updates.profileId = data.profileId === null ? undefined : data.profileId
    }
    if (data.syncWithInstalled !== undefined) {
      updates.syncWithInstalled = data.syncWithInstalled
    }

    await useAddonStore.getState().bulkUpdateSavedAddons(Array.from(selectedIds), updates)

    toast({
      title: 'Bulk Update Complete',
      description: `Updated ${selectedIds.size} addon${selectedIds.size !== 1 ? 's' : ''}.`,
    })

    setIsSelectionMode(false)
    setSelectedIds(new Set())
    setShowBulkEditDialog(false)
  }, [selectedIds])

  const handleDeployToAccounts = useCallback(async (accountIds: string[]) => {
    if (selectedIds.size === 0 || accountIds.length === 0) {
      closeDeployFlow()
      return
    }

    try {
      const { useAccountStore } = await import('@/store/accountStore')
      const accountStore = useAccountStore.getState()

      const targetAccounts = accountIds.map(id => {
        const account = accountStore.accounts.find(a => a.id === id)
        return account ? { id: account.id, authKey: getStremioAuthKey(account) } : null
      }).filter(Boolean) as { id: string, authKey: string }[]

      if (targetAccounts.length === 0) {
        closeDeployFlow()
        return
      }

      const result = await useAddonStore.getState().bulkApplySavedAddons(
        Array.from(selectedIds),
        targetAccounts,
        true
      )
      const deploymentSummary = getDeploymentSummary(result.details)

      if (result.failed === 0) {
        toast({
          title: 'Deployment Complete',
          description: `${deploymentSummary} across ${result.success} account${result.success !== 1 ? 's' : ''}.`,
        })
      } else {
        const firstError = result.errors[0]?.error || ''
        toast({
          title: 'Deployment Completed with Errors',
          description: `${deploymentSummary}. Succeeded: ${result.success}, failed: ${result.failed}.${firstError ? ` Error: ${firstError}` : ''}`,
          variant: 'destructive',
        })
      }

      closeDeployFlow()
    } catch (err) {
      toast({
        title: 'Deployment Failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }, [selectedIds, closeDeployFlow])

  return {
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
  }
}
