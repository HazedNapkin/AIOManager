// AIOStreams variant install-URL helpers.
//
// Pure leaf module (relative .ts imports only) so it stays importable under the
// node:test runner (scratch-validation/config-roundtrip-safety-20261019).
//
// AIOStreams selects variants either with a path segment (`/v/<ids>`) or a
// query parameter (`?v=<ids>`). AIOManager identifies addons by URL with the
// query string stripped, so two `?v=` variants of the same user collapse onto
// one addon and overwrite each other, while `/v/` variants stay distinct
// (upstream AIOStreams guards the same collision in its AIOManager adapter;
// see packages/core/src/linked-accounts/platforms/aiomanager.ts).

import { normalizeAddonUrlForMatch } from './addon-url.ts'

export type AIOStreamsVariantSelectorLocation = 'path' | 'query'

export interface AIOStreamsVariantUrlOptions {
    /**
     * Where the selector goes. Defaults to `path` (`/v/<ids>`), which stays
     * distinct in AIOManager's query-stripped addon identity. Only use `query`
     * when mirroring an instance configured with the query selector and the
     * collision check below has been run.
     */
    selectorLocation?: AIOStreamsVariantSelectorLocation
}

// Matches upstream VariantSchema: 1-32 chars, lowercase letters, digits, '-' or
// '_', starting with a letter or digit. Ids appear verbatim in the URL.
const VARIANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/

// `/stremio/u/<alias>/manifest.json`, `/stremio/<uuid>/<pw>/manifest.json`,
// either form with an optional `/v/<ids>` segment before `/manifest.json`,
// and all of the above under an instance base-path prefix (e.g. `/prefix`),
// matching the existing parseAIOStreamsUrl contract. Deliberately scoped to
// AIOStreams manifest paths only; no generic addon URL matching change is
// intended here.
const AIOSTREAMS_MANIFEST_PATH = /^\/(?:.+\/)?stremio\/(?:u\/[^/]+|[^/]+\/[^/]+)(?:\/v\/[^/]+)?\/manifest\.json$/i

function isAIOStreamsManifestUrl(url: URL): boolean {
    return AIOSTREAMS_MANIFEST_PATH.test(url.pathname)
}

function normalizeVariantIds(variantIds: string | string[] | null | undefined): string[] | null {
    if (variantIds == null) return []
    const list = Array.isArray(variantIds)
        ? variantIds
        : String(variantIds).split(',')
    const ids = list.map(id => String(id).trim()).filter(id => id.length > 0)
    for (const id of ids) {
        if (!VARIANT_ID_PATTERN.test(id)) return null
    }
    return Array.from(new Set(ids))
}

function stripExistingSelector(url: URL): void {
    // Path form: drop the `/v/<ids>` pair right before `/manifest.json`
    // (`[... ,'v', '<ids>', 'manifest.json']`), letting `manifest.json` slide
    // back into place.
    const pathParts = url.pathname.split('/')
    const manifestIndex = pathParts.lastIndexOf('manifest.json')
    if (manifestIndex >= 2 && pathParts[manifestIndex - 2] === 'v') {
        pathParts.splice(manifestIndex - 2, 2)
        url.pathname = pathParts.join('/') || '/'
    }
    // Query form: drop `v` (keep unrelated params such as AIOManager tags).
    url.searchParams.delete('v')
}

/**
 * Build (or strip) the variant selector on an AIOStreams manifest URL.
 *
 * - `variantIds` null/empty removes any existing selector (base config URL).
 * - `selectorLocation: 'path'` (default) produces `/stremio/<uuid>/<pw>/v/<ids>/manifest.json`.
 * - `selectorLocation: 'query'` produces `.../manifest.json?v=<ids>` (AIOManager
 *   collapses these onto one addon — see findAIOStreamsQuerySelectorCollisions).
 *
 * Returns null when the input is not an AIOStreams manifest URL or a variant id
 * is malformed; the caller's URL is never partially mutated.
 */
export function buildAIOStreamsVariantInstallUrl(
    manifestUrl: string,
    variantIds: string | string[] | null | undefined,
    opts: AIOStreamsVariantUrlOptions = {}
): string | null {
    const ids = normalizeVariantIds(variantIds)
    if (ids == null) return null

    let url: URL
    try {
        url = new URL(String(manifestUrl).trim())
    } catch {
        return null
    }
    if (!/^https?:$/.test(url.protocol)) return null
    if (!isAIOStreamsManifestUrl(url)) return null

    stripExistingSelector(url)

    if (ids.length === 0) return url.toString()

    const joined = ids.map(id => encodeURIComponent(id)).join(',')
    if (opts.selectorLocation === 'query') {
        url.searchParams.set('v', joined)
        return url.toString()
    }

    const pathParts = url.pathname.split('/')
    const manifestIndex = pathParts.lastIndexOf('manifest.json')
    if (manifestIndex === -1) return null
    pathParts.splice(manifestIndex, 0, 'v', joined)
    url.pathname = pathParts.join('/')
    return url.toString()
}

/**
 * Groups AIOStreams manifest URLs that AIOManager would consider the same
 * addon: the identity is the URL with scheme normalized, the query string
 * stripped, and `/manifest.json` + trailing slashes removed. Any group with
 * more than one URL differs only by query string (typically `?v=` variant
 * selectors or tags), so installing all of them on one account makes them
 * overwrite each other. Non-AIOStreams URLs are ignored; generic addon
 * identity rules are untouched.
 *
 * Returns the colliding groups (each an array of the original URLs). Empty
 * array means no collisions.
 */
export function findAIOStreamsQuerySelectorCollisions(urls: string[]): string[][] {
    const groups = new Map<string, string[]>()
    for (const raw of urls) {
        if (!raw) continue
        let url: URL
        try {
            url = new URL(String(raw).trim())
        } catch {
            continue
        }
        if (!isAIOStreamsManifestUrl(url)) continue
        const key = normalizeAddonUrlForMatch(url.toString())
        if (!key) continue
        const group = groups.get(key)
        if (group) {
            if (!group.includes(url.toString())) group.push(url.toString())
        } else {
            groups.set(key, [url.toString()])
        }
    }
    return Array.from(groups.values()).filter(group => group.length > 1)
}
