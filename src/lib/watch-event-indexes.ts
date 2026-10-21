import type { WatchEvent } from '@/types/activity'
import { getEpisodeIdentity, getLocalDayKey, watchContextKey, parseStremioDate } from '@/lib/activity-utils'

/**
 * Cached lookup indexes over a watch-event array for the diff/backfill producers.
 *
 * `diffAndRecord` and `recordBackfillEpisodes` historically rebuilt id and
 * session indexes over the ENTIRE event array on every provider refresh —
 * O(total events) per account. Two different lookup families live in those
 * loops, and only one of them is scope-local:
 *
 *   - session keys are `${scope}:${identity}:${localDay}` and identity sets
 *     are per-scope: a diff/backfill for one login only ever looks up its own
 *     scope's keys, so those indexes are partitioned by `eventScopeKey` and a
 *     partition answers lookups exactly like a full-array index would;
 *   - event-ID suppression is NOT scope-local. The store's original code
 *     seeded ids from every event in the array, and canonical migration
 *     (`migrateCanonicalScope`) deliberately rewrites an event's `scopeKey`
 *     while KEEPING its historical id (e.g. bare `account:tt100:<ts>` moving
 *     to scope `account::old-login`). A later diff in the bare `account`
 *     scope must still see that id — otherwise it creates a duplicate event
 *     with the same id and the Map dedup in the merge step silently replaces
 *     the historical row. Ids therefore live in one GLOBAL per-array set that
 *     diff/backfill seeds always receive in full.
 *
 * Indexes are cached in a WeakMap keyed by the exact events-array reference.
 * Producer publications reuse a scope's fold only when its ordered event
 * references are identical; other arrays use a complete fused build:
 *   - any store path that assigns a new events array without warming the cache
 *     simply causes a rebuild on the next lookup — a miss is slower, never stale
 *     (the store never mutates an events array in place);
 *   - consumers get private clones: both call sites seed brand-new events into
 *     their local copies mid-loop, and clones keep a sibling login's concurrent
 *     diff/backfill from observing another scope's in-flight seeds;
 *   - the session fold (latest event_ts wins, detected_ts breaks ties) is
 *     exactly the rule diffAndRecord and collapseDayDuplicates apply, so a
 *     cached build equals a fresh build for the same array.
 *
 * Session keys embed a LOCAL day, so a cached build is only valid for the
 * timezone it was built under. A long-lived page can change system timezone
 * (travel, DST-region switch); every entry is stamped with the timezone
 * identity it was built under, and a changed stamp discards the cached build
 * and the shared day-key memo wholesale (rebuild is always correct; the waste
 * is bounded to once per zone change).
 */
export interface WatchEventScopePartition {
    /** This scope's session winners: `${scope}:${identity}:${localDay}` -> latest event. */
    sessions: Map<string, WatchEvent>
    /** Episode identities present under this scope. */
    identities: Set<string>
}

/** Private mutable seed copies for one diff/backfill pass (global ids + this scope's indexes). */
export interface WatchEventSeedIndexes {
    /**
     * Baseline-exact global id index: O(1) lookups over every event id in the
     * array plus whatever this pass adds. Implemented as an overlay so a seed
     * never copies the O(total events) cached set (the diff path historically
     * rebuilt that set per call — copying it back per call would reintroduce
     * exactly that cost).
     */
    ids: SeedIdIndex
    sessions: Map<string, WatchEvent>
    identities: Set<string>
}

/**
 * Read-through id index: `has` consults this pass's additions first, then the
 * cached per-array global set. Mutations stay local to the seed, so the
 * canonical cache is immune by construction (no clone of the full set).
 */
class SeedIdIndex {
    private readonly base: ReadonlySet<string>
    private readonly added = new Set<string>()
    constructor(base: ReadonlySet<string>) {
        this.base = base
    }
    has(id: string): boolean {
        return this.added.has(id) || this.base.has(id)
    }
    add(id: string): void {
        this.added.add(id)
    }
}

interface ScopeIndexEntry {
    /** Timezone stamp this entry (and the day-key memo cleared for it) is valid under. */
    tz: string
    /** All event ids in the array regardless of scope — O(1) lookup, cloned into seeds. */
    globalIds: Set<string>
    scopes: Map<string, WatchEventScopePartition>
    /** Ordered immutable event references used to prove a scope's fold is unchanged. */
    eventsByScope: Map<string, WatchEvent[]>
}

// The local day of a timestamp is a pure function of (timestamp, timezone):
// getLocalDayKey allocates a Date plus formatted strings per call and the diff
// paths re-derive day keys for the same timestamps on every refresh. The memo
// is keyed by timestamp ONLY, so it is cleared wholesale whenever the timezone
// stamp changes (see ScopeIndexEntry.tz) — that keeps it exact for a page that
// changes zones while loaded. Wholesale clear on overflow keeps the bound
// trivial and correctness unaffected.
const dayKeyByTs = new Map<number, string>()
const DAY_KEY_MEMO_CAP = 65_536
let dayMemoTz: string | undefined
function dayKeyOf(ts: number): string {
    let key = dayKeyByTs.get(ts)
    if (key === undefined) {
        key = getLocalDayKey(ts)
        if (dayKeyByTs.size >= DAY_KEY_MEMO_CAP) dayKeyByTs.clear()
        dayKeyByTs.set(ts, key)
    }
    return key
}

// parseStremioDate is NOT pure: it clamps far-future input to a LIVE `new Date()`
// (the clamp runs inside the parser, before any caller can inspect the raw value).
// It is also not pure in the TIMEZONE for offset-free date-times: ECMA-262 only
// fixes date-only forms (UTC) and date-times carrying an explicit `Z`/numeric
// offset; everything else resolves its wall time in the runtime's zone. Exact
// memo contract for `stremioTimeOf`:
//   - a string whose raw parse is at/below the tolerance horizon has a stable
//     value (the parsed timestamp itself) forever after, so it is memoizable;
//   - a string whose raw parse is beyond the horizon must NEVER be memoized —
//     its value is "now" and tracks the clock on every call;
//   - clock rollback can push an already-memoized (safely past) timestamp back
//     beyond the horizon: for as long as that holds, the memoized value is
//     bypassed and the live parser answer is returned; when the clock moves
//     forward again the stored value becomes valid once more (the parser would
//     return the same fixed timestamp), so the entry is left in place;
//   - only zone-INDEPENDENT shapes (see zoneIndependentDateShape) may enter the
//     memo at all. The day-key/index caches are invalidated by timezone stamp,
//     but this memo is keyed by string alone; a zone-dependent parse cached
//     under one zone would be served stale after the page changes zones. Such
//     strings bypass the memo and pay the live parser on every call.
const stremioTimeByString = new Map<string, number | undefined>()
const STREMIO_TIME_MEMO_CAP = 65_536
// Mirrors parseStremioDate's own clamp guard (`> Date.now() + 5 * 60 * 1000`).
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000

// Anchored shapes whose `new Date(s)` instant cannot move with the runtime zone
// (ECMA-262 date-time rules; both spec and V8 treat these as fixed instants):
//   - ISO date-only `YYYY-MM-DD` — parsed as UTC;
//   - ISO date-time `YYYY-MM-DDTHH:mm[:ss[.fff]]` terminated by `Z` or a numeric
//     `±HH:MM` offset.
// Deliberately narrower than anything an engine might also fix: offset-free
// date-times (local wall time), space-separated forms, relaxed `YYYY-M-D` and
// all non-ISO fallback formats are treated as zone-DEPENDENT and never cached.
const ZONE_INDEPENDENT_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const ZONE_INDEPENDENT_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/
function zoneIndependentDateShape(dateStr: string): boolean {
    return ZONE_INDEPENDENT_DATE_ONLY.test(dateStr) || ZONE_INDEPENDENT_DATE_TIME.test(dateStr)
}

/** Memoized `parseStremioDate(s)?.getTime()` with the parser's live future-clamp preserved. */
export function stremioTimeOf(dateStr: string | undefined): number | undefined {
    if (!dateStr) return undefined
    if (stremioTimeByString.has(dateStr)) {
        const cached = stremioTimeByString.get(dateStr)
        if (cached === undefined || cached <= Date.now() + FUTURE_TOLERANCE_MS) return cached
        // Clock rolled back past the tolerance horizon: the live parser would
        // clamp to a fresh now, so answer live for the duration of the rollback.
        return parseStremioDate(dateStr)?.getTime()
    }
    // Zone-dependent parse (offset-free date-time or any non-ISO fallback): the
    // answer tracks the runtime zone, so it can never be cached by string alone.
    // Bypassing also sidesteps the same-current-offset trap — two zones can
    // share today's offset yet disagree on a historical date, so no offset-keyed
    // invalidation could cover it. Future-clamp and clock-rollback semantics
    // are inherently live on this path. Stremio's actual values are ISO `Z`
    // strings, so this stays off the producer hot path.
    if (!zoneIndependentDateShape(dateStr)) return parseStremioDate(dateStr)?.getTime()
    // Decide future-ness from the RAW parse: parseStremioDate has already
    // clamped by the time it returns, so its answer cannot distinguish a
    // future input from a genuine "now".
    const raw = new Date(dateStr).getTime()
    if (!Number.isNaN(raw) && raw > Date.now() + FUTURE_TOLERANCE_MS) return parseStremioDate(dateStr)?.getTime()
    const ts = parseStremioDate(dateStr)?.getTime()
    if (stremioTimeByString.size >= STREMIO_TIME_MEMO_CAP) stremioTimeByString.clear()
    stremioTimeByString.set(dateStr, ts)
    return ts
}

// Canonical index entries are keyed by the exact array reference and are only ever
// written by the builders; producers get clones of the sets/maps they need.
const indexesByArray = new WeakMap<WatchEvent[], ScopeIndexEntry>()

/**
 * Timezone identity the local-day keys are currently valid under. The IANA zone
 * name (what a browser updates when the system zone changes) plus the current
 * UTC offset as a fallback for environments where the zone name lags; a
 * same-zone DST shift changes only the offset and triggers a conservative
 * rebuild, which costs correctness nothing.
 */
function timezoneStamp(): string {
    let zone = ''
    try {
        zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
    } catch {
        zone = ''
    }
    return `${zone}|${new Date().getTimezoneOffset()}`
}

/** Fold in array order so exact timestamp ties keep the original first winner. */
function addToPartition(partition: WatchEventScopePartition, scope: string, event: WatchEvent): void {
    const identity = getEpisodeIdentity(event.itemId, event.video_id, event.season, event.episode, event.type)
    partition.identities.add(identity)
    const key = `${scope}:${identity}:${dayKeyOf(event.event_ts)}`
    const existing = partition.sessions.get(key)
    if (
        !existing ||
        event.event_ts > existing.event_ts ||
        (event.event_ts === existing.event_ts && event.detected_ts > existing.detected_ts)
    ) {
        partition.sessions.set(key, event)
    }
}

/** One fused pass over the array: global ids, per-scope session winners and identities. */
function buildIndexEntry(events: WatchEvent[], tz: string): ScopeIndexEntry {
    const globalIds = new Set<string>()
    const scopes = new Map<string, WatchEventScopePartition>()
    const eventsByScope = new Map<string, WatchEvent[]>()
    for (const event of events) {
        globalIds.add(event.id)
        const scope = event.scopeKey ?? watchContextKey(event.accountId, event.sourceConnectionId)
        let partition = scopes.get(scope)
        if (!partition) {
            partition = { sessions: new Map(), identities: new Set() }
            scopes.set(scope, partition)
            eventsByScope.set(scope, [])
        }
        eventsByScope.get(scope)!.push(event)
        addToPartition(partition, scope, event)
    }
    return { tz, globalIds, scopes, eventsByScope }
}

/**
 * Prepare a producer's next array before publishing it. Unchanged scopes reuse
 * their immutable fold; changed scopes rebuild from the actual final array,
 * after deduplication, tombstones and caps. Ordered reference equality also
 * detects annotations, scope migrations and winner removal without guessing
 * which producer delta survived. IDs always come from the entire final array.
 *
 * Neither the previous entry nor its partitions are mutated: async backfills
 * and readers retaining an earlier array continue to see that array's index.
 * Missing entries and timezone changes use the ordinary complete rebuild.
 */
export function reuseScopePartitionedIndexes(previous: WatchEvent[], events: WatchEvent[]): void {
    const tz = timezoneStamp()
    const cached = indexesByArray.get(previous)
    if (!cached || cached.tz !== tz) {
        buildScopePartitionedIndexes(events)
        return
    }
    if (previous === events) return
    if (dayMemoTz !== tz) {
        dayKeyByTs.clear()
        dayMemoTz = tz
    }

    const globalIds = new Set<string>()
    const eventsByScope = new Map<string, WatchEvent[]>()
    for (const event of events) {
        globalIds.add(event.id)
        const scope = event.scopeKey ?? watchContextKey(event.accountId, event.sourceConnectionId)
        const members = eventsByScope.get(scope)
        if (members) members.push(event)
        else eventsByScope.set(scope, [event])
    }
    const scopes = new Map<string, WatchEventScopePartition>()
    for (const [scope, members] of eventsByScope) {
        const prior = cached.eventsByScope.get(scope)
        if (prior && prior.length === members.length && members.every((event, i) => event === prior[i])) {
            scopes.set(scope, cached.scopes.get(scope)!)
            eventsByScope.set(scope, prior)
        } else {
            const partition = { sessions: new Map<string, WatchEvent>(), identities: new Set<string>() }
            for (const event of members) addToPartition(partition, scope, event)
            scopes.set(scope, partition)
        }
    }
    indexesByArray.set(events, { tz, globalIds, scopes, eventsByScope })
}

/** Rebuild and cache the indexes for exactly this array, under the CURRENT timezone. */
export function buildScopePartitionedIndexes(events: WatchEvent[]): ScopeIndexEntry {
    const tz = timezoneStamp()
    if (dayMemoTz !== tz) {
        dayKeyByTs.clear()
        dayMemoTz = tz
    }
    const entry = buildIndexEntry(events, tz)
    indexesByArray.set(events, entry)
    return entry
}

/** Cached entry for exactly this array, rebuilt when missing or built under a different timezone. */
function indexEntryFor(events: WatchEvent[]): ScopeIndexEntry {
    const tz = timezoneStamp()
    const cached = indexesByArray.get(events)
    if (cached && cached.tz === tz) return cached
    return buildScopePartitionedIndexes(events)
}

/**
 * Canonical cached partitions (scope -> sessions/identities) for exactly this
 * array, built on miss. A timezone change since the cached build discards it
 * and rebuilds under the new zone, so session day-keys can never go stale
 * against the system timezone of a long-lived page.
 */
export function scopePartitionsFor(events: WatchEvent[]): Map<string, WatchEventScopePartition> {
    return indexEntryFor(events).scopes
}

/** Seed for a single diff pass: global-id overlay plus this scope's session winners. */
export function diffSeedIndexes(events: WatchEvent[], scope: string): { ids: SeedIdIndex; sessions: Map<string, WatchEvent> } {
    const entry = indexEntryFor(events)
    const partition = entry.scopes.get(scope)
    return {
        ids: new SeedIdIndex(entry.globalIds),
        sessions: new Map(partition?.sessions ?? emptySessions),
    }
}

/** Seed for a single backfill pass: global-id overlay plus this scope's identities. */
export function backfillSeedIndexes(events: WatchEvent[], scope: string): { ids: SeedIdIndex; identities: Set<string> } {
    const entry = indexEntryFor(events)
    const partition = entry.scopes.get(scope)
    return {
        ids: new SeedIdIndex(entry.globalIds),
        identities: new Set(partition?.identities ?? emptyIdentities),
    }
}

const emptySessions = new Map<string, WatchEvent>()
const emptyIdentities = new Set<string>()

/** Full seed (global-id overlay + this scope's sessions and identities) for one diff/backfill pass. */
export function scopeIndexesFor(events: WatchEvent[], scope: string): WatchEventSeedIndexes {
    const entry = indexEntryFor(events)
    const partition = entry.scopes.get(scope)
    return {
        ids: new SeedIdIndex(entry.globalIds),
        sessions: new Map(partition?.sessions ?? emptySessions),
        identities: new Set(partition?.identities ?? emptyIdentities),
    }
}
