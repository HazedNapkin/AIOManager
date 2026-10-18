import type { JellyfinItem, JellyfinNowPlayingItem } from './types.ts'

type MediaItem = JellyfinItem | JellyfinNowPlayingItem

export function jellyfinImdbId(providers: unknown): string | undefined {
    if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return undefined
    const value = Object.entries(providers).find(([key]) => key.toLowerCase() === 'imdb')?.[1]
    return typeof value === 'string' && /^tt\d+$/.test(value) ? value : undefined
}

/** Resolve parent series in the same authenticated user scope; never use an episode's IMDb ID as its parent. */
export async function resolveJellyfinSeries<T extends MediaItem>(
    items: T[],
    readItem: (id: string, signal: AbortSignal) => Promise<JellyfinItem>,
    signal: AbortSignal,
    previous: MediaItem[] = [],
    limit = 32,
): Promise<T[]> {
    const parents = new Map<string, Record<string, string>>()
    for (const item of previous) {
        if (item.SeriesId && jellyfinImdbId(item.SeriesProviderIds)) parents.set(item.SeriesId, item.SeriesProviderIds!)
    }
    const ids = [...new Set(items.filter(item => item.Type === 'Episode' && typeof item.SeriesId === 'string' && item.SeriesId
        && !/^tt\d+$/.test(item.SeriesId) && !parents.has(item.SeriesId)).map(item => item.SeriesId!))].slice(0, limit)
    // Metadata must not hold valid playback data behind many slow parent reads.
    const metadataSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)])
    for (let start = 0; start < ids.length; start += 4) {
        signal.throwIfAborted()
        if (metadataSignal.aborted) break
        await Promise.all(ids.slice(start, start + 4).map(async id => {
            try {
                const parent = await readItem(id, metadataSignal)
                if (parent.Id === id && parent.Type === 'Series' && jellyfinImdbId(parent.ProviderIds)) parents.set(id, parent.ProviderIds!)
            } catch {
                // Missing or unsupported metadata must not discard valid playback/library reads.
                signal.throwIfAborted()
            }
        }))
    }
    signal.throwIfAborted()
    return items.map(item => item.Type === 'Episode' && item.SeriesId && parents.has(item.SeriesId)
        ? { ...item, SeriesProviderIds: parents.get(item.SeriesId) } : item)
}
