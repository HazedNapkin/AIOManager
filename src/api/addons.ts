import { AddonDescriptor, AddonManifest } from '@/types/addon'
import { stremioClient } from './stremio-client'
import { checkAddonHealth, HealthStatus, isLocalOrPrivateUrl } from '@/lib/addon-health'
import { getAddonVersionKey, isNewerVersion, normalizeAddonUrl } from '@/lib/utils'
import { getEffectiveManifest } from '@/lib/addon-utils'
import { getPendingFetch, setPendingFetch } from '@/lib/manifest-cache'
import { getHostnameIdentifier, identifyAddon } from '@/lib/addon-identifier'
import { dedupeAddonsByTransportUrl, getAddonUrlKey } from '@/lib/addon-dedupe'
import { compareManifestShape } from '@/lib/addon-manifest-diff'
import { shouldBlockShrink } from '@/lib/shrink-guard'
import type { SavedAddonManifestChangeSummary } from '@/types/saved-addon'

const KNOWN_DEAD_DOMAINS = ['opensubtitles.strem.io']
const MAX_ADDON_COLLECTION_SIZE = 250

function isKnownDeadDomain(url: string): boolean {
  try {
    return KNOWN_DEAD_DOMAINS.includes(new URL(url).hostname)
  } catch {
    return false
  }
}

const knownAddonCounts = new Map<string, number>()

const addonCollectionCache = new Map<string, { data: AddonDescriptor[], ts: number }>()
const addonCollectionPending = new Map<string, { version: number; promise: Promise<AddonDescriptor[]> }>()
const addonCollectionVersions = new Map<string, number>()
const COLLECTION_CACHE_TTL = 60000

interface UpdateAddonOptions {
  bypassEmptyGuard?: boolean
  allowCollectionShrink?: boolean
  previousCollection?: AddonDescriptor[]
}

export async function getAddons(authKey: string, accountContext: string = 'Unknown'): Promise<AddonDescriptor[]> {
  const cached = addonCollectionCache.get(authKey)
  if (cached && Date.now() - cached.ts < COLLECTION_CACHE_TTL) {
    return cached.data
  }
  const version = addonCollectionVersions.get(authKey) || 0
  const pending = addonCollectionPending.get(authKey)
  if (pending && pending.version === version) {
    return pending.promise
  }

  const promise = (async () => {
    const addons = await stremioClient.getAddonCollection(authKey, accountContext)
    const knownCount = knownAddonCounts.get(authKey) || 0
    if (knownCount > 0 && addons.length < Math.ceil(knownCount * 0.25)) {
      if (cached?.data?.length) {
        if (import.meta.env.DEV) console.warn(`[AddonCollection] Suspicious collection shrink (${knownCount} → ${addons.length}); using cached last-good collection.`)
        return cached.data
      }
      throw new Error(`Safety guard: suspicious addon collection shrink detected (${knownCount} → ${addons.length}).`)
    }
    if ((addonCollectionVersions.get(authKey) || 0) === version) {
      if (addons.length > 0) {
        knownAddonCounts.set(authKey, addons.length)
      }
      addonCollectionCache.set(authKey, { data: addons, ts: Date.now() })
    }
    return addons
  })()

  addonCollectionPending.set(authKey, { version, promise })
  try {
    return await promise
  } finally {
    const current = addonCollectionPending.get(authKey)
    if (current?.promise === promise) {
      addonCollectionPending.delete(authKey)
    }
  }
}

function invalidateAddonCache(authKey: string) {
  addonCollectionVersions.set(authKey, (addonCollectionVersions.get(authKey) || 0) + 1)
  addonCollectionCache.delete(authKey)
  addonCollectionPending.delete(authKey)
}

function prepareAddonForStremio(addon: AddonDescriptor): AddonDescriptor {
  const effectiveManifest = getEffectiveManifest(addon)
  const identifiedManifest = identifyAddon(addon.transportUrl, effectiveManifest)
  const fallbackName = getHostnameIdentifier(addon.transportUrl)
  const manifest: AddonManifest = {
    ...identifiedManifest,
    id: identifiedManifest.id || 'unknown',
    name: identifiedManifest.name || fallbackName || 'Unknown Addon',
    version: identifiedManifest.version || '0.0.0',
    description: identifiedManifest.description || '',
    types: identifiedManifest.types || [],
    resources: identifiedManifest.resources || [],
  }

  if (effectiveManifest.catalogs) {
    manifest.catalogs = effectiveManifest.catalogs.map(catalog => ({
      ...catalog,
      extra: catalog.extra?.map(extra => ({ ...extra })),
    }))
  }

  return {
    transportUrl: addon.transportUrl,
    manifest
  }
}

function prepareAddonCollectionForStremio(addons: AddonDescriptor[]): AddonDescriptor[] {
  return dedupeAddonsByTransportUrl(
    (addons || [])
      .filter(addon => addon.flags?.enabled !== false)
      .map(prepareAddonForStremio)
  )
}

function validatePreparedAddon(addon: AddonDescriptor): string | null {
  if (!addon || typeof addon !== 'object') return 'Addon entry is not an object'
  if (!addon.transportUrl) return 'Addon is missing transport URL'
  try {
    const parsed = new URL(normalizeAddonUrl(addon.transportUrl))
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'Addon URL must use HTTP or HTTPS'
  } catch {
    return 'Addon has an invalid transport URL'
  }

  if (!addon.manifest?.id || !addon.manifest?.name || !addon.manifest?.version) {
    return 'Addon manifest is missing required fields'
  }

  return null
}

export async function updateAddons(authKey: string, addons: AddonDescriptor[], accountContext: string = 'Unknown', options?: UpdateAddonOptions): Promise<void> {
  const preparedAddons = prepareAddonCollectionForStremio(addons || [])
  const invalidAddons = preparedAddons
    .map((addon, index) => ({ addon, index, reason: validatePreparedAddon(addon) }))
    .filter((result): result is { addon: AddonDescriptor; index: number; reason: string } => Boolean(result.reason))

  if (invalidAddons.length > 0) {
    const firstInvalid = invalidAddons[0]
    throw new Error(`Safety guard: refusing to push invalid addon collection. Entry ${firstInvalid.index + 1}: ${firstInvalid.reason}`)
  }

  if (preparedAddons.length > MAX_ADDON_COLLECTION_SIZE) {
    throw new Error(`Safety guard: refusing to push ${preparedAddons.length} addons. Limit is ${MAX_ADDON_COLLECTION_SIZE}.`)
  }

  const allowCollectionShrink = options?.allowCollectionShrink || options?.bypassEmptyGuard
  const knownCount = knownAddonCounts.get(authKey) || 0
  const shrinkDecision = shouldBlockShrink(preparedAddons.length, knownCount, !!allowCollectionShrink)
  if (shrinkDecision.blocked && shrinkDecision.reason === 'empty') {
    throw new Error(`Anti-wipe guard: refusing to push empty addon collection (${knownCount} addon${knownCount !== 1 ? 's' : ''} previously seen)`)
  }
  if (shrinkDecision.blocked && shrinkDecision.reason === 'shrink') {
    throw new Error(`Anti-wipe guard: refusing to shrink addon collection from ${knownCount} to ${preparedAddons.length}.`)
  }

  const cachedBeforeUpdate = addonCollectionCache.get(authKey)
  const optionPreviousCollection = options?.previousCollection
    ? prepareAddonCollectionForStremio(options.previousCollection)
    : undefined
  const previousCollection = cachedBeforeUpdate && Date.now() - cachedBeforeUpdate.ts < COLLECTION_CACHE_TTL
    ? cachedBeforeUpdate.data
    : optionPreviousCollection && optionPreviousCollection.length > 0
      ? optionPreviousCollection
      : undefined
  invalidateAddonCache(authKey)
  await stremioClient.setAddonCollection(authKey, preparedAddons, accountContext, { allowCollectionShrink, previousCollection })

  if (preparedAddons.length > 0 || allowCollectionShrink) {
    knownAddonCounts.set(authKey, preparedAddons.length)
    addonCollectionCache.set(authKey, { data: preparedAddons, ts: Date.now() })
  }
}


export async function installAddon(authKey: string, addonUrl: string, accountContext: string = 'Unknown'): Promise<AddonDescriptor[]> {
  const [newAddon, currentAddons] = await Promise.all([
    fetchAddonManifest(addonUrl, accountContext),
    getAddons(authKey, accountContext),
  ])

  // Check if addon already installed (by transportUrl to support duplicates with same ID)
  const newAddonUrlKey = getAddonUrlKey(newAddon.transportUrl)
  const existingIndex = currentAddons.findIndex(
    (addon) => getAddonUrlKey(addon.transportUrl) === newAddonUrlKey
  )

  let updatedAddons: AddonDescriptor[]

  if (existingIndex >= 0) {
    updatedAddons = [...currentAddons]
    const existing = currentAddons[existingIndex]
    updatedAddons[existingIndex] = {
      ...newAddon,
      flags: { ...existing.flags, ...newAddon.flags },
      metadata: { ...existing.metadata, ...newAddon.metadata },
      catalogOverrides: existing.catalogOverrides,
    }
  } else {
    updatedAddons = [...currentAddons, newAddon]
  }

  await updateAddons(authKey, updatedAddons, accountContext)

  return updatedAddons
}

export async function removeAddon(authKey: string, transportUrl: string, accountContext: string = 'Unknown'): Promise<AddonDescriptor[]> {
  const currentAddons = await getAddons(authKey, accountContext)

  const addonToRemove = currentAddons.find((addon) => addon.transportUrl === transportUrl)
  if (addonToRemove?.flags?.protected) {
    throw new Error(`Addon "${addonToRemove.manifest.name}" is protected and cannot be removed.`)
  }

  const updatedAddons = currentAddons.filter((addon) => addon.transportUrl !== transportUrl)

  await updateAddons(authKey, updatedAddons, accountContext)

  return updatedAddons
}

export async function fetchAddonManifest(url: string, accountContext: string = 'Unknown', force: boolean = false): Promise<AddonDescriptor> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch (error) {
    throw new Error(`Invalid addon URL: ${url}`);
  }

  await acquireDomainSlot(origin)
  try {
    return await stremioClient.fetchAddonManifest(url, accountContext, force)
  } finally {
    releaseDomainSlot(origin)
  }
}

export async function reinstallAddon(
  authKey: string,
  transportUrl: string,
  accountContext: string = 'Unknown'
): Promise<{
  addons: AddonDescriptor[]
  updatedAddon: AddonDescriptor | null
  previousVersion?: string
  newVersion?: string
}> {
  // 1. Fetch new manifest (Failsafe)
  // We fetch this FIRST. This ensures we can update the LOCAL store even if the addon 
  // isn't currently in Stremio (e.g. it's disabled).
  const manifestPromise = fetchAddonManifest(transportUrl, accountContext, true).catch((error) => {
    if (import.meta.env.DEV) console.error(`[Reinstall Failsafe] Failed to reach addon at ${transportUrl}`, error)
    throw new Error(`Cannot reach addon: ${error instanceof Error ? error.message : 'Unknown error'}. Aborting reinstall.`)
  })
  const collectionPromise = getAddons(authKey, accountContext)
  const [newAddonDescriptor, currentAddons] = await Promise.all([manifestPromise, collectionPromise])
  const addonIndex = currentAddons.findIndex((addon) => normalizeAddonUrl(addon.transportUrl) === normalizeAddonUrl(transportUrl))
  const existingAddon = currentAddons[addonIndex]

  const previousVersion = existingAddon?.manifest?.version
  let finalAddons = currentAddons

  if (existingAddon) {
    const updatedAddons = [...currentAddons]
    updatedAddons[addonIndex] = {
      ...newAddonDescriptor,
      flags: { ...existingAddon.flags, ...newAddonDescriptor.flags },
      metadata: { ...existingAddon.metadata },
      catalogOverrides: existingAddon.catalogOverrides,
    }

    // 4. Update the addons array for the caller (but do NOT push to Stremio yet)
    // The accountStore will handle the final state persistence/push.
    finalAddons = updatedAddons
  } else {
    if (import.meta.env.DEV) console.log(`[Reinstall] Addon ${transportUrl} not found in remote collection. Updating locally only.`)
  }

  return {
    addons: finalAddons,
    updatedAddon: newAddonDescriptor,
    previousVersion,
    newVersion: newAddonDescriptor.manifest.version,
  }
}

export interface AddonUpdateInfo {
  addonId: string
  versionKey: string
  name: string
  transportUrl: string
  installedVersion: string
  latestVersion: string
  hasUpdate: boolean
  hasVersionUpdate?: boolean
  hasManifestShapeChange?: boolean
  manifestChanges?: SavedAddonManifestChangeSummary
  health: { isOnline: boolean; error?: string }
}

const PENDING_CHECKS: Record<string, Promise<HealthStatus>> = {}

// Track active manifest fetches per origin domain to avoid rate limiting
const DOMAIN_ACTIVE_FETCHES: Record<string, number> = {}
const DOMAIN_QUEUE: Record<string, (() => void)[]> = {}
const MAX_CONCURRENT_PER_DOMAIN = 1

function acquireDomainSlot(origin: string): Promise<void> {
  return new Promise((resolve) => {
    const active = DOMAIN_ACTIVE_FETCHES[origin] || 0
    if (active < MAX_CONCURRENT_PER_DOMAIN) {
      DOMAIN_ACTIVE_FETCHES[origin] = active + 1
      resolve()
    } else {
      if (!DOMAIN_QUEUE[origin]) DOMAIN_QUEUE[origin] = []
      DOMAIN_QUEUE[origin].push(() => {
        DOMAIN_ACTIVE_FETCHES[origin] = (DOMAIN_ACTIVE_FETCHES[origin] || 0) + 1
        resolve()
      })
    }
  })
}

function releaseDomainSlot(origin: string): void {
  DOMAIN_ACTIVE_FETCHES[origin] = Math.max(0, (DOMAIN_ACTIVE_FETCHES[origin] || 1) - 1)
  const next = DOMAIN_QUEUE[origin]?.shift()
  if (next) {
    // Stagger slightly to avoid burst 429s
    setTimeout(next, 100)
  }
}

export async function checkAddonUpdates(addons: AddonDescriptor[], accountContext: string = 'Update-Check'): Promise<AddonUpdateInfo[]> {
  const checkableAddons = addons.filter((addon) => !addon.flags?.official)

  if (import.meta.env.DEV) console.log(`[Update Check] Checking ${checkableAddons.length} addons in batches with robust domain caching...`)

  const results: AddonUpdateInfo[] = []
  const domainHealthCache: Record<string, boolean> = {}
  const batchSize = 10

  for (let i = 0; i < checkableAddons.length; i += batchSize) {
    const batch = checkableAddons.slice(i, i + batchSize)
    const batchPromises = batch.map(async (addon) => {
      try {
        const origin = new URL(addon.transportUrl).origin

        const healthPromise = domainHealthCache[origin] === true
          ? Promise.resolve({ isOnline: true } as HealthStatus)
          : isLocalOrPrivateUrl(addon.transportUrl)
            ? Promise.resolve({ isOnline: false, error: 'Local addon unreachable from server' } as HealthStatus)
            : (async () => {
              if (!PENDING_CHECKS[origin]) {
                PENDING_CHECKS[origin] = checkAddonHealth(addon.transportUrl).then((status) => {
                  if (status.isOnline) domainHealthCache[origin] = true
                  setTimeout(() => delete PENDING_CHECKS[origin], 5000) // Cache health for 5s
                  return status
                })
              }
              return await PENDING_CHECKS[origin]
            })()

        const manifestKey = addon.transportUrl
        if (!getPendingFetch(manifestKey)) {
          setPendingFetch(manifestKey, (async () => {
            const healthVal = await healthPromise
            if (!healthVal.isOnline) throw new Error('Addon is offline')

            await acquireDomainSlot(origin)
            try {
              return await stremioClient.fetchAddonManifest(addon.transportUrl, accountContext)
            } finally {
              releaseDomainSlot(origin)
            }
          })().catch(err => {
            throw err
          }))
        }

        const [latestManifest, healthStatus] = await Promise.all([
          getPendingFetch(manifestKey)!,
          healthPromise,
        ])

        const hasUpdate = isNewerVersion(addon.manifest.version, latestManifest.manifest.version)

        return {
          addonId: addon.manifest.id,
          versionKey: getAddonVersionKey(addon),
          name: addon.manifest.name,
          transportUrl: addon.transportUrl,
          installedVersion: addon.manifest.version,
          latestVersion: latestManifest.manifest.version,
          hasUpdate,
          health: healthStatus,
        }
      } catch (error) {
        if (!isKnownDeadDomain(addon.transportUrl)) {
          if (import.meta.env.DEV) console.warn(`[Update Check] Failed to check ${addon.manifest.name}:`, error)
        }
        return null
      }
    })

    const batchResults = await Promise.all(batchPromises)
    results.push(...(batchResults.filter(Boolean) as AddonUpdateInfo[]))
  }

  if (import.meta.env.DEV) console.log(`[Update Check] Complete: ${results.length} checked`)

  return results
}

export async function checkSavedAddonUpdates(
  savedAddons: {
    id: string
    name: string
    installUrl: string
    manifest: AddonManifest
  }[],
  accountContext: string = 'Library-Update-Check'
): Promise<AddonUpdateInfo[]> {
  if (import.meta.env.DEV) console.log(`[Update Check] Checking ${savedAddons.length} saved addons with Domain+ID deduplication (v3)...`)

  const domainHealthCache: Record<string, boolean> = {}

  // Group by Domain + Addon ID to handle UUID-based duplicates (AIOStreams style)
  const results: AddonUpdateInfo[] = []
  const batchSize = 10

  for (let i = 0; i < savedAddons.length; i += batchSize) {
    const batch = savedAddons.slice(i, i + batchSize)
    const batchPromises = batch.map(async (addon) => {
      try {
        const origin = new URL(addon.installUrl).origin

        const healthPromise = domainHealthCache[origin] === true
          ? Promise.resolve({ isOnline: true } as HealthStatus)
          : isLocalOrPrivateUrl(addon.installUrl)
            ? Promise.resolve({ isOnline: false, error: 'Local addon unreachable from server' } as HealthStatus)
            : (async () => {
              if (!PENDING_CHECKS[origin]) {
                PENDING_CHECKS[origin] = checkAddonHealth(addon.installUrl).then(status => {
                  if (status.isOnline) domainHealthCache[origin] = true
                  setTimeout(() => delete PENDING_CHECKS[origin], 5000)
                  return status
                })
              }
              return await PENDING_CHECKS[origin]
            })()

        const manifestKey = addon.installUrl
        if (!getPendingFetch(manifestKey)) {
          setPendingFetch(manifestKey, (async () => {
            const healthVal = await healthPromise
            if (!healthVal.isOnline) throw new Error('Addon is offline')

            await acquireDomainSlot(origin)
            try {
              return await stremioClient.fetchAddonManifest(addon.installUrl, accountContext)
            } finally {
              releaseDomainSlot(origin)
            }
          })().catch(async (err) => {
            throw err
          }))
        }

        const [latestManifest, healthStatus] = await Promise.all([
          getPendingFetch(manifestKey)!,
          healthPromise,
        ])

        const hasVersionUpdate = isNewerVersion(addon.manifest.version, latestManifest.manifest.version)
        const manifestChanges = compareManifestShape(addon.manifest, latestManifest.manifest)
        const hasUpdate = hasVersionUpdate || manifestChanges.hasManifestShapeChange

        return {
          addonId: addon.id,
          versionKey: getAddonVersionKey({
            transportUrl: addon.installUrl,
            manifest: addon.manifest,
          }),
          name: addon.name,
          transportUrl: addon.installUrl,
          installedVersion: addon.manifest.version,
          latestVersion: latestManifest.manifest.version,
          hasUpdate,
          hasVersionUpdate,
          hasManifestShapeChange: manifestChanges.hasManifestShapeChange,
          manifestChanges,
          health: healthStatus,
        }
      } catch (error) {
        if (!isKnownDeadDomain(addon.installUrl)) {
          if (import.meta.env.DEV) console.warn(`[Update Check] Failed to check ${addon.name}:`, error)
        }
        return null
      }
    })

    const batchResults = await Promise.all(batchPromises)
    results.push(...(batchResults.filter(Boolean) as AddonUpdateInfo[]))
  }

  if (import.meta.env.DEV) console.log(`[Update Check] Complete: ${results.length} checked`)
  return results
}
