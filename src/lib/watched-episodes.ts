// Maps a decoded WatchedBitField onto real episodes via the series' ordered Cinemeta video list,
// with a fail-closed anchor checksum so we never log an episode the user did not watch.
//
// The anchor (decoded.videoId) is the LAST-watched episode, so it must equal videos[maxWatchedBit].id.
// If it doesn't, the bitfield was built against a different ordering than we fetched (kitsu-anchored
// bitfield vs a cinemeta tt list, reordered/extended meta, etc.) -> return null, emit nothing.
// Validated against real items: every tt-anchored show matches (incl. Law & Order SVU's 441 eps with
// a specials offset); kitsu-anchored shows correctly fail the checksum.

export interface MetaVideo {
    id: string
    season?: number | null
    episode?: number | null
}

export interface WatchedEpisode {
    index: number
    videoId: string
    season: number | null
    episode: number | null
}

export interface DecodedLike {
    videoId: string
    length: number
    watchedIndices: number[]
}

export function resolveWatchedEpisodes(decoded: DecodedLike | null, videos: MetaVideo[] | null): WatchedEpisode[] | null {
    if (!decoded || !Array.isArray(videos) || videos.length === 0) return null
    const bits = decoded.watchedIndices
    if (!bits || bits.length === 0) return null

    const maxBit = bits[bits.length - 1]
    const anchor = videos[maxBit]
    if (!anchor || anchor.id !== decoded.videoId) return null // checksum: fail closed

    const episodes: WatchedEpisode[] = []
    for (const idx of bits) {
        const v = videos[idx]
        if (!v || !v.id) return null // span exceeds the meta list -> not aligned, fail closed
        episodes.push({ index: idx, videoId: v.id, season: v.season ?? null, episode: v.episode ?? null })
    }
    return episodes
}

const META_TTL_MS = 6 * 60 * 60 * 1000
const META_CACHE_MAX = 1000
const metaCache = new Map<string, { videos: MetaVideo[]; ts: number }>()

// Cinemeta is CORS-open, so fetch directly. tt... only (kitsu/other namespaces are indexed against a
// different meta ordering and would mis-map; they fail closed).
export async function fetchSeriesVideos(seriesId: string): Promise<MetaVideo[] | null> {
    const base = String(seriesId || '').split(':')[0]
    if (!base.startsWith('tt')) return null

    const cached = metaCache.get(base)
    if (cached && Date.now() - cached.ts < META_TTL_MS) return cached.videos

    try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 10000)
        const res = await fetch(`https://v3-cinemeta.strem.io/meta/series/${base}.json`, { signal: ctrl.signal }).finally(() => clearTimeout(t))
        if (!res.ok) return null
        const json = await res.json()
        const videos = json?.meta?.videos
        if (!Array.isArray(videos)) return null

        if (metaCache.size >= META_CACHE_MAX) {
            const oldest = [...metaCache.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, metaCache.size - META_CACHE_MAX + 1)
            for (const [k] of oldest) metaCache.delete(k)
        }
        metaCache.set(base, { videos, ts: Date.now() })
        return videos
    } catch {
        return null
    }
}
