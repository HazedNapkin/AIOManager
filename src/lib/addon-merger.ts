import { AddonDescriptor } from '@/types/addon'
import { SavedAddon, MergeResult } from '@/types/saved-addon'
import { fetchAddonManifest } from '@/api/addons'
import { normalizeAddonUrl } from './utils'
import { getCachedManifest, setCachedManifest } from '@/lib/manifest-cache'
import { mapConcurrent } from './concurrency'
import { dedupeAddonsByTransportUrl } from '@/lib/addon-dedupe'
import { getAddonInstanceKey } from '@/lib/addon-instance-identity'
import { getEffectiveManifest } from '@/lib/addon-utils'

export async function mergeAddons(
  currentAddons: AddonDescriptor[],
  savedAddons: SavedAddon[],
  accountId: string = 'Unknown',
  allowProtected: boolean = false
): Promise<{ addons: AddonDescriptor[]; result: MergeResult }> {
  const result: MergeResult = {
    added: [],
    updated: [],
    skipped: [],
    protected: [],
  }

  const updatedAddons = [...currentAddons]

  await mapConcurrent(savedAddons, 5, async (savedAddon) => {
    const installUrl = savedAddon.installUrl
    // mergeAddons runs once per target account; without this guard a deploy to A
    // accounts re-fetches every manifest A times and exhausts the meta-proxy rate
    // limit. The 10-min TTL cache the merge loop reads from is authority enough.
    if (getCachedManifest(installUrl)) return
    try {
      const fresh = await fetchAddonManifest(installUrl, accountId)
      if (fresh?.manifest?.id && fresh?.manifest?.name && fresh?.manifest?.version) {
        setCachedManifest(installUrl, fresh.manifest)
      }
    } catch {}
  })

  for (const savedAddon of savedAddons) {
    const addonId = savedAddon.manifest.id
    const installUrl = savedAddon.installUrl

    // This handles the backward compatibility case where customName wasn't set in metadata
    // We check against savedAddon.manifest.name because that's the baseline the user renamed FROM
    const effectiveMetadata = { ...savedAddon.metadata }
    if (!effectiveMetadata.customName && savedAddon.name && savedAddon.name !== savedAddon.manifest.name) {
      effectiveMetadata.customName = savedAddon.name
    }

    // This prevents duplicates if the URL protocol/trailing-slash changed.
    // Instance-key fallback: deploying a saved config-URL addon (AIOStreams,
    // AIOMetadata) whose encrypted config segment changed must REPLACE the
    // same-instance entry in place ("reinstall in its own spot"), not append a
    // second card. Distinct instance uuids/origins keep distinct keys, so
    // multiple instances of one manifest id are still never collapsed.
    const normInstallUrl = normalizeAddonUrl(installUrl)
    const savedInstanceKey = getAddonInstanceKey({ transportUrl: installUrl, manifest: savedAddon.manifest })
    const existingIndex = updatedAddons.findIndex((a) => {
      const normA = normalizeAddonUrl(a.transportUrl)
      // STRICT: Match ONLY by URL (or instance key) to support multiple instances of same Manifest ID
      return normA === normInstallUrl || getAddonInstanceKey(a) === savedInstanceKey
    })

    if (existingIndex >= 0) {
      const existing = updatedAddons[existingIndex]

      if (existing.flags?.protected && !allowProtected) {
        result.protected.push({
          addonId,
          name: existing.manifest.name,
        })
        continue
      }

      const cached = getCachedManifest(installUrl)
      const manifestToApply = (cached?.id && cached?.name && cached?.version)
        ? cached
        : savedAddon.manifest

      const updatedDescriptor: AddonDescriptor = {
        transportUrl: installUrl,
        manifest: manifestToApply,
        flags: existing.flags,
        metadata: { ...existing.metadata, ...effectiveMetadata },
        catalogOverrides: savedAddon.catalogOverrides || existing.catalogOverrides,
        note: existing.note,
      }

      updatedAddons[existingIndex] = updatedDescriptor
      result.updated.push({
        addonId,
        oldUrl: existing.transportUrl,
        newUrl: installUrl,
      })
    } else {
      const cached = getCachedManifest(installUrl)
      const manifestToApply = (cached?.id && cached?.name && cached?.version)
        ? cached
        : savedAddon.manifest

      const newDescriptor: AddonDescriptor = {
        transportUrl: installUrl,
        manifest: manifestToApply,
        metadata: effectiveMetadata,
        catalogOverrides: savedAddon.catalogOverrides,
      }

      updatedAddons.push(newDescriptor)

      result.added.push({
        addonId,
        name: manifestToApply.name,
        installUrl: installUrl,
      })
    }
  }

  const merged = dedupeAddonsByTransportUrl(updatedAddons)
    .map(addon => ({ ...addon, manifest: getEffectiveManifest(addon) }))
    .filter(addon => addon.manifest?.id && addon.manifest?.name && addon.manifest?.version)

  return { addons: merged, result }
}

export function removeAddons(
  currentAddons: AddonDescriptor[],
  idsOrUrls: string[],
  allowProtected: boolean = false
): {
  addons: AddonDescriptor[]
  removed: string[]
  protectedAddons: string[]
} {
  const removed: string[] = []
  const protectedAddons: string[] = []

  const updatedAddons = currentAddons.filter((addon) => {
    const normA = normalizeAddonUrl(addon.transportUrl)
    const shouldRemove = idsOrUrls.some(target => {
      // If target looks like a URL, match ONLY by URL to support multiple instances of same manifest ID
      if (target.includes('://') || target.startsWith('stremio://')) {
        const normTarget = normalizeAddonUrl(target)
        return normA === normTarget
      }
      return addon.manifest.id === target || normA === normalizeAddonUrl(target)
    })

    if (shouldRemove) {
      if (addon.flags?.protected && !allowProtected) {
        protectedAddons.push(addon.manifest.id)
        return true
      }

      removed.push(addon.manifest.id)
      return false
    }

    return true
  })

  return { addons: updatedAddons, removed, protectedAddons }
}


