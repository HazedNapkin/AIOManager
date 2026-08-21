/**
 * Official Stremio Addon Manifest IDs (whitelist).
 * Sourced from stremio-official-addons repository and Stremio core constants.
 * Only these exact manifest IDs are considered official Stremio addons.
 */
const OFFICIAL_ADDON_IDS = new Set<string>([
  'com.linvo.cinemeta', // Cinemeta V3
  // Additional official IDs can be added here as needed
  // Examples from stremio-official-addons:
  // 'com.stremio.trakt',
  // 'com.stremio.comments',
  // 'com.stremio.limits',
])

/**
 * Check if a manifest ID belongs to an official Stremio addon.
 * @param manifestId - The addon manifest ID to check
 * @returns true if the manifest ID is in the official whitelist
 */
export function isOfficialAddon(manifestId: string): boolean {
  return OFFICIAL_ADDON_IDS.has(manifestId)
}

/**
 * Get the official flag value for an addon, preserving user-set values.
 * @param manifestId - The addon manifest ID
 * @param userSetOfficial - User-provided official flag (optional)
 * @returns The official flag value (user-set takes precedence)
 */
export function getOfficialFlag(manifestId: string, userSetOfficial?: boolean): boolean {
  // User explicitly set value overrides auto-classification
  if (userSetOfficial !== undefined) {
    return userSetOfficial
  }
  // Auto-classify based on manifest ID whitelist
  return isOfficialAddon(manifestId)
}