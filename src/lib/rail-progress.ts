export interface RailProgressEvent {
    key: string
    timestamp: number | Date
    progress: number
    backfill?: boolean
}

export interface RailProgressItem {
    key: string
    timestamp: number | Date
    progress: number
}

const toMs = (value: number | Date): number => (value instanceof Date ? value.getTime() : value)

// Rail (live library state) and the activity feed (event log) compute progress differently;
// the event log wins unless the live item is newer (actively being watched) or the event is
// a synthetic backfill, so both surfaces never disagree for the same movie.
export function reconcileRailProgress<T extends RailProgressItem>(
    liveItems: readonly T[],
    events: readonly RailProgressEvent[]
): T[] {
    const latestByKey = new Map<string, RailProgressEvent>()
    for (const event of events) {
        if (event.backfill) continue
        const current = latestByKey.get(event.key)
        if (!current || toMs(event.timestamp) > toMs(current.timestamp)) latestByKey.set(event.key, event)
    }

    return liveItems.map(item => {
        const event = latestByKey.get(item.key)
        if (event && toMs(event.timestamp) >= toMs(item.timestamp)) {
            return { ...item, progress: Math.min(100, Math.max(0, event.progress)) }
        }
        return item
    })
}
