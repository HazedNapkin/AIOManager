import { useMemo } from 'react'
import { getHealthSummary } from '@/lib/addon-health'
import { getLatestAddonVersion, isNewerVersion, normalizeAddonUrl } from '@/lib/utils'
import type { StremioAccount } from '@/types/account'
import type { Profile } from '@/types/profile'
import type { AccountAddonState, SavedAddon, SavedAddonManifestChangeSummary } from '@/types/saved-addon'

export interface SavedAddonDeploymentSummary {
  deployedAccounts: StremioAccount[]
}

interface UseSavedAddonLibraryDataOptions {
  library: Record<string, SavedAddon>
  getAllTags: () => string[]
  profiles: Profile[]
  accountStates: Record<string, AccountAddonState>
  accounts: StremioAccount[]
  selectedProfileId: string | null
  selectedTag: string | null
  debouncedSearchQuery: string
  latestVersions: Record<string, string>
  manifestChangeHints: Record<string, SavedAddonManifestChangeSummary>
}

function getSafeAddonUrlKey(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null

  try {
    return normalizeAddonUrl(value)
  } catch {
    return null
  }
}

export function useSavedAddonLibraryData({
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
}: UseSavedAddonLibraryDataOptions) {
  const savedAddons = useMemo(() => Object.values(library), [library])
  const allTags = getAllTags()

  const filteredAddons = useMemo(() => {
    let filtered = savedAddons

    if (debouncedSearchQuery) {
      const query = debouncedSearchQuery.toLowerCase()
      filtered = filtered.filter(
        (addon) =>
          addon.name.toLowerCase().includes(query) ||
          addon.tags.some((tag) => tag.toLowerCase().includes(query)) ||
          (typeof addon.installUrl === 'string' && addon.installUrl.toLowerCase().includes(query))
      )
    }

    if (selectedProfileId === 'unassigned') {
      filtered = filtered.filter((addon) => !addon.profileId || !profiles.some(p => p.id === addon.profileId))
    } else if (selectedProfileId) {
      filtered = filtered.filter((addon) => addon.profileId === selectedProfileId)
    }

    if (selectedTag) {
      filtered = filtered.filter((addon) => addon.tags.includes(selectedTag))
    }

    return filtered.sort((a, b) => a.name.localeCompare(b.name))
  }, [savedAddons, debouncedSearchQuery, selectedTag, selectedProfileId, profiles])

  const healthSummary = useMemo(() => {
    return getHealthSummary(savedAddons)
  }, [savedAddons])

  const updatesCount = useMemo(() => {
    return savedAddons.filter(addon => {
      const latest = getLatestAddonVersion(latestVersions, {
        transportUrl: addon.installUrl,
        manifest: addon.manifest,
      })
      return (latest && isNewerVersion(addon.manifest.version, latest)) || manifestChangeHints[addon.id]?.hasManifestShapeChange
    }).length
  }, [savedAddons, latestVersions, manifestChangeHints])

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const addon of savedAddons) {
      for (const tag of addon.tags) {
        counts[tag] = (counts[tag] || 0) + 1
      }
    }
    return counts
  }, [savedAddons])

  const profileAddonCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const addon of savedAddons) {
      if (addon.profileId) {
        counts[addon.profileId] = (counts[addon.profileId] || 0) + 1
      }
    }
    return counts
  }, [savedAddons])

  const unassignedCount = useMemo(() => {
    return savedAddons.filter(a => !a.profileId || !profiles.some(p => p.id === a.profileId)).length
  }, [savedAddons, profiles])

  const deploymentSummaryByAddonId = useMemo(() => {
    const accountById = new Map(accounts.map(account => [account.id, account]))
    const libraryIds = new Set(savedAddons.map(addon => addon.id))
    const addonIdsByUrl = new Map<string, string[]>()

    for (const addon of savedAddons) {
      const key = getSafeAddonUrlKey(addon.installUrl)
      if (!key) continue
      const existing = addonIdsByUrl.get(key)
      if (existing) existing.push(addon.id)
      else addonIdsByUrl.set(key, [addon.id])
    }

    const accountIdsByAddonId = new Map<string, Set<string>>()

    for (const accountState of Object.values(accountStates)) {
      const account = accountById.get(accountState.accountId)
      if (!account) continue

      const matchedAddonIds = new Set<string>()

      for (const installedAddon of accountState.installedAddons) {
        if (installedAddon.savedAddonId && libraryIds.has(installedAddon.savedAddonId)) {
          matchedAddonIds.add(installedAddon.savedAddonId)
        }

        const installedUrlKey = getSafeAddonUrlKey(installedAddon.installUrl)
        if (!installedUrlKey) continue

        const idsByUrl = addonIdsByUrl.get(installedUrlKey)
        if (idsByUrl) {
          idsByUrl.forEach(id => matchedAddonIds.add(id))
        }
      }

      matchedAddonIds.forEach(addonId => {
        const existing = accountIdsByAddonId.get(addonId)
        if (existing) existing.add(account.id)
        else accountIdsByAddonId.set(addonId, new Set([account.id]))
      })
    }

    const summaries: Record<string, SavedAddonDeploymentSummary> = {}
    for (const addon of savedAddons) {
      const deployedAccounts = Array.from(accountIdsByAddonId.get(addon.id) ?? [])
        .map(accountId => accountById.get(accountId))
        .filter((account): account is StremioAccount => Boolean(account))

      summaries[addon.id] = { deployedAccounts }
    }

    return summaries
  }, [accountStates, accounts, savedAddons])

  const syncOverviewData = useMemo(() => {
    const syncingAddons = savedAddons.filter(a => {
      const matchesSync = a.syncWithInstalled
      if (!matchesSync) return false

      if (selectedProfileId === 'unassigned') {
        return !a.profileId || !profiles.some(p => p.id === a.profileId)
      }
      if (selectedProfileId) {
        return a.profileId === selectedProfileId
      }
      return true
    })

    if (syncingAddons.length === 0) return []

    const results = syncingAddons.map(savedAddon => ({
      addon: savedAddon,
      deployedAccounts: deploymentSummaryByAddonId[savedAddon.id]?.deployedAccounts ?? [],
    }))

    return results.filter(item => item.deployedAccounts.length > 0)
  }, [deploymentSummaryByAddonId, savedAddons, selectedProfileId, profiles])

  const notSyncingDeployed = useMemo(() => {
    return savedAddons
      .filter(a => {
        if (a.syncWithInstalled) return false
        if (selectedProfileId === 'unassigned') {
          return !a.profileId || !profiles.some(p => p.id === a.profileId)
        }
        if (selectedProfileId) {
          return a.profileId === selectedProfileId
        }
        return true
      })
      .flatMap(addon => {
        const deployedAccounts = deploymentSummaryByAddonId[addon.id]?.deployedAccounts ?? []
        if (deployedAccounts.length === 0) return []
        return [{ addon, deployedAccounts }]
      })
  }, [deploymentSummaryByAddonId, savedAddons, selectedProfileId, profiles])

  return {
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
  }
}
