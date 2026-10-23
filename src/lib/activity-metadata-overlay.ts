// Shared display-metadata overlay for Activity rows whose source only provided a
// raw provider identifier as the title (e.g. a second connection reporting
// "kitsu:43248" while its sibling already shows the real name). Pure helpers —
// the fetching itself lives in cinemeta-cache.ts / kitsu-meta.ts.
//
// Leaf module by design: only type-only imports, so the local node --test suite
// can execute it directly.

import type { ActivityItem } from '../types/activity.ts'
import { parseKitsuId } from './kitsu-meta.ts'

// Same shape as the inline regex kept in useWatchHistory.ts / ActivityPage.tsx:
// an anchored, full-match raw provider id is a placeholder, not a title.
const RAW_IDENTIFIER_NAME_RE = /^(tt\d{7,}|kitsu:\d+(?::\d+){0,2}|mv:\d+|show:\d+|tmdb:\d+|mal:\d+|anilist:\d+|anidb:\d+|tvdb:\d+)$/i

export interface ResolvedMetadata {
    name: string
    poster?: string
    genres?: string[]
}

export function isUnresolvedActivityName(name: string | undefined | null): boolean {
    if (!name || typeof name !== 'string') return true
    const trimmed = name.trim()
    return !trimmed || trimmed === 'Unknown Title' || RAW_IDENTIFIER_NAME_RE.test(trimmed)
}

export type PendingMetadataTarget =
    | { kind: 'imdb'; itemId: string }
    | { kind: 'kitsu'; itemId: string; kitsuId: string }

/**
 * Collect the unresolved rows a resolver pass should work on, in feed order,
 * deduped by itemId (two connections watching the same id resolve once).
 * Rows with configured names are never collected: resolution only ever fills
 * blank/identifier titles — it never overrides real metadata.
 */
export function collectUnresolvedMetadataTargets(
    history: Array<Pick<ActivityItem, 'itemId' | 'uniqueItemId' | 'name'>>,
    resolved: { has(itemId: string): boolean },
): PendingMetadataTarget[] {
    const targets: PendingMetadataTarget[] = []
    const seen = new Set<string>()
    for (const item of history) {
        if (!item?.itemId || seen.has(item.itemId) || resolved.has(item.itemId)) continue
        if (!isUnresolvedActivityName(item.name)) continue
        if (item.itemId.startsWith('tt')) {
            seen.add(item.itemId)
            targets.push({ kind: 'imdb', itemId: item.itemId })
            continue
        }
        // Episode rows can carry the provider id on the episode-aware unique id
        // (e.g. itemId "kitsu:43248", uniqueItemId "kitsu:43248:1:6"); accept both.
        const kitsuId = parseKitsuId(item.itemId) ?? parseKitsuId(item.uniqueItemId)
        if (kitsuId) {
            seen.add(item.itemId)
            targets.push({ kind: 'kitsu', itemId: item.itemId, kitsuId })
        }
    }
    return targets
}

/**
 * Apply resolved metadata over feed items: replace only bad names, fill only
 * missing poster/genres. IDs, provenance and watch state are untouched, and the
 * input array/objects are never mutated. Returns the same array reference when
 * nothing changed so downstream memoization stays stable.
 */
export function applyResolvedMetadataOverlay(
    items: ActivityItem[],
    resolved: Map<string, ResolvedMetadata>,
): ActivityItem[] {
    if (resolved.size === 0) return items
    let changed = false
    const next = items.map(item => {
        if (!isUnresolvedActivityName(item.name)) return item
        const entry = resolved.get(item.itemId)
        if (!entry) return item
        changed = true
        return {
            ...item,
            name: entry.name,
            poster: item.poster || entry.poster || item.poster,
            genres: item.genres?.length ? item.genres : entry.genres,
        }
    })
    return changed ? next : items
}
