// Shared URL normalizer for server-side addon URL handling
// Consolidates duplicate implementations from:
// - server/autopilot/engine.js
// - server/routes/proxy.js (getAddonUrlKey)
// - server/routes/hydra.js

/**
 * Normalizes an addon URL for consistent comparison and deduplication.
 * Handles stremio:// protocols, trailing slashes, manifest.json suffixes, and case normalization.
 * 
 * @param {string} url - The addon URL to normalize
 * @returns {string} Normalized URL or empty string if input is falsy
 */
export function normalizeAddonUrl(url) {
    if (!url) return ''
    let normalized = String(url).trim()
    normalized = normalized.replace(/^stremio:\/\//i, 'https://')
    normalized = normalized.replace(/\/manifest\.json$/i, '')
    normalized = normalized.replace(/\/+$/, '')
    return normalized.toLowerCase()
}

/**
 * Legacy alias for backward compatibility with getAddonUrlKey in routes/proxy.js
 */
export function getAddonUrlKey(url) {
    return normalizeAddonUrl(url)
}
