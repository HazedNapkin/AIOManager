// Addon instance identity: a stable composite key (origin + manifest.id +
// stable path segments) that survives config-URL changes. Syncing a config-URL
// addon (AIOStreams, AIOMetadata) rewrites the encrypted config segment in its
// transport URL; keying merges on the URL alone then produces a duplicate card
// instead of updating the entry in place. The instance key excludes those
// volatile segments so the SAME logical instance keeps ONE key across config
// changes, while a different instance uuid or origin still yields a different
// key (variants must never collapse).
//
// Pure leaf math on the addon object — no side effects, node:test importable.
// Scope: used ONLY by the sync-replace/dedupe decisions in mergeAddons
// (utils.ts), dedupeAddonsByTransportUrl (addon-dedupe.ts) and the saved-addon
// deploy merge (addon-merger.ts). Never a general dedupe of arbitrary
// collections.
import type { AddonDescriptor } from '@/types/addon'
import { normalizeAddonUrl } from './addon-url.ts'

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A path segment that is not UUID-shaped and exceeds this length is an
// encrypted per-config blob — it MUST be dropped or every config change
// mints a new identity.
const MAX_STABLE_SEGMENT_LENGTH = 40

export function getAddonInstanceKey(addon: Pick<AddonDescriptor, 'transportUrl' | 'manifest'>): string {
  const manifestId = addon.manifest?.id
  const url = addon.transportUrl
  if (!manifestId || !url) return normalizeAddonUrl(url || '')

  let parsed: URL
  try {
    parsed = new URL(url.replace(/^stremio:\/\//i, 'https://'))
  } catch {
    return normalizeAddonUrl(url)
  }
  if (!parsed.hostname) return normalizeAddonUrl(url)

  const origin = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`
  const allSegments = parsed.pathname
    .replace(/\/manifest\.json$/i, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean)
  const stableSegments = allSegments.filter(
    (segment) => UUID_SEGMENT.test(segment) || segment.length <= MAX_STABLE_SEGMENT_LENGTH
  )
  const droppedVolatile = stableSegments.length !== allSegments.length
  const stablePath = stableSegments.map((segment) => segment.toLowerCase()).join('/')
  // Query is identity unless config lives in the path - dropping it would collapse dual-config addons.
  const querySuffix = droppedVolatile ? '' : parsed.search

  return `${origin.toLowerCase()}|${manifestId}|${stablePath}${querySuffix}`
}

// Secondary merge pass: pair each local addon that found no URL match with the
// oldest still-unclaimed remote of the same instance. Remotes that URL-match any
// local are left to the primary pass.
export function claimInstanceRemotes<T extends Pick<AddonDescriptor, 'transportUrl' | 'manifest' | 'metadata'>>(
  localAddons: T[],
  remoteAddons: T[],
): Map<T, T> {
  const claims = new Map<T, T>()
  const localNorms = new Set(localAddons.map((a) => normalizeAddonUrl(a.transportUrl)))
  const remoteNorms = new Set(remoteAddons.map((a) => normalizeAddonUrl(a.transportUrl)))

  const pendingByKey = new Map<string, T[]>()
  for (const remote of remoteAddons) {
    if (localNorms.has(normalizeAddonUrl(remote.transportUrl))) continue
    const key = getAddonInstanceKey(remote)
    if (!key) continue
    const bucket = pendingByKey.get(key)
    if (bucket) bucket.push(remote)
    else pendingByKey.set(key, [remote])
  }
  if (pendingByKey.size === 0) return claims

  // Ambiguity rule: oldest local claims the incoming remote; the rest are preserved untouched.
  const claimantsByKey = new Map<string, T[]>()
  for (const local of localAddons) {
    if (remoteNorms.has(normalizeAddonUrl(local.transportUrl))) continue
    const key = getAddonInstanceKey(local)
    if (!key) continue
    const bucket = pendingByKey.get(key)
    if (!bucket || bucket.length === 0) continue
    const claimants = claimantsByKey.get(key)
    if (claimants) claimants.push(local)
    else claimantsByKey.set(key, [local])
  }

  for (const [key, claimants] of claimantsByKey) {
    const bucket = pendingByKey.get(key) || []
    const sorted = [...claimants].sort((a, b) => lastUpdatedOf(a) - lastUpdatedOf(b))
    const paired = Math.min(sorted.length, bucket.length)
    for (let i = 0; i < paired; i++) claims.set(sorted[i], bucket[i])
  }
  return claims
}

function lastUpdatedOf(addon: Pick<AddonDescriptor, 'metadata'>): number {
  return Number(addon.metadata?.lastUpdated) || 0
}
