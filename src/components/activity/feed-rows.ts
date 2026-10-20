import type { ActivityItem } from '../../types/activity'

// Pure row-model helpers for the ActivityFeed long-history windowing.
// Kept DOM-free so they run under `node --test` (see feed-rows.test.ts).
// The component layers @tanstack/react-virtual on top of this model.

export type FeedViewMode = 'grid' | 'list'

export interface DateGroup {
    date: string
    dateId: string
    items: ActivityItem[]
    watchCount: number
}

export type FeedRow =
    | { kind: 'section'; key: string; date: string; dateId: string; items: ActivityItem[]; watchCount: number }
    | { kind: 'header'; key: string; date: string; dateId: string; watchCount: number }
    | { kind: 'cards'; key: string; date: string; items: ActivityItem[]; first: boolean; last: boolean }

export interface BuildFeedRowsOptions {
    viewMode: FeedViewMode
    /** Grid column count; list mode always forces 1 regardless of this value. */
    columns: number
    /** Groups spanning at most this many card lines render as one whole section row. Default 3. */
    smallGroupRows?: number
    /** Total row budget above which the feed switches to windowed rendering. Default 60. */
    virtualizeThreshold?: number
    /** Revealed-item budget above which the feed switches to windowed rendering, even
     *  when the row count is still small (wide grids pack many cards per row). Default 120. */
    virtualizeItemThreshold?: number
}

export interface FeedRowsResult {
    rows: FeedRow[]
    totalRows: number
    shouldVirtualize: boolean
    /** Item id → index of the row that renders it (cards rows only). */
    itemIdToRowIndex: Map<string, number>
    /** One entry per date group: where its `activity-date-<dateId>` anchor belongs. */
    groupAnchors: Array<{ dateId: string; rowIndex: number; key: string }>
    /** How many items are actually revealed (≤ visibleCount). */
    visibleItemCount: number
    /** Groups of the revealed slice (plain-rendering path); watchCount is the FULL day total. */
    visibleGroups: DateGroup[]
}

function compareNewestFirst(a: ActivityItem, b: ActivityItem): number {
    const ta = new Date(a.timestamp).getTime()
    const tb = new Date(b.timestamp).getTime()
    return (isNaN(tb) ? -Infinity : tb) - (isNaN(ta) ? -Infinity : ta)
}

export function sortFeedItems(items: ActivityItem[]): ActivityItem[] {
    return [...items].sort(compareNewestFirst)
}

function toDateId(dateStr: string): string {
    if (dateStr === 'Unknown Date') return ''
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return ''
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Same grouping semantics the feed always had: newest-first, one bucket per calendar day, invalid timestamps last. */
export function groupByDate(items: ActivityItem[]): DateGroup[] {
    const dates: string[] = []
    const itemsByDate: Record<string, ActivityItem[]> = {}

    for (const item of sortFeedItems(items)) {
        const date = new Date(item.timestamp)
        const dateStr = isNaN(date.getTime()) ? 'Unknown Date' : date.toDateString()
        if (!itemsByDate[dateStr]) {
            itemsByDate[dateStr] = []
            dates.push(dateStr)
        }
        itemsByDate[dateStr].push(item)
    }

    return dates.map(date => ({ date, dateId: toDateId(date), items: itemsByDate[date], watchCount: itemsByDate[date].length }))
}

/**
 * Slice-first row model: exactly `visibleCount` items are revealed (item-boundary
 * cut, mid-group allowed), then grouped and decomposed into windowable rows.
 * Small groups stay a single `section` row so short histories keep the exact
 * DOM they always had; large groups become a header row plus one row per card
 * line so same-day outliers can be windowed instead of mounted wholesale.
 * `watchCount` on headers/sections reports the FULL day total (pre-slice), so
 * date chips never understate a day that is still being revealed.
 */
export function buildFeedRows(items: ActivityItem[], visibleCount: number, options: BuildFeedRowsOptions): FeedRowsResult {
    const columns = options.viewMode === 'list' ? 1 : Math.max(1, Math.round(options.columns))
    const smallGroupRows = options.smallGroupRows ?? 3
    const virtualizeThreshold = options.virtualizeThreshold ?? 60
    const virtualizeItemThreshold = options.virtualizeItemThreshold ?? 120

    const sorted = sortFeedItems(items)
    const visibleItemCount = Math.max(0, Math.min(visibleCount, sorted.length))
    const sliced = visibleItemCount === sorted.length ? sorted : sorted.slice(0, visibleItemCount)

    const groups = groupByDate(sliced)
    const fullDayCounts = new Map(groupByDate(items).map(g => [g.date, g.watchCount]))

    const rows: FeedRow[] = []
    const groupAnchors: FeedRowsResult['groupAnchors'] = []
    const itemIdToRowIndex = new Map<string, number>()

    for (const group of groups) {
        const lines = Math.ceil(group.items.length / columns)
        const watchCount = fullDayCounts.get(group.date) ?? group.items.length

        if (lines <= smallGroupRows) {
            const rowIndex = rows.length
            groupAnchors.push({ dateId: group.dateId, rowIndex, key: `s:${group.date}` })
            rows.push({ kind: 'section', key: `s:${group.date}`, date: group.date, dateId: group.dateId, items: group.items, watchCount })
            // Section items need row indices too: focus pinning and keyboard
            // jumps to unmounted cards rely on the map for every visible item.
            for (const entry of group.items) itemIdToRowIndex.set(entry.id, rowIndex)
            continue
        }

        groupAnchors.push({ dateId: group.dateId, rowIndex: rows.length, key: `h:${group.date}` })
        rows.push({ kind: 'header', key: `h:${group.date}`, date: group.date, dateId: group.dateId, watchCount })

        for (let line = 0; line < lines; line++) {
            const chunk = group.items.slice(line * columns, line * columns + columns)
            const rowIndex = rows.length
            rows.push({ kind: 'cards', key: `c:${group.date}:${line}`, date: group.date, items: chunk, first: line === 0, last: line === lines - 1 })
            for (const entry of chunk) itemIdToRowIndex.set(entry.id, rowIndex)
        }
    }

    return {
        rows,
        totalRows: rows.length,
        shouldVirtualize: rows.length > virtualizeThreshold || visibleItemCount > virtualizeItemThreshold,
        itemIdToRowIndex,
        groupAnchors,
        visibleItemCount,
        visibleGroups: groups.map(group => ({ ...group, watchCount: fullDayCounts.get(group.date) ?? group.watchCount })),
    }
}

/** Visual item order across all rows (matches the revealed sort order). */
export function buildItemOrder(rows: FeedRow[]): string[] {
    const order: string[] = []
    for (const row of rows) {
        if (row.kind === 'header') continue
        for (const entry of row.items) order.push(entry.id)
    }
    return order
}

/** Linear focus movement along the visual item order; null at the ends. */
export function resolveFocusTarget(order: string[], currentId: string, delta: number): string | null {
    const index = order.indexOf(currentId)
    if (index < 0) return null
    const next = index + delta
    if (next < 0 || next >= order.length) return null
    return order[next]
}

/** Tailwind default viewport breakpoints used by the feed grid (grid-cols-2 sm:3 md:4 lg:5 xl:6). */
export const GRID_BREAKPOINT_COLUMNS: ReadonlyArray<{ minWidth: number; columns: number }> = [
    { minWidth: 1280, columns: 6 },
    { minWidth: 1024, columns: 5 },
    { minWidth: 768, columns: 4 },
    { minWidth: 640, columns: 3 },
]

export function detectGridColumns(matches: (query: string) => boolean, fallback = 2): number {
    for (const breakpoint of GRID_BREAKPOINT_COLUMNS) {
        if (matches(`(min-width: ${breakpoint.minWidth}px)`)) return breakpoint.columns
    }
    return fallback
}

const GRID_GAP = 16
const LIST_SPACING = 12
const LIST_CARD_HEIGHT = 134
const GRID_META_HEIGHT = 40

/** Best-effort row size estimates; runtime measurement corrects them after mount. */
export function estimateRowHeight(
    row: FeedRow,
    context: { viewMode: FeedViewMode; columns: number; containerWidth: number },
): number {
    const columns = context.viewMode === 'list' ? 1 : Math.max(1, context.columns)
    const width = Math.max(120, context.containerWidth)
    const columnWidth = (width - (columns - 1) * GRID_GAP) / columns
    const gridLine = columnWidth * 1.5 + GRID_META_HEIGHT

    if (row.kind === 'header') return 20 + 12
    if (row.kind === 'cards') {
        if (context.viewMode === 'list') return LIST_CARD_HEIGHT + LIST_SPACING
        return gridLine + (row.first ? LIST_SPACING : GRID_GAP)
    }
    const lines = Math.ceil(row.items.length / columns)
    const body = context.viewMode === 'list'
        ? lines * LIST_CARD_HEIGHT + (lines - 1) * LIST_SPACING
        : lines * gridLine + (lines - 1) * GRID_GAP
    return 24 + 20 + 12 + body
}

export function findRowIndexByKey(rows: FeedRow[], key: string): number {
    return rows.findIndex(row => row.key === key)
}
