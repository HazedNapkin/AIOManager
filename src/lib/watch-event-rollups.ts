import type { WatchEvent } from '@/types/activity'
import { capWatchEvents } from './watch-event-cap.ts'

// All-time aggregates for events evicted by the cap. An evicted event exists ONLY here,
// so all-time stats sum events + rollups without double counting. Remote sync merge takes
// the max per key because both devices derived aggregates from overlapping event sets.
export interface EventRollups {
    byMonth: Record<string, { count: number; minutes: number }>
    daysByAccount: Record<string, string[]>
    // accountId -> newest event_ts already folded; guards against re-folding the same
    // evicted events on repeated sync merges (which would inflate minutes).
    foldedThrough: Record<string, number>
}

export function emptyRollups(): EventRollups {
    return { byMonth: {}, daysByAccount: {}, foldedThrough: {} }
}

function toLocalDayKey(timestamp: number): string {
    const date = new Date(timestamp)
    if (isNaN(date.getTime())) return 'unknown'
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
}

function toMonthKey(event: WatchEvent): string {
    const date = new Date(event.event_ts)
    const month = String(date.getMonth() + 1).padStart(2, '0')
    return `${event.accountId}:${event.itemId}:${date.getFullYear()}-${month}`
}

export function foldEvicted(events: WatchEvent[], rollups: EventRollups): EventRollups {
    if (events.length === 0) return rollups

    const byMonth = { ...rollups.byMonth }
    const daysByAccount: Record<string, Set<string>> = {}
    // Guard compares against the pre-fold watermark only, so an unsorted batch never skips an event.
    const baseWatermark: Record<string, number> = {}
    const newWatermark: Record<string, number> = {}
    const foldedThrough = { ...rollups.foldedThrough }

    for (const event of events) {
        let highWater = baseWatermark[event.accountId]
        if (highWater === undefined) {
            const existing = rollups.foldedThrough[event.accountId]
            highWater = existing === undefined ? -Infinity : existing
            baseWatermark[event.accountId] = highWater
        }
        if (event.event_ts <= highWater) continue

        const key = toMonthKey(event)
        const entry = byMonth[key]
        if (entry) {
            byMonth[key] = { count: entry.count + 1, minutes: entry.minutes + (event.time_watched || 0) / 60000 }
        } else {
            byMonth[key] = { count: 1, minutes: (event.time_watched || 0) / 60000 }
        }

        let days = daysByAccount[event.accountId]
        if (!days) {
            days = new Set(rollups.daysByAccount[event.accountId] || [])
            daysByAccount[event.accountId] = days
        }
        days.add(toLocalDayKey(event.event_ts))

        if (event.event_ts > (newWatermark[event.accountId] ?? -Infinity)) {
            newWatermark[event.accountId] = event.event_ts
        }
    }

    for (const [accountId, ts] of Object.entries(newWatermark)) {
        foldedThrough[accountId] = Math.max(foldedThrough[accountId] ?? -Infinity, ts)
    }

    const nextDaysByAccount: Record<string, string[]> = {}
    for (const [accountId, days] of Object.entries(daysByAccount)) {
        nextDaysByAccount[accountId] = Array.from(days).sort()
    }

    return { byMonth, daysByAccount: { ...rollups.daysByAccount, ...nextDaysByAccount }, foldedThrough }
}

export function capWatchEventsWithRollups(
    events: WatchEvent[],
    rollups: EventRollups
): { kept: WatchEvent[]; evicted: WatchEvent[]; rollups: EventRollups } {
    const kept = capWatchEvents(events)
    if (kept === events) return { kept, evicted: [], rollups }

    const keptIds = new Set(kept.map(e => e.id))
    const evicted = events.filter(e => !keptIds.has(e.id))
    return { kept, evicted, rollups: foldEvicted(evicted, rollups) }
}

export function mergeRollups(local: EventRollups, remote: EventRollups): EventRollups {
    if (Object.keys(remote.byMonth).length === 0 && Object.keys(remote.daysByAccount).length === 0 && Object.keys(remote.foldedThrough).length === 0) {
        return local
    }

    const byMonth: Record<string, { count: number; minutes: number }> = { ...local.byMonth }
    for (const [key, entry] of Object.entries(remote.byMonth)) {
        const existing = byMonth[key]
        if (!existing) {
            byMonth[key] = { ...entry }
        } else {
            byMonth[key] = {
                count: Math.max(existing.count, entry.count),
                minutes: Math.max(existing.minutes, entry.minutes),
            }
        }
    }

    const daysByAccount: Record<string, string[]> = { ...local.daysByAccount }
    for (const [accountId, remoteDays] of Object.entries(remote.daysByAccount)) {
        if (remoteDays.length === 0) continue
        const merged = new Set([...(daysByAccount[accountId] || []), ...remoteDays])
        daysByAccount[accountId] = Array.from(merged).sort()
    }

    const foldedThrough: Record<string, number> = { ...local.foldedThrough }
    for (const [accountId, ts] of Object.entries(remote.foldedThrough)) {
        if (!(accountId in foldedThrough) || ts > foldedThrough[accountId]) foldedThrough[accountId] = ts
    }

    return { byMonth, daysByAccount, foldedThrough }
}

export function hasRollupData(rollups: EventRollups | undefined): rollups is EventRollups {
    return !!rollups && (Object.keys(rollups.byMonth).length > 0 || Object.keys(rollups.daysByAccount).length > 0)
}
