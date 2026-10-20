// External progress feeds (RealStream, Nuvio) are full snapshots: every incoming item is the
// current truth for that video. A stored external event that shares video_id AND watch-day with
// an incoming item but sits under a different event id is the same watch recorded under a legacy
// identity shape (e.g. pre-fix RealStream ids derived from video_id instead of tt:s:e) — a
// duplicate. The same-day requirement keeps history: a prior-day event for the same video is a
// legitimate earlier watch (rewatches), not a duplicate.

export interface ExternalEventLike {
    id: string
    accountId: string
    source?: string
    sourceConnectionId?: string
    video_id?: string
    itemId: string
}

export interface EvictionContext {
    platform: string
    accountId: string
    /** When the incoming feed belongs to one connection, sibling connections' events are NOT duplicates. */
    sourceConnectionId?: string
    incomingEventIds: Set<string>
    incomingDayVideoKeys: Set<string>
}

export function isLegacyExternalDuplicate(event: ExternalEventLike, dayKey: string, ctx: EvictionContext): boolean {
    if (event.accountId !== ctx.accountId) return false
    if (event.source !== ctx.platform) return false
    // Per-connection feeds: an event recorded under a DIFFERENT connection of the same
    // platform is another login's watch, never a legacy duplicate of this feed — even
    // when it shares video_id and watch-day. Unattributed (legacy) events predate
    // multiplicity and may still be duplicates of any connection's feed.
    if (ctx.sourceConnectionId && event.sourceConnectionId && event.sourceConnectionId !== ctx.sourceConnectionId) return false
    if (ctx.incomingEventIds.has(event.id)) return false
    return ctx.incomingDayVideoKeys.has(`${dayKey}:${event.video_id || event.itemId}`)
}

export function evictLegacyExternalEvents<T extends ExternalEventLike>(events: T[], ctx: EvictionContext, dayKeyOf: (e: T) => string): T[] {
    return events.filter(e => !isLegacyExternalDuplicate(e, dayKeyOf(e), ctx))
}
