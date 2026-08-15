import type { SavedAddon } from '../types/saved-addon'

export type LibrarySortMode = 'custom' | 'alphabetical'

export function hasCustomOrder(addons: SavedAddon[]): boolean {
  return addons.some(a => typeof a.sortOrder === 'number')
}

const displayName = (a: SavedAddon) => a.metadata?.customName || a.name

export function compareSavedAddons(a: SavedAddon, b: SavedAddon): number {
  const ao = typeof a.sortOrder === 'number' ? a.sortOrder : Number.MAX_SAFE_INTEGER
  const bo = typeof b.sortOrder === 'number' ? b.sortOrder : Number.MAX_SAFE_INTEGER
  if (ao !== bo) return ao - bo
  return displayName(a).localeCompare(displayName(b))
}

export function sortSavedAddons(addons: SavedAddon[], mode: LibrarySortMode): SavedAddon[] {
  if (mode === 'alphabetical' || !hasCustomOrder(addons)) {
    return [...addons].sort((a, b) => displayName(a).localeCompare(displayName(b)))
  }
  return [...addons].sort(compareSavedAddons)
}
