import { useCallback } from 'react'
import { useToast } from '@/hooks/use-toast'
import { useAccountStore } from '@/store/accountStore'
import type { AddonDescriptor } from '@/types/addon'

const extractTransportUrl = (id: string) => {
  const idx = id.lastIndexOf('::')
  return idx > 0 ? id.substring(0, idx) : id
}

interface AddonFlagOperationsParams {
  accountId: string
  account: unknown
  addons: AddonDescriptor[]
  selectedAddonUrls: Set<string>
  setSelectedAddonUrls: (urls: Set<string>) => void
  setIsSelectionMode: (value: boolean) => void
}

export function useAddonFlagOperations({
  accountId,
  account,
  addons,
  selectedAddonUrls,
  setSelectedAddonUrls,
  setIsSelectionMode,
}: AddonFlagOperationsParams) {
  const { toast } = useToast()

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

  const handleHideConfigureAll = useCallback(async () => {
    if (!account || addons.length === 0) return
    try {
      const changedCount = await useAccountStore.getState().bulkSetHideConfigure(accountId, true)
      toast({
        title: changedCount > 0 ? 'Configure Buttons Hidden' : 'Already Hidden',
        description: changedCount > 0
          ? `Hidden configure button on ${changedCount} addon${changedCount !== 1 ? 's' : ''}.`
          : 'No addons need changes.'
      })
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed',
        description: error instanceof Error ? error.message : 'Could not hide configure buttons.'
      })
    }
  }, [account, accountId, addons.length, toast])

  const handleShowConfigureAll = useCallback(async () => {
    if (!account || addons.length === 0) return
    try {
      const changedCount = await useAccountStore.getState().bulkSetHideConfigure(accountId, false)
      toast({
        title: changedCount > 0 ? 'Configure Buttons Shown' : 'Already Visible',
        description: changedCount > 0
          ? `Shown configure button on ${changedCount} addon${changedCount !== 1 ? 's' : ''}.`
          : 'No addons need changes.'
      })
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed',
        description: error instanceof Error ? error.message : 'Could not show configure buttons.'
      })
    }
  }, [account, accountId, addons.length, toast])

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
  }, [account, accountId, selectedAddonUrls, toast, setSelectedAddonUrls, setIsSelectionMode])

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
  }, [account, accountId, selectedAddonUrls, toast, setSelectedAddonUrls, setIsSelectionMode])

  const handleHideConfigureSelected = useCallback(async () => {
    if (!account || selectedAddonUrls.size === 0) return
    try {
      const urls = Array.from(selectedAddonUrls).map(extractTransportUrl)
      const changedCount = await useAccountStore.getState().bulkSetHideConfigureSelected(accountId, urls, true)
      toast({
        title: changedCount > 0 ? 'Configure Button Hidden' : 'Already Hidden',
        description: changedCount > 0
          ? `Hidden configure button on ${changedCount} addon${changedCount !== 1 ? 's' : ''}.`
          : 'No selected addons needed changes.'
      })
      setIsSelectionMode(false)
      setSelectedAddonUrls(new Set())
    } catch (error) {
      toast({ variant: 'destructive', title: 'Failed', description: error instanceof Error ? error.message : 'Could not hide configure buttons.' })
    }
  }, [account, accountId, selectedAddonUrls, toast, setSelectedAddonUrls, setIsSelectionMode])

  const handleShowConfigureSelected = useCallback(async () => {
    if (!account || selectedAddonUrls.size === 0) return
    try {
      const urls = Array.from(selectedAddonUrls).map(extractTransportUrl)
      const changedCount = await useAccountStore.getState().bulkSetHideConfigureSelected(accountId, urls, false)
      toast({
        title: changedCount > 0 ? 'Configure Button Shown' : 'Already Visible',
        description: changedCount > 0
          ? `Shown configure button on ${changedCount} addon${changedCount !== 1 ? 's' : ''}.`
          : 'No selected addons needed changes.'
      })
      setIsSelectionMode(false)
      setSelectedAddonUrls(new Set())
    } catch (error) {
      toast({ variant: 'destructive', title: 'Failed', description: error instanceof Error ? error.message : 'Could not show configure buttons.' })
    }
  }, [account, accountId, selectedAddonUrls, toast, setSelectedAddonUrls, setIsSelectionMode])

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
  }, [account, accountId, selectedAddonUrls, toast, setSelectedAddonUrls, setIsSelectionMode])

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
  }, [account, accountId, selectedAddonUrls, toast, setSelectedAddonUrls, setIsSelectionMode])

  return {
    handleUpdateAddon,
    handleProtectAll,
    handleUnprotectAll,
    handleHideConfigureAll,
    handleShowConfigureAll,
    handleEnableAll,
    handleDisableAll,
    handleProtectSelected,
    handleUnprotectSelected,
    handleHideConfigureSelected,
    handleShowConfigureSelected,
    handleBulkEnable,
    handleBulkDisable,
  }
}
