import { normalizeAddonUrl } from '@/lib/utils'
import type { AddonDescriptor } from '@/types/addon'

export type AddonCollectionDiffAction = 'install' | 'remove' | 'update'

export interface AddonCollectionDiff {
  installs: number
  removals: number
  updates: number
  unchanged: number
  orderChanged: boolean
  hasChanges: boolean
  previewRows: Array<{
    key: string
    name: string
    logo?: string
    action: AddonCollectionDiffAction
  }>
}

export function getAddonCollectionKey(addon: AddonDescriptor) {
  return normalizeAddonUrl(addon.transportUrl)
}

function getStableAddonMetadata(metadata: AddonDescriptor['metadata']) {
  if (!metadata) return null

  const stableMetadata = {
    customName: metadata.customName,
    customLogo: metadata.customLogo,
    customDescription: metadata.customDescription,
    cinemetaConfig: metadata.cinemetaConfig,
  }

  return Object.values(stableMetadata).some(value => value !== undefined)
    ? stableMetadata
    : null
}

export function getStableAddonFingerprint(addon: AddonDescriptor) {
  return JSON.stringify({
    transportUrl: getAddonCollectionKey(addon),
    manifest: {
      id: addon.manifest.id,
      name: addon.manifest.name,
      version: addon.manifest.version,
    },
    flags: addon.flags || null,
    metadata: getStableAddonMetadata(addon.metadata),
    catalogOverrides: addon.catalogOverrides || null,
    note: addon.note || null,
  })
}

export function getAddonCollectionDisplayName(addon: AddonDescriptor) {
  return addon.metadata?.customName || addon.manifest.name || addon.manifest.id || 'Unknown addon'
}

export function getAddonCollectionLogo(addon: AddonDescriptor) {
  return addon.metadata?.customLogo || addon.manifest.logo
}

function hasOrderChanged(currentAddons: AddonDescriptor[], targetAddons: AddonDescriptor[]) {
  if (currentAddons.length !== targetAddons.length) return false

  return currentAddons.some((addon, index) => (
    getAddonCollectionKey(addon) !== getAddonCollectionKey(targetAddons[index])
  ))
}

export function buildAddonCollectionDiff(currentAddons: AddonDescriptor[], targetAddons: AddonDescriptor[]): AddonCollectionDiff {
  const currentByUrl = new Map(currentAddons.map(addon => [getAddonCollectionKey(addon), addon]))
  const targetByUrl = new Map(targetAddons.map(addon => [getAddonCollectionKey(addon), addon]))
  const previewRows: AddonCollectionDiff['previewRows'] = []
  let installs = 0
  let removals = 0
  let updates = 0
  let unchanged = 0

  targetByUrl.forEach((targetAddon, key) => {
    const currentAddon = currentByUrl.get(key)
    if (!currentAddon) {
      installs += 1
      previewRows.push({
        key,
        name: getAddonCollectionDisplayName(targetAddon),
        logo: getAddonCollectionLogo(targetAddon),
        action: 'install',
      })
      return
    }

    if (getStableAddonFingerprint(currentAddon) !== getStableAddonFingerprint(targetAddon)) {
      updates += 1
      previewRows.push({
        key,
        name: getAddonCollectionDisplayName(targetAddon),
        logo: getAddonCollectionLogo(targetAddon),
        action: 'update',
      })
      return
    }

    unchanged += 1
  })

  currentByUrl.forEach((currentAddon, key) => {
    if (targetByUrl.has(key)) return
    removals += 1
    previewRows.push({
      key,
      name: getAddonCollectionDisplayName(currentAddon),
      logo: getAddonCollectionLogo(currentAddon),
      action: 'remove',
    })
  })

  const orderChanged = installs === 0 && removals === 0 && hasOrderChanged(currentAddons, targetAddons)
  const hasChanges = installs > 0 || removals > 0 || updates > 0 || orderChanged

  return {
    installs,
    removals,
    updates,
    unchanged,
    orderChanged,
    hasChanges,
    previewRows: previewRows.slice(0, 6),
  }
}
