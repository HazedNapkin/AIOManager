/**
 * Addon Validator
 *
 * Provides validation and fetching of addon manifests for saved addons.
 */

/**
 * Normalize tag name
 */
export function normalizeTagName(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}
