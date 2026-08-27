import type { WatchEvent } from '@/types/activity'

// The global cap floats with account count so large installs (100+ accounts) are not
// strangled by a fixed budget sized for households; it derives from the events themselves.
export const MIN_EVENTS_GLOBAL = 25_000
export const EVENTS_PER_ACCOUNT_GLOBAL = 500
export const MAX_PER_ACCOUNT_GUARANTEE = 2_000

function globalCapFor(accountCount: number): number {
    return Math.max(MIN_EVENTS_GLOBAL, accountCount * EVENTS_PER_ACCOUNT_GLOBAL)
}

// Per-account share is a guaranteed floor reserved against eviction by heavy accounts,
// never a ceiling: an account may use any budget other accounts leave unclaimed.
function guaranteedShare(cap: number, accountCount: number): number {
    return Math.min(MAX_PER_ACCOUNT_GUARANTEE, Math.max(EVENTS_PER_ACCOUNT_GLOBAL, Math.floor(cap / accountCount)))
}

export function capWatchEvents(events: WatchEvent[]): WatchEvent[] {
    const accountIds = new Set(events.map(e => e.accountId))
    const accountCount = accountIds.size
    const cap = globalCapFor(accountCount)
    if (events.length <= cap) return events

    const sorted = [...events].sort((a, b) => b.event_ts - a.event_ts)
    const share = guaranteedShare(cap, accountCount)

    // Walk newest-first giving every account its guaranteed share first; leftover
    // budget then flows to whoever has more history, so a quiet account's events can
    // never be crowded out and a solo binger can use the entire budget.
    const perAccountSeen = new Map<string, number>()
    const kept: WatchEvent[] = []
    let reserved = 0
    for (const e of sorted) {
        const seen = perAccountSeen.get(e.accountId) ?? 0
        if (seen < share) {
            perAccountSeen.set(e.accountId, seen + 1)
            kept.push(e)
            reserved++
        }
        if (reserved >= Math.min(cap, share * accountCount)) break
    }
    if (kept.length < cap) {
        const keptIds = new Set(kept.map(e => e.id))
        for (const e of sorted) {
            if (kept.length >= cap) break
            if (keptIds.has(e.id)) continue
            kept.push(e)
        }
    }

    return kept
}
