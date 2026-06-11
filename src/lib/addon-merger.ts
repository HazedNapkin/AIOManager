import { AddonDescriptor } from '@/types/addon'
import { SavedAddon, MergeResult } from '@/types/saved-addon'
import { fetchAddonManifest } from '@/api/addons'
import { normalizeAddonUrl } from './utils'
import { getCachedManifest, setCachedManifest } from '@/lib/manifest-cache'
import { mapConcurrent } from './concurrency'
import { dedupeAddonsByTransportUrl } from '@/lib/addon-dedupe'

/**
 * Addon Merger
 *
 * Implements smart merging logic for applying saved addons to accounts.
 */

/**
 * Merge addons into an account's addon collection
 *
 * @param currentAddons - The account's current addon collection
 * @param savedAddons - Saved addons to apply
 * @returns Updated addon collection and merge result
 */
async function getManifestWithCache(installUrl: string, accountId: string): Promise<any> {
  const cached = getCachedManifest(installUrl)
  if (cached) return cached
  const { manifest } = await fetchAddonManifest(installUrl, accountId)
  setCachedManifest(installUrl, manifest)
  return manifest
}

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

  const urlsToFetch = [...new Set(savedAddons.filter(s => !s.manifest).map(s => s.installUrl))]
  if (urlsToFetch.length > 0) {
    await mapConcurrent(urlsToFetch, 5, async (url) => {
      try { await getManifestWithCache(url, accountId) } catch { /* best effort; loop handles misses */ }
    })
  }

  for (const savedAddon of savedAddons) {
    const addonId = savedAddon.manifest.id
    const installUrl = savedAddon.installUrl

    // This handles the backward compatibility case where customName wasn't set in metadata
    // We check against savedAddon.manifest.name because that's the baseline the user renamed FROM
    const effectiveMetadata = { ...savedAddon.metadata }
    if (!effectiveMetadata.customName && savedAddon.name && savedAddon.name !== savedAddon.manifest.name) {
      effectiveMetadata.customName = savedAddon.name
    }

    // This prevents duplicates if the URL protocol/trailing-slash changed
    const normInstallUrl = normalizeAddonUrl(installUrl)
    const existingIndex = updatedAddons.findIndex((a) => {
      const normA = normalizeAddonUrl(a.transportUrl)
      // STRICT: Match ONLY by URL to support multiple instances of same Manifest ID
      return normA === normInstallUrl
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

      try {
        const manifestToApply = savedAddon.manifest || (await getManifestWithCache(installUrl, accountId))

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
      } catch (error) {
        if (import.meta.env.DEV) console.warn(`[Merger] Update fetch failed for ${savedAddon.name}, keeping current/cached`, error)

        updatedAddons[existingIndex] = {
          ...updatedAddons[existingIndex],
          metadata: effectiveMetadata
        }

        result.skipped.push({
          addonId,
          reason: 'fetch-failed',
        })
      }
    } else {
      try {
        const manifestToApply = savedAddon.manifest || (await getManifestWithCache(installUrl, accountId))

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
      } catch (error) {
        if (import.meta.env.DEV) console.warn(`[Merger] Fresh fetch failed for ${savedAddon.name}, using cached`, error)

        updatedAddons.push({
          transportUrl: installUrl,
          manifest: savedAddon.manifest,
          metadata: effectiveMetadata
        })

        result.added.push({
          addonId,
          name: savedAddon.manifest.name,
          installUrl,
        })
      }
    }
  }

  return { addons: dedupeAddonsByTransportUrl(updatedAddons), result }
}

/**
 * Remove addons from an account's collection
 *
 * @param currentAddons - The account's current addon collection
 * @param idsOrUrls - Addon IDs or transport URLs to remove
 * @param allowProtected - If true, protected addons will also be removed
 * @returns Updated addon collection and list of removed addons
 */
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
    // Check if the addon's ID OR its transport URL is in the removal list
    const normA = normalizeAddonUrl(addon.transportUrl)
    const shouldRemove = idsOrUrls.some(target => {
      // If target looks like a URL, match ONLY by URL to support multiple instances of same manifest ID
      if (target.includes('://') || target.startsWith('stremio://')) {
        const normTarget = normalizeAddonUrl(target)
        return normA === normTarget
      }
      // Otherwise match by ID (legacy/bulk ID removal)
      return addon.manifest.id === target || normA === normalizeAddonUrl(target)
    })

    if (shouldRemove) {
      // Don't remove protected addons unless explicitly allowed
      if (addon.flags?.protected && !allowProtected) {
        protectedAddons.push(addon.manifest.id)
        return true // Keep it
      }

      removed.push(addon.manifest.id)
      return false // Remove it
    }

    return true // Keep it
  })

  return { addons: updatedAddons, removed, protectedAddons }
}


