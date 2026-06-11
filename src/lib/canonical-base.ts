import type { AddonDescriptor } from '@/types/addon'

/**
 * Per-account "merge base" for the inbound canonical reconcile (the common ancestor a
 * three-way merge needs; see canonical-merge.ts). The base is "the canonical the server
 * last CONFIRMED it received from this client", committed only on a successful push, so
 * a failed push never advances it (which would silently resurrect a just-deleted addon).
 *
 * Device-local on purpose: it's this device's view of the last reconciled canonical, not
 * shared state. Kept out of the synced blob to avoid cross-device clobber.
 */

const KEY = 'aio-canonical-base'
type BaseMap = Record<string, AddonDescriptor[]>

function load(): BaseMap {
    try {
        const raw = localStorage.getItem(KEY)
        const parsed = raw ? JSON.parse(raw) : {}
        return parsed && typeof parsed === 'object' ? (parsed as BaseMap) : {}
    } catch {
        return {}
    }
}

/** The recorded base for an account, or null if none has been committed yet. */
export function getCanonicalBase(accountId: string): AddonDescriptor[] | null {
    const map = load()
    return Object.prototype.hasOwnProperty.call(map, accountId) ? map[accountId] : null
}

/**
 * Commit base snapshots. Writes localStorage only when something actually changed
 * (zero-I/O ethos: no write per sync cycle when nothing moved).
 */
export function setCanonicalBases(entries: BaseMap): void {
    const map = load()
    let changed = false
    for (const [id, addons] of Object.entries(entries)) {
        if (JSON.stringify(map[id]) !== JSON.stringify(addons)) {
            map[id] = addons
            changed = true
        }
    }
    if (changed) {
        try { localStorage.setItem(KEY, JSON.stringify(map)) } catch { /* ignore quota */ }
    }
}

/** Drop all bases (logout; the next login re-establishes them on first push). */
export function clearCanonicalBases(): void {
    try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
