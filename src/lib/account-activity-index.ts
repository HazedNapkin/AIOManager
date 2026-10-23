import type { ActivityItem } from '../types/activity.ts'

// Library publications are immutable. Build one account index per array, shared
// by all card/list-row selectors; loading/progress updates can then reuse it.
// Weak keys release an index when its library snapshot is no longer retained.
const indexes = new WeakMap<ActivityItem[], Map<string, ActivityItem[]>>()
const emptyItems: ActivityItem[] = []

export function activityForAccount(items: ActivityItem[], accountId: string): ActivityItem[] {
    let index = indexes.get(items)
    if (!index) {
        index = new Map()
        for (const item of items) {
            const group = index.get(item.accountId)
            if (group) group.push(item)
            else index.set(item.accountId, [item])
        }
        indexes.set(items, index)
    }
    return index.get(accountId) ?? emptyItems
}
