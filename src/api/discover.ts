import type { AddonManifest } from '@/types/addon'

const BASE_URL = 'https://stremio-addons.net/api/v0'

export type DiscoverSortBy = 'stars' | 'createdAt'
export type DiscoverOrder = 'asc' | 'desc'
export type DiscoverNsfw = 'only' | 'exclude'

export interface DiscoverCategory {
  name: string
  slug: string
}

export interface DiscoverAddon {
  uuid: string
  url: string
  manifestUrl: string
  manifest: AddonManifest
  slug: string
  stars: number
  categories: DiscoverCategory[]
  configureUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface DiscoverPagination {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
}

export interface DiscoverAddonsResponse {
  addons: DiscoverAddon[]
  pagination: DiscoverPagination
}

export interface DiscoverAddonDetail extends DiscoverAddon {
  documentation: string | null
  instances: DiscoverAddon[]
}

export interface DiscoverQuery {
  search?: string
  category?: string[]
  sortBy?: DiscoverSortBy
  order?: DiscoverOrder
  nsfw?: DiscoverNsfw
  page?: number
  after?: string
  limit?: number
}

// All stremio-addons.net network access is isolated here. The endpoint is
// public, read-only, and CORS-open, so it is fetched directly from the client.
// If that ever changes, route these two functions through the server proxy.
export async function fetchDiscoverAddons(query: DiscoverQuery = {}): Promise<DiscoverAddonsResponse> {
  const params = new URLSearchParams()
  if (query.search?.trim()) params.set('search', query.search.trim())
  if (query.sortBy) params.set('sort_by', query.sortBy)
  if (query.order) params.set('order', query.order)
  if (query.nsfw) params.set('nsfw', query.nsfw)
  if (query.page != null) params.set('page', String(query.page))
  if (query.after) params.set('after', query.after)
  if (query.limit != null) params.set('limit', String(query.limit))
  for (const slug of query.category ?? []) params.append('category', slug)

  const res = await fetch(`${BASE_URL}/addons?${params.toString()}`)
  if (!res.ok) throw new Error(`Discover request failed (${res.status})`)
  const data = (await res.json()) as DiscoverAddonsResponse
  return {
    addons: Array.isArray(data.addons) ? data.addons : [],
    pagination: data.pagination,
  }
}

export async function fetchDiscoverCategories(): Promise<DiscoverCategory[]> {
  const res = await fetch(`${BASE_URL}/categories`)
  if (!res.ok) throw new Error(`Discover categories request failed (${res.status})`)
  const data = (await res.json()) as { categories?: DiscoverCategory[] }
  return Array.isArray(data.categories) ? data.categories : []
}

export async function fetchDiscoverAddon(slugOrUuid: string): Promise<DiscoverAddonDetail> {
  const res = await fetch(`${BASE_URL}/addons/${encodeURIComponent(slugOrUuid)}`)
  if (!res.ok) throw new Error(`Discover detail request failed (${res.status})`)
  return (await res.json()) as DiscoverAddonDetail
}

// Human-readable labels for the manifest resource keys an addon advertises.
export const RESOURCE_LABELS: Record<string, string> = {
  stream: 'Streams',
  catalog: 'Catalog',
  meta: 'Metadata',
  subtitles: 'Subtitles',
  addon_catalog: 'Addons',
}

// manifest.resources may be a list of strings ("stream") or objects ({ name: "stream" }).
export function getAddonResources(addon: DiscoverAddon): string[] {
  const resources = addon.manifest?.resources
  if (!Array.isArray(resources)) return []
  return resources
    .map((r) => (typeof r === 'string' ? r : (r as { name?: string })?.name))
    .filter((name): name is string => typeof name === 'string')
}

export function requiresConfiguration(addon: DiscoverAddon): boolean {
  return addon.manifest?.behaviorHints?.configurationRequired === true
}

// Human "Updated x ago" label from the addon's updatedAt ISO timestamp. Returns null when absent
// or unparseable so callers can omit it.
export function lastUpdatedLabel(addon: { updatedAt?: string }): string | null {
  if (!addon.updatedAt) return null
  const ts = new Date(addon.updatedAt).getTime()
  if (!Number.isFinite(ts)) return null
  const days = Math.floor((Date.now() - ts) / 86_400_000)
  if (days <= 0) return 'Updated today'
  if (days === 1) return 'Updated 1d ago'
  if (days < 30) return `Updated ${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `Updated ${months}mo ago`
  return `Updated ${Math.floor(months / 12)}y ago`
}

export function getConfigureUrl(addon: DiscoverAddon): string | null {
  if (addon.configureUrl) return addon.configureUrl
  if (addon.manifest?.behaviorHints?.configurable !== true) return null
  try {
    const base = new URL(addon.manifestUrl)
    base.pathname = base.pathname.replace(/\/manifest\.json$/i, '') + '/configure'
    return base.toString()
  } catch {
    return null
  }
}
