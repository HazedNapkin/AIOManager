// Per-addon destination policy: a deny-list on the hub row. Absent/empty policy means
// "sync everywhere" — bit-for-bit the pre-feature behavior. The hub stays the single
// superset; destinations only decide per-target membership at every fan-out point.
//
// Pure leaf module (type import + addon-url normalizer only) so it stays importable
// under the node:test runner and from every sync path without cycles. The server twin
// lives at server/utils/addon-destinations.js — projection must stay identical.
import type { AddonDescriptor } from '../types/addon'
import { normalizeAddonUrl } from './addon-url.ts'

export type { AddonDestinations } from '../types/addon'

/** A write/read target: a platform (all its logins) and optionally one exact login. */
export interface DestinationTarget {
    platform: string
    connectionId?: string
}

const cleanList = (values: unknown): string[] | undefined => {
    if (!Array.isArray(values)) return undefined
    const cleaned = [...new Set(values.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.trim()))].sort()
    return cleaned.length > 0 ? cleaned : undefined
}

/**
 * Sanitize stored/imported policy: trim, drop empties, dedupe, sort (stable
 * serialization for fingerprints and cloud round-trips). Returns undefined when no
 * effective exclusion remains so "no policy" stays representable as an absent field.
 */
export function normalizeDestinations(destinations?: AddonDescriptor['destinations'] | null): AddonDescriptor['destinations'] | undefined {
    if (!destinations || typeof destinations !== 'object') return undefined
    const excludedPlatforms = cleanList(destinations.excludedPlatforms)
    const excludedConnections = cleanList(destinations.excludedConnections)
    if (!excludedPlatforms && !excludedConnections) return undefined
    return {
        ...(excludedPlatforms ? { excludedPlatforms } : {}),
        ...(excludedConnections ? { excludedConnections } : {}),
    }
}

/**
 * Pure membership decision. Platform entries are case-insensitive (they are registry
 * ids); connection ids are exact stable ids. Liveness (paused/disabled connection)
 * is deliberately irrelevant: policy attaches to the login identity, never its
 * current state — exclusions must not be "forgiven" while a connection is paused.
 */
export function isExcludedFromDestinations(
    destinations: AddonDescriptor['destinations'] | null | undefined,
    target: DestinationTarget,
): boolean {
    if (!destinations || typeof destinations !== 'object') return false
    const platform = (target.platform || '').toLowerCase()
    if (platform && (destinations.excludedPlatforms || []).some(p => (p || '').trim().toLowerCase() === platform)) return true
    const connId = target.connectionId
    if (connId && (destinations.excludedConnections || []).includes(connId)) return true
    return false
}

export function isAddonExcludedFrom(addon: Pick<AddonDescriptor, 'destinations'>, target: DestinationTarget): boolean {
    return isExcludedFromDestinations(addon?.destinations, target)
}

/**
 * The policy-only projection of a list for one target: excluded rows are removed,
 * everything else passes through untouched (order, object identity, enabled flags —
 * enabled filtering stays with the callers that already own it).
 */
export function effectiveAddonsFor<T extends Pick<AddonDescriptor, 'transportUrl' | 'destinations'>>(addons: T[], target: DestinationTarget): T[] {
    return (addons || []).filter(a => !isExcludedFromDestinations(a?.destinations, target))
}

/**
 * Normalized transport URLs of the rows a target's policy excludes. Used to
 * authorize policy-driven shrinks (every removed URL must be a deliberate exclusion)
 * and to make chain guards exclusion-aware on the server twin.
 */
export function excludedUrlsFor(addons: Pick<AddonDescriptor, 'transportUrl' | 'destinations'>[], target: DestinationTarget): Set<string> {
    const out = new Set<string>()
    for (const a of addons || []) {
        if (isExcludedFromDestinations(a?.destinations, target)) {
            const url = normalizeAddonUrl(a?.transportUrl || '')
            if (url) out.add(url)
        }
    }
    return out
}

/**
 * Provider-wire projection (R9): drivers receive projected provider data only —
 * strip the internal destination policy before any direct driver call. The
 * AIOManager-internal wires (client→server reconcile, cloud sync, export) keep
 * destinations; provider drivers never do.
 */
export function stripDestinationsForWire<T extends { destinations?: AddonDescriptor['destinations'] }>(addons: T[]): T[] {
    return (addons || []).map(a => {
        if (!a?.destinations) return a
        const { destinations: _destinations, ...rest } = a
        return rest as T
    })
}
