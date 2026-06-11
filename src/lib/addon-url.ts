// Pure leaf module (no imports) so the URL normalizer is a single source shared by mergeAddons
// (via utils) and the tombstone filter, and is importable under the node:test runner.
export function normalizeAddonUrl(url: string): string {
  if (!url) return ''
  let normalized = url.trim()
  normalized = normalized.replace(/^stremio:\/\//i, 'https://')
  normalized = normalized.replace(/\/manifest\.json$/i, '')
  normalized = normalized.replace(/\/+$/, '')
  return normalized.toLowerCase()
}
