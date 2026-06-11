import { useCallback, useState } from 'react'
import { toast } from '@/hooks/use-toast'
import { useAddonStore } from '@/store/addonStore'
import { getLatestAddonVersion, isNewerVersion } from '@/lib/utils'
import type { SavedAddon, SavedAddonManifestChangeSummary } from '@/types/saved-addon'

interface SyncDeploymentItem {
  addon: SavedAddon
}

interface UseSavedAddonSyncActionsOptions {
  syncOverviewData: SyncDeploymentItem[]
  latestVersions: Record<string, string>
  manifestChangeHints: Record<string, SavedAddonManifestChangeSummary>
}

export function useSavedAddonSyncActions({
  syncOverviewData,
  latestVersions,
  manifestChangeHints,
}: UseSavedAddonSyncActionsOptions) {
  const updateSavedAddonManifest = useAddonStore(state => state.updateSavedAddonManifest)
  const updateSavedAddon = useAddonStore(state => state.updateSavedAddon)
  const [syncFilter, setSyncFilter] = useState<'all' | 'outOfSync'>('all')
  const [pushingUpdates, setPushingUpdates] = useState(false)
  const [enablingSyncIds, setEnablingSyncIds] = useState<Set<string>>(new Set())
  const [disablingSyncIds, setDisablingSyncIds] = useState<Set<string>>(new Set())

  const handlePushAllSyncUpdates = useCallback(async () => {
    setPushingUpdates(true)
    let updated = 0
    try {
      const toUpdate = syncOverviewData.filter(({ addon }) => {
        const latest = getLatestAddonVersion(latestVersions, {
          transportUrl: addon.installUrl,
          manifest: addon.manifest,
        })
        return (latest && isNewerVersion(addon.manifest.version, latest)) || manifestChangeHints[addon.id]?.hasManifestShapeChange
      })
      for (const { addon } of toUpdate) {
        await updateSavedAddonManifest(addon.id)
        updated++
      }
      toast({ title: 'Updates Pushed', description: `Pushed ${updated} addon update${updated !== 1 ? 's' : ''} to all deployed accounts.` })
    } catch {
      toast({ variant: 'destructive', title: 'Push Failed', description: 'Some updates could not be pushed.' })
    } finally {
      setPushingUpdates(false)
    }
  }, [syncOverviewData, latestVersions, manifestChangeHints, updateSavedAddonManifest])

  const handlePushSyncAddonUpdate = useCallback(async (addon: SavedAddon) => {
    setPushingUpdates(true)
    try {
      await updateSavedAddonManifest(addon.id)
      toast({ title: 'Update Pushed' })
    } catch {
      toast({ variant: 'destructive', title: 'Push Failed' })
    } finally {
      setPushingUpdates(false)
    }
  }, [updateSavedAddonManifest])

  const handleDisableSync = useCallback(async (addon: SavedAddon) => {
    if (disablingSyncIds.has(addon.id)) return
    const displayName = addon.metadata?.customName || addon.name
    setDisablingSyncIds(prev => { const next = new Set(prev); next.add(addon.id); return next })
    try {
      await updateSavedAddon(addon.id, { syncWithInstalled: false })
      toast({ title: 'Sync Disabled', description: `${displayName} will no longer sync to installed accounts.` })
    } catch {
      toast({ variant: 'destructive', title: 'Failed', description: 'Could not disable sync.' })
    } finally {
      setDisablingSyncIds(prev => { const next = new Set(prev); next.delete(addon.id); return next })
    }
  }, [disablingSyncIds, updateSavedAddon])

  const handleEnableSync = useCallback(async (addon: SavedAddon) => {
    if (enablingSyncIds.has(addon.id)) return
    const displayName = addon.metadata?.customName || addon.name
    setEnablingSyncIds(prev => { const next = new Set(prev); next.add(addon.id); return next })
    try {
      await updateSavedAddon(addon.id, { syncWithInstalled: true })
      toast({ title: 'Sync Enabled', description: `${displayName} will now sync to installed accounts.` })
    } catch {
      toast({ variant: 'destructive', title: 'Failed', description: 'Could not enable sync.' })
    } finally {
      setEnablingSyncIds(prev => { const next = new Set(prev); next.delete(addon.id); return next })
    }
  }, [enablingSyncIds, updateSavedAddon])

  return {
    syncFilter,
    setSyncFilter,
    pushingUpdates,
    enablingSyncIds,
    disablingSyncIds,
    handlePushAllSyncUpdates,
    handlePushSyncAddonUpdate,
    handleDisableSync,
    handleEnableSync,
  }
}
