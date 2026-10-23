// Per-addon destination policy: a deny-list on the hub row. Absent/empty policy means
// "sync everywhere" — bit-for-bit the pre-feature behavior. The hub stays the single
// superset; destinations only decide per-target membership at every fan-out point.
//
// Pure leaf module (type import + addon-url normalizer only) so it stays importable
// under the node:test runner and from every sync path without cycles. The server twin
// lives at server/utils/addon-destinations.js — its PROJECTION semantics (membership
// decisions and wire stripping) must stay identical; it does not carry `revision`
// (harmless: revision never affects membership, and a `{ revision }` clear tombstone
// projects to "no exclusions" on both sides).
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

/** Finite positive numbers only; anything else (junk, NaN, negatives) is pre-revision data. */
const cleanRevision = (value: unknown): number | undefined => {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n) || n <= 0) return undefined
    return Math.floor(n)
}

/**
 * Sanitize stored/imported policy: trim, drop empties, dedupe, sort (stable
 * serialization for fingerprints and cloud round-trips). Returns undefined when no
 * effective exclusion remains AND no valid revision is carried, so "no policy" stays
 * representable as an absent field. A cleared policy that carries a revision survives
 * as the tombstone `{ revision }` — the clear must be able to propagate to other
 * devices, and behaviorally it is identical to an absent policy.
 */
export function normalizeDestinations(destinations?: AddonDescriptor['destinations'] | null): AddonDescriptor['destinations'] | undefined {
    if (!destinations || typeof destinations !== 'object') return undefined
    const excludedPlatforms = cleanList(destinations.excludedPlatforms)
    const excludedConnections = cleanList(destinations.excludedConnections)
    const revision = cleanRevision(destinations.revision)
    if (!excludedPlatforms && !excludedConnections && revision === undefined) return undefined
    return {
        ...(excludedPlatforms ? { excludedPlatforms } : {}),
        ...(excludedConnections ? { excludedConnections } : {}),
        ...(revision !== undefined ? { revision } : {}),
    }
}

/**
 * Next revision for a deliberate policy write (set or clear): wall clock, but never
 * less than one past the current value — a device with a skewed/stale clock, or one that
 * adopted a future-dated remote revision, still produces a strictly greater revision so
 * the write wins the LWW merge instead of silently losing to the value it replaced.
 */
export function nextPolicyRevision(currentRevision?: number): number {
    return Math.max(Date.now(), Math.floor(currentRevision || 0) + 1)
}

/** Canonical string of the exclusion lists only (revision excluded) — the LWW tie-break key. */
const policyContentKey = (d: NonNullable<AddonDescriptor['destinations']>): string =>
    JSON.stringify({
        // Platform entries are lowercased for the comparison only: matching at read
        // time is case-insensitive (they are registry ids), so two policies that
        // differ ONLY in platform casing are behaviorally identical and must tie as
        // identical content instead of letting the tie-break flip between
        // cosmetically-different winners. Connection ids stay case-sensitive
        // (exact stable ids).
        excludedPlatforms: (d.excludedPlatforms || []).map(p => p.toLowerCase()),
        excludedConnections: d.excludedConnections || [],
    })

/** Case-sensitive canonical content key — the byte-stability tie-break inside an equal-content tie. */
const rawPolicyContentKey = (d: NonNullable<AddonDescriptor['destinations']>): string =>
    JSON.stringify({ excludedPlatforms: d.excludedPlatforms || [], excludedConnections: d.excludedConnections || [] })

/**
 * Cross-device policy convergence.
 *
 * Rules:
 * - Neither side carries policy → undefined (default allow stays absent).
 * - Exactly one side carries it → that side wins VERBATIM. An absent side has no
 *   authority: platform/provider reads never carry policy, and pre-revision rows carry
 *   no clock — neither may erase or alter an existing policy.
 * - Both carry one → higher `revision` wins verbatim (LWW). Equal revisions tie-break on
 *   the canonical content key (greater wins) — a content comparison is device-independent,
 *   so both devices pick the same winner and converge. Behaviorally-identical contents
 *   (platform-case-only differences) tie, then tie-break again on the RAW spelling so the
 *   convergence is byte-stable too; identical content keeps the value with the max
 *   revision so the clock never runs backwards.
 *
 * Bounded: one number per row, monotonic via nextPolicyRevision, no growth on merges.
 */
export function mergeDestinationsPolicy(
    local: AddonDescriptor['destinations'] | null | undefined,
    remote: AddonDescriptor['destinations'] | null | undefined,
): AddonDescriptor['destinations'] | undefined {
    const l = normalizeDestinations(local)
    const r = normalizeDestinations(remote)
    if (!l && !r) return undefined
    if (!l) return r
    if (!r) return l
    const revL = l.revision || 0
    const revR = r.revision || 0
    if (revL !== revR) return revL > revR ? l : r
    if (policyContentKey(l) === policyContentKey(r)) return rawPolicyContentKey(l) >= rawPolicyContentKey(r) ? l : r
    return policyContentKey(l) > policyContentKey(r) ? l : r
}

/**
 * Retention invariant for `excludedConnections`: nothing removes an id from a stored
 * policy except an explicit picker edit. A login removal or cloud merge can resurrect
 * the same id later (connection-merge builds from the inbound list), and the retained
 * exclusion is exactly what keeps that resurrection excluded instead of silently
 * default-allow. Dead ids are invisible in the picker (it renders live connections
 * only) and never reach provider wires (stripDestinationsForWire) — physical pruning
 * stays deferred until connection-merge can guarantee an id never returns.
 */

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
