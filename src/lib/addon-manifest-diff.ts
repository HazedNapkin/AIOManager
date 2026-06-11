import type { AddonManifest, Catalog, CatalogOverrides } from '@/types/addon'
import type { SavedAddonManifestChangeSummary } from '@/types/saved-addon'

export interface PreservedCatalogOverrides {
  catalogOverrides?: CatalogOverrides
  preservedRemovedCatalogs: number
  remappedRemovedCatalogs: number
}

function normalizeText(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function stableStringify(value: unknown, seen: WeakSet<object> = new WeakSet()): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)

  if (seen.has(value)) return '"[Circular]"'
  seen.add(value)

  try {
    if (Array.isArray(value)) return `[${value.map(entry => stableStringify(entry, seen)).join(',')}]`

    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))

    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue, seen)}`).join(',')}}`
  } finally {
    seen.delete(value)
  }
}

function getResourceKey(resource: unknown): string {
  if (typeof resource === 'string') return normalizeText(resource)
  if (resource && typeof resource === 'object') {
    const record = resource as Record<string, unknown>
    const name = normalizeText(record.name)
    if (name) return name
  }
  return stableStringify(resource)
}

function getCatalogKey(catalog: Catalog): string {
  return `${normalizeText(catalog.type)}:${normalizeText(catalog.id)}`
}

function getCatalogSemanticKey(catalog: Catalog): string | null {
  const extraNames = (catalog.extra || [])
    .map(extra => normalizeText(extra.name))
    .filter(Boolean)
    .sort()
    .join(',')
  const name = normalizeText(catalog.name)

  if (!name && !extraNames) return null

  return [
    normalizeText(catalog.type),
    name,
    extraNames,
  ].join(':')
}

function countDelta(previousKeys: Set<string>, nextKeys: Set<string>) {
  let added = 0
  let removed = 0

  for (const key of nextKeys) {
    if (!previousKeys.has(key)) added++
  }
  for (const key of previousKeys) {
    if (!nextKeys.has(key)) removed++
  }

  return { added, removed }
}

export function compareManifestShape(
  previousManifest: AddonManifest | undefined,
  nextManifest: AddonManifest | undefined
): SavedAddonManifestChangeSummary {
  const previousCatalogKeys = new Set((previousManifest?.catalogs || []).map(getCatalogKey))
  const nextCatalogKeys = new Set((nextManifest?.catalogs || []).map(getCatalogKey))
  const previousResourceKeys = new Set((previousManifest?.resources || []).map(getResourceKey))
  const nextResourceKeys = new Set((nextManifest?.resources || []).map(getResourceKey))

  const catalogDelta = countDelta(previousCatalogKeys, nextCatalogKeys)
  const resourceDelta = countDelta(previousResourceKeys, nextResourceKeys)

  return {
    catalogsAdded: catalogDelta.added,
    catalogsRemoved: catalogDelta.removed,
    resourcesAdded: resourceDelta.added,
    resourcesRemoved: resourceDelta.removed,
    hasManifestShapeChange:
      catalogDelta.added > 0 ||
      catalogDelta.removed > 0 ||
      resourceDelta.added > 0 ||
      resourceDelta.removed > 0,
  }
}

export function preserveCatalogOverridesAcrossManifestUpdate(
  previousManifest: AddonManifest | undefined,
  nextManifest: AddonManifest | undefined,
  previousOverrides: CatalogOverrides | undefined
): PreservedCatalogOverrides {
  const previousRemovedIds = previousOverrides?.removed || []
  if (previousRemovedIds.length === 0) {
    return {
      catalogOverrides: previousOverrides,
      preservedRemovedCatalogs: 0,
      remappedRemovedCatalogs: 0,
    }
  }

  const nextCatalogs = nextManifest?.catalogs || []
  const nextIds = new Set(nextCatalogs.map(catalog => catalog.id))
  const exactPreservedRemovedIds = new Set(previousRemovedIds.filter(removedId => nextIds.has(removedId)))
  const nextBySemanticKey = new Map<string, Catalog[]>()

  for (const catalog of nextCatalogs) {
    const semanticKey = getCatalogSemanticKey(catalog)
    if (!semanticKey) continue
    const existing = nextBySemanticKey.get(semanticKey)
    if (existing) existing.push(catalog)
    else nextBySemanticKey.set(semanticKey, [catalog])
  }
  for (const candidates of nextBySemanticKey.values()) {
    candidates.sort((a, b) => getCatalogKey(a).localeCompare(getCatalogKey(b)))
  }

  const removedIds = new Set<string>()
  const nextSemanticCursorByKey = new Map<string, number>()
  let preservedRemovedCatalogs = 0
  let remappedRemovedCatalogs = 0

  for (const removedId of previousRemovedIds) {
    removedIds.add(removedId)
    if (nextIds.has(removedId)) {
      preservedRemovedCatalogs++
      continue
    }

    const oldRemovedCatalogs = (previousManifest?.catalogs || []).filter(catalog => catalog.id === removedId)
    let remappedCurrentId = false
    for (const oldCatalog of oldRemovedCatalogs) {
      if (remappedCurrentId) break
      const semanticKey = getCatalogSemanticKey(oldCatalog)
      if (!semanticKey) continue
      const candidates = nextBySemanticKey.get(semanticKey) || []
      let cursor = nextSemanticCursorByKey.get(semanticKey) || 0
      while (
        cursor < candidates.length &&
        (removedIds.has(candidates[cursor].id) || exactPreservedRemovedIds.has(candidates[cursor].id))
      ) {
        cursor += 1
      }
      const match = candidates[cursor]
      if (match) {
        removedIds.add(match.id)
        nextSemanticCursorByKey.set(semanticKey, cursor + 1)
        remappedRemovedCatalogs++
        remappedCurrentId = true
      }
    }
  }

  return {
    catalogOverrides: { ...previousOverrides, removed: Array.from(removedIds) },
    preservedRemovedCatalogs,
    remappedRemovedCatalogs,
  }
}

export function getManifestFingerprint(
  manifest: AddonManifest | undefined,
  catalogOverrides?: CatalogOverrides
): string {
  return stableStringify({
    manifest,
    catalogOverrides: catalogOverrides || null,
  })
}

export function describeManifestChanges(summary: SavedAddonManifestChangeSummary): string {
  const parts: string[] = []

  if (summary.catalogsAdded > 0) parts.push(`${summary.catalogsAdded} catalog${summary.catalogsAdded !== 1 ? 's' : ''} added`)
  if (summary.catalogsRemoved > 0) parts.push(`${summary.catalogsRemoved} catalog${summary.catalogsRemoved !== 1 ? 's' : ''} removed`)
  if (summary.resourcesAdded > 0) parts.push(`${summary.resourcesAdded} resource${summary.resourcesAdded !== 1 ? 's' : ''} added`)
  if (summary.resourcesRemoved > 0) parts.push(`${summary.resourcesRemoved} resource${summary.resourcesRemoved !== 1 ? 's' : ''} removed`)

  if (parts.length === 0 && summary.hasManifestShapeChange) {
    return 'manifest structure changed'
  }

  return parts.join(', ')
}
