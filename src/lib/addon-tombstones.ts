// Persisted + synced markers for addons the user explicitly deleted, so an inbound sync (Stremio
// collection or the cloud blob) can't resurrect them. Keyed by normalized transportUrl -> deletedAt.
export type Tombstones = Record<string, number>

// Kill switch: set false to disable resurrection suppression entirely (filterResurrected becomes a
// passthrough). Tombstones are still recorded + reconciled, so flipping this back on resumes cleanly.
export const TOMBSTONES_ENABLED = true

// Short by design: the resurrection window is days (a stale source re-pushing, or a one-time
// migration restore), so a 3-week TTL covers it while leaving no long-run residue. Any cross-device
// re-add lag or false-suppression self-expires in weeks rather than months.
const DEFAULT_TTL_MS = 21 * 24 * 60 * 60 * 1000

interface AddonLike { transportUrl?: string }

// Kept byte-identical to lib/addon-url.ts normalizeAddonUrl (which mergeAddons uses). Inlined so
// this module has no relative imports and stays loadable by the node:test runner; a drift-guard
// test asserts it matches the canonical version, since a normalization mismatch would silently
// make the tombstone filter miss.
export function normUrl(url: string | undefined): string {
    if (!url) return ''
    let n = url.trim()
    n = n.replace(/^stremio:\/\//i, 'https://')
    n = n.replace(/\/manifest\.json$/i, '')
    n = n.replace(/\/+$/, '')
    return n.toLowerCase()
}

const key = (url: string | undefined) => normUrl(url)

export function addTombstones(tombstones: Tombstones | undefined, urls: Array<string | undefined>, now = Date.now()): Tombstones {
    const out: Tombstones = { ...(tombstones || {}) }
    for (const u of urls) { const k = key(u); if (k) out[k] = now }
    return out
}

// Latest-delete-wins union across two devices' blobs; expired entries dropped.
export function mergeTombstones(a: Tombstones | undefined, b: Tombstones | undefined, now = Date.now(), ttl = DEFAULT_TTL_MS): Tombstones {
    const out: Tombstones = {}
    for (const src of [a, b]) {
        for (const [k, ts] of Object.entries(src || {})) {
            if (now - ts >= ttl) continue
            if (!(k in out) || ts > out[k]) out[k] = ts
        }
    }
    return out
}

// Suppress a remote addon iff it is tombstoned AND not present locally. Local presence (an
// intentional re-add, or a disabled addon kept local) always wins, so the filter only ever
// removes a pure resurrection -- never an addon the user currently has.
export function filterResurrected<T extends AddonLike>(remote: T[], local: AddonLike[], tombstones: Tombstones | undefined, now = Date.now(), ttl = DEFAULT_TTL_MS): T[] {
    if (!TOMBSTONES_ENABLED) return remote
    if (!tombstones || Object.keys(tombstones).length === 0) return remote
    const localKeys = new Set(local.map(a => key(a.transportUrl)).filter(Boolean))
    return remote.filter(a => {
        const k = key(a.transportUrl)
        if (!k || localKeys.has(k)) return true
        const ts = tombstones[k]
        return !(ts !== undefined && now - ts < ttl)
    })
}

// After a merge, drop tombstones for any url now present (re-added/kept) and any expired ones, so
// the stored set self-heals and can never contradict the live addon list. This is the structural
// clear-on-re-add: no per-call-site checklist needed.
export function reconcileTombstones(tombstones: Tombstones | undefined, mergedAddons: AddonLike[], now = Date.now(), ttl = DEFAULT_TTL_MS): Tombstones {
    if (!tombstones) return {}
    const present = new Set(mergedAddons.map(a => key(a.transportUrl)).filter(Boolean))
    const out: Tombstones = {}
    for (const [k, ts] of Object.entries(tombstones)) {
        if (present.has(k) || now - ts >= ttl) continue
        out[k] = ts
    }
    return out
}
