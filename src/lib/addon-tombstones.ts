// Persisted + synced markers for addons the user explicitly deleted, so an inbound sync (Stremio
// collection or the cloud blob) can't resurrect them. Keyed by normalized transportUrl -> deletedAt.
// Tombstones prevent resurrection of deleted addons from remote sources. Hub-side re-adds are safe
// (reconcileTombstones clears the tombstone at install, filterResurrected checks local presence first).
// Out-of-band re-adds within the 21-day TTL are intentionally suppressed.
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

// Tombstoned addons persistently re-pushed by other tools (AIOM Hydra sync) are intentional re-adds - adopt after 3 sightings.
export const AUTO_ADOPT_THRESHOLD = 3

export type ResurrectionSightings = Record<string, number>

export interface ResurrectionFilterResult<T> {
    kept: T[]
    adopted: T[]
    suppressedCount: number
    nextSightings: ResurrectionSightings
}

export function filterResurrectedAuto<T extends AddonLike>(
    remote: T[],
    local: AddonLike[],
    tombstones: Tombstones | undefined,
    sightings: ResurrectionSightings,
    now = Date.now(),
    ttl = DEFAULT_TTL_MS
): ResurrectionFilterResult<T> {
    const localKeys = new Set(local.map(a => normUrl(a.transportUrl)).filter(Boolean))
    const nextSightings: ResurrectionSightings = { ...sightings }
    const kept: T[] = []
    const adopted: T[] = []
    let suppressedCount = 0
    for (const addon of remote) {
        const k = key(addon.transportUrl)
        const tombstoned = k !== '' && tombstones?.[k] !== undefined && now - tombstones[k] < ttl
        if (!k || localKeys.has(k) || !tombstoned) { kept.push(addon); continue }
        const count = (nextSightings[k] || 0) + 1
        if (count >= AUTO_ADOPT_THRESHOLD) {
            delete nextSightings[k]
            markResurrectionAdopted(k)
            kept.push(addon)
            adopted.push(addon)
            continue
        }
        nextSightings[k] = count
        suppressedCount++
    }
    return { kept, adopted, suppressedCount, nextSightings }
}

const ADOPTED_STORAGE_KEY = 'aioman:adopted-tombstones'

// Persistently tracks URLs the auto-adopt has adopted, so a stale E2E blob merge
// doesn't re-create the tombstone and re-suppress an intentionally re-added addon.
export function markResurrectionAdopted(urlKey: string): void {
    try {
        if (typeof localStorage === 'undefined') return
        const raw = localStorage.getItem(ADOPTED_STORAGE_KEY)
        const adopted = raw ? JSON.parse(raw) : {}
        adopted[urlKey] = Date.now()
        localStorage.setItem(ADOPTED_STORAGE_KEY, JSON.stringify(adopted))
    } catch {}
}

export function isResurrectionAdopted(urlKey: string): boolean {
    try {
        if (typeof localStorage === 'undefined') return false
        const raw = localStorage.getItem(ADOPTED_STORAGE_KEY)
        const adopted = raw ? JSON.parse(raw) : {}
        return adopted[urlKey] !== undefined
    } catch { return false }
}

const SIGHTINGS_STORAGE_KEY = 'aioman:tombstone-sightings'

export function loadResurrectionSightings(): ResurrectionSightings {
    try {
        if (typeof localStorage === 'undefined') return {}
        const raw = localStorage.getItem(SIGHTINGS_STORAGE_KEY)
        return raw ? JSON.parse(raw) : {}
    } catch { return {} }
}

export function saveResurrectionSightings(s: ResurrectionSightings): void {
    try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(SIGHTINGS_STORAGE_KEY, JSON.stringify(s))
    } catch {}
}
