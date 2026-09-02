import { useCallback, useState } from 'react'
import { useToast } from '@/hooks/use-toast'
import { useConfetti } from '@/components/ui/confetti'
import type { AddonCollectionDiff } from '@/lib/addon-collection-diff'

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

export function useProfileOperations(accountId: string) {
  const { toast } = useToast()
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

  return {
    profileToDelete,
    setProfileToDelete,
    profileToEdit,
    setProfileToEdit,
    profileEditName,
    setProfileEditName,
    profileEditLoading,
    isCreateProfileOpen,
    setIsCreateProfileOpen,
    handleSwitchProfile,
    handleDeleteProfile,
    handleSaveProfile,
    handleCreateProfileConfirm,
  }
}
