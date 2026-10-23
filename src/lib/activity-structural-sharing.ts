import type { ActivityItem } from '@/types/activity'

// Compare every stored field, including dates and optional/nested metadata.
// Unsupported object types are treated as changed rather than guessed equal.
function sameValue(previous: unknown, next: unknown): boolean {
    if (Object.is(previous, next)) return true
    if (previous instanceof Date && next instanceof Date) return Object.is(previous.getTime(), next.getTime())
    if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') return false
    const prototype = Object.getPrototypeOf(previous)
    if (prototype !== Object.getPrototypeOf(next)) return false
    if (prototype !== Object.prototype && prototype !== null && !Array.isArray(previous)) return false
    const keys = Reflect.ownKeys(previous)
    if (keys.length !== Reflect.ownKeys(next).length) return false
    return keys.every(key => Object.prototype.hasOwnProperty.call(next, key)
        && sameValue((previous as Record<PropertyKey, unknown>)[key], (next as Record<PropertyKey, unknown>)[key]))
}

export function reuseActivityItems(previous: ActivityItem[], next: ActivityItem[]): ActivityItem[] {
    if (previous === next) return previous
    let byId: Map<string, ActivityItem> | undefined
    const shared = next.map((item, index) => {
        if (previous[index] === item) return item
        byId ??= new Map(previous.map(prior => [prior.id, prior]))
        const prior = byId.get(item.id)
        return prior && sameValue(prior, item) ? prior : item
    })
    return previous.length === shared.length && shared.every((item, index) => item === previous[index]) ? previous : shared
}

export function reuseDeletedItemIds(previous: Set<string>, ids: Iterable<string>): Set<string> {
    const next = new Set(ids)
    return previous.size === next.size && [...next].every(id => previous.has(id)) ? previous : next
}
