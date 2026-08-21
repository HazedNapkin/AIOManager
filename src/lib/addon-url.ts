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

// Invariant: must stay in lockstep with the server normalizer (server/utils/addon-url.js).
export function normalizeAddonUrlForMatch(url: string): string {
  if (!url) return ''
  let normalized = url.trim()
  if (!/^(?:https?|stremio):\/\//i.test(normalized)) normalized = `https://${normalized}`
  normalized = normalized.replace(/^stremio:\/\//i, 'https://')
  normalized = normalized.replace(/^http:\/\//i, 'https://')
  normalized = normalized.replace(/\/manifest\.json$/i, '')
  normalized = normalized.replace(/\/+$/, '')
  normalized = normalized.replace(/\?.*$/, '')
  return normalized.toLowerCase()
}
