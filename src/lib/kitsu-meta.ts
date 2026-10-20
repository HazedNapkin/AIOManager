// Kitsu metadata resolution for anime rows that arrive carrying only a raw kitsu
// identifier (e.g. "kitsu:43248") as their name. Mirrors cinemeta-cache.ts:
// positive/negative TTL, in-flight dedupe and a bounded memory cache, so a page
// of unresolved anime rows can never fan out into unbounded network bursts.
//
// Leaf module by design: no '@/' imports and no import.meta.env usage, so the
// local node --test suite can execute it directly.

export interface KitsuMeta {
    id: string
    name: string
    poster?: string
    genres?: string[]
}

interface KitsuCacheEntry {
    meta: KitsuMeta | null
    fetchedAt: number
}

const kitsuCache = new Map<string, KitsuCacheEntry>()
const kitsuInFlight = new Map<string, Promise<KitsuMeta | null>>()
const KITSU_TTL_MS = 24 * 60 * 60 * 1000
const KITSU_NULL_TTL_MS = 5 * 60 * 1000
const KITSU_CACHE_MAX = 300
const KITSU_TIMEOUT_MS = 8000
const KITSU_ANIME_URL = 'https://kitsu.io/api/edge/anime'
const KITSU_GENRES_MAX = 6

/**
 * Extract the numeric kitsu id from canonical and episode-scoped forms:
 * "kitsu:43248", "KITSU:43248", "kitsu:43248:6" and "kitsu:43248:1:6".
 * Returns null for anything else (including other anime providers).
 */
export function parseKitsuId(raw: string | undefined | null): string | null {
    if (!raw || typeof raw !== 'string') return null
    const parts = raw.trim().split(':')
    if (parts.length < 2 || parts[0].toLowerCase() !== 'kitsu') return null
    const id = parts[1]
    return /^\d+$/.test(id) ? id : null
}

function normalizeKitsuId(raw: string): string | null {
    return parseKitsuId(raw) ?? (/^\d+$/.test(raw.trim()) ? raw.trim() : null)
}

function firstString(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return undefined
}

function extractKitsuGenres(doc: Record<string, unknown>, included: unknown): string[] {
    if (!Array.isArray(included)) return []
    const titlesById = new Map<string, string>()
    for (const entry of included) {
        if (!entry || typeof entry !== 'object') continue
        const category = entry as Record<string, unknown>
        if (category.type !== 'categories') continue
        const attributes = category.attributes
        if (!attributes || typeof attributes !== 'object') continue
        const title = (attributes as Record<string, unknown>).title
        if (typeof title === 'string' && title.trim()) {
            titlesById.set(String(category.id), title.trim())
        }
    }
    const relationships = doc.relationships
    if (!relationships || typeof relationships !== 'object') return []
    const categoriesRef = (relationships as Record<string, unknown>).categories
    if (!categoriesRef || typeof categoriesRef !== 'object') return []
    const refs = (categoriesRef as Record<string, unknown>).data
    if (!Array.isArray(refs)) return []
    const genres: string[] = []
    for (const ref of refs) {
        if (!ref || typeof ref !== 'object') continue
        const link = ref as Record<string, unknown>
        if (link.type !== 'categories') continue
        const title = titlesById.get(String(link.id))
        if (title && !genres.includes(title)) genres.push(title)
        if (genres.length >= KITSU_GENRES_MAX) break
    }
    return genres
}

/** Pure mapping from a Kitsu JSON:API anime payload to the fields the activity feed needs. */
export function extractKitsuMeta(id: string, payload: unknown): KitsuMeta | null {
    if (!payload || typeof payload !== 'object') return null
    const root = payload as { data?: unknown; included?: unknown }
    if (!root.data || typeof root.data !== 'object') return null
    const doc = root.data as Record<string, unknown>
    const attributes = doc.attributes
    if (!attributes || typeof attributes !== 'object') return null
    const attrs = attributes as Record<string, unknown>
    const rawTitles = attrs.titles
    const titles = rawTitles && typeof rawTitles === 'object' ? (rawTitles as Record<string, unknown>) : {}

    // canonicalTitle is Kitsu's own display pick (e.g. "Cyberpunk: Edgerunners" where
    // titles.en is the all-caps "CYBERPUNK: EDGERUNNERS"), so it wins here.
    const name = firstString(
        attrs.canonicalTitle,
        titles.en,
        titles.en_us,
        titles.enJp,
        titles.en_jp,
        titles.jaJp,
        titles.ja_jp,
    )
    if (!name) return null

    const rawPoster = attrs.posterImage
    const posterImage = rawPoster && typeof rawPoster === 'object' ? (rawPoster as Record<string, unknown>) : {}
    const poster = firstString(posterImage.medium, posterImage.small, posterImage.large, posterImage.original, posterImage.tiny)

    const genres = extractKitsuGenres(doc, root.included)
    return {
        id,
        name,
        ...(poster ? { poster } : {}),
        ...(genres.length > 0 ? { genres } : {}),
    }
}

const remember = (id: string, meta: KitsuMeta | null) => {
    kitsuCache.set(id, { meta, fetchedAt: Date.now() })
    while (kitsuCache.size > KITSU_CACHE_MAX) {
        const oldest = kitsuCache.keys().next().value
        if (oldest === undefined) break
        kitsuCache.delete(oldest)
    }
}

async function fetchKitsuUncached(id: string): Promise<KitsuMeta | null> {
    try {
        const res = await fetch(`${KITSU_ANIME_URL}/${id}?include=categories`, {
            signal: AbortSignal.timeout(KITSU_TIMEOUT_MS),
            headers: { Accept: 'application/vnd.api+json' },
        })
        if (!res.ok) {
            remember(id, null)
            return null
        }
        const meta = extractKitsuMeta(id, await res.json())
        remember(id, meta)
        return meta
    } catch {
        // 404s, timeouts, CORS and transport failures all soft-fail to a null
        // result: activity rows keep their raw id and nothing retries hot.
        remember(id, null)
        return null
    }
}

/**
 * Resolve public Kitsu metadata for a kitsu id (prefixed or bare numeric form),
 * cached and deduped. Read-only public API: no credentials involved.
 */
export async function fetchKitsuMeta(kitsuIdOrRaw: string): Promise<KitsuMeta | null> {
    const id = normalizeKitsuId(kitsuIdOrRaw)
    if (!id) return null
    const cached = kitsuCache.get(id)
    if (cached && Date.now() - cached.fetchedAt < (cached.meta ? KITSU_TTL_MS : KITSU_NULL_TTL_MS)) {
        return cached.meta
    }
    let flight = kitsuInFlight.get(id)
    if (!flight) {
        flight = fetchKitsuUncached(id).finally(() => {
            kitsuInFlight.delete(id)
        })
        kitsuInFlight.set(id, flight)
    }
    return flight
}

/** Synchronous cache probe for surfaces that only need a previously resolved name. */
export function getCachedKitsuName(kitsuIdOrRaw: string): string | null {
    const id = normalizeKitsuId(kitsuIdOrRaw)
    if (!id) return null
    const cached = kitsuCache.get(id)
    if (!cached || !cached.meta) return null
    if (Date.now() - cached.fetchedAt > KITSU_TTL_MS) return null
    return cached.meta.name.trim() || null
}
