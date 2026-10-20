import { useEffect, useMemo, useState } from 'react'
import { Film, Tv } from 'lucide-react'
import { Poster } from '@/components/common/Poster'
import { fetchCinemetaDetail } from '@/lib/cinemeta-cache'
import { parseWatchIdentity, type ParsedWatchIdentity } from '@/lib/watch-state/jellyfin-records'
import type { WatchStateRecord } from '@/lib/watch-state/types'

interface Props {
    record: Pick<WatchStateRecord, 'identities' | 'type'>
}

interface ArtworkInfo {
    poster?: string
    fallbackPoster?: string
    imdbId?: string
}

// Recognition only: exact IMDb/TMDB identities are used for artwork display and never
// participate in title matching, watch-state fingerprints or writes.
function selectIdentity(record: Props['record']): ParsedWatchIdentity | null {
    if (record.type !== 'movie' && record.type !== 'episode') return null
    let tmdb: ParsedWatchIdentity | null = null
    for (const value of record.identities) {
        const parsed = parseWatchIdentity(value)
        if (!parsed || parsed.type !== record.type) continue
        if (parsed.provider === 'imdb') return parsed
        if (parsed.provider === 'tmdb' && !tmdb) tmdb = parsed
    }
    return tmdb
}

// Bounded per-session cache (page size is 50 rows) so paging back and forth or repeated
// episodes of one series share a single public metadata lookup.
const artworkCache = new Map<string, ArtworkInfo>()
const artworkInFlight = new Map<string, Promise<ArtworkInfo | null>>()
const ARTWORK_CACHE_LIMIT = 600

// Public metadata only: Cinemeta and the app's TMDB proxy, same paths MigrationTitleDetails
// already uses. No source or destination credentials are involved.
async function lookupArtwork(identity: ParsedWatchIdentity): Promise<ArtworkInfo | null> {
    const { proxyFetch, TMDB_IMAGE_BASE } = await import('@/api/metadata/adapters/tmdb')
    if (identity.provider === 'tmdb') {
        const data = await proxyFetch<{ poster_path?: string | null; external_ids?: { imdb_id?: string | null } }>(
            `${identity.type === 'movie' ? 'movie' : 'tv'}/${identity.value}?append_to_response=external_ids`
        )
        const poster = typeof data?.poster_path === 'string' && data.poster_path.startsWith('/') ? `${TMDB_IMAGE_BASE}/w500${data.poster_path}` : undefined
        const rawImdb = data?.external_ids?.imdb_id
        const imdbId = typeof rawImdb === 'string' && /^tt\d{5,}$/.test(rawImdb) ? rawImdb : undefined
        return poster || imdbId ? { poster, imdbId } : null
    }
    // IMDb identities only reach this after the shared metahub poster already failed, so
    // metadata-provided artwork (Cinemeta poster, then TMDB via Cinemeta's tmdbId) is allowed.
    const meta = await fetchCinemetaDetail(identity.value, identity.type === 'movie' ? 'movie' : 'series')
    if (typeof meta?.tmdbId === 'number' && Number.isSafeInteger(meta.tmdbId) && meta.tmdbId > 0) {
        const data = await proxyFetch<{ poster_path?: string | null }>(`${identity.type === 'movie' ? 'movie' : 'tv'}/${meta.tmdbId}`)
        if (typeof data?.poster_path === 'string' && data.poster_path.startsWith('/')) return { poster: `${TMDB_IMAGE_BASE}/w500${data.poster_path}`, fallbackPoster: meta.poster, imdbId: identity.value }
    }
    return meta?.poster ? { poster: meta.poster, imdbId: identity.value } : null
}

function cachedLookup(identity: ParsedWatchIdentity): Promise<ArtworkInfo | null> {
    const key = `${identity.provider}:${identity.value}:${identity.type}`
    const cached = artworkCache.get(key)
    if (cached) return Promise.resolve(cached)
    let flight = artworkInFlight.get(key)
    if (!flight) {
        flight = lookupArtwork(identity).catch(() => null).then(info => {
            if (info) {
                if (artworkCache.size >= ARTWORK_CACHE_LIMIT) {
                    const oldest = artworkCache.keys().next().value
                    if (oldest !== undefined) artworkCache.delete(oldest)
                }
                artworkCache.set(key, info)
            }
            return info
        }).finally(() => { artworkInFlight.delete(key) })
        artworkInFlight.set(key, flight)
    }
    return flight
}

export function MigrationArtwork({ record }: Props) {
    const identity = useMemo(() => selectIdentity(record), [record])
    const [info, setInfo] = useState<ArtworkInfo | null | undefined>(undefined)
    const [attempt, setAttempt] = useState(0)

    useEffect(() => {
        setInfo(undefined)
        setAttempt(0)
    }, [identity])

    // Lazy and bounded: only rows that are actually mounted (the visible page) look anything
    // up, and IMDb rows stay on the zero-request metahub path until their image fails.
    const needsLookup = !!identity && (identity.provider === 'tmdb' || attempt > 0)
    useEffect(() => {
        if (!identity || !needsLookup || info !== undefined) return
        let cancelled = false
        void cachedLookup(identity).then(value => { if (!cancelled) setInfo(value) })
        return () => { cancelled = true }
    }, [identity, needsLookup, info])

    const candidates: Array<{ poster?: string; imdbId?: string }> = []
    const seenPosters = new Set<string>()
    const seenImdb = new Set<string>()
    const pushCandidate = (source: ArtworkInfo) => {
        for (const poster of [source.poster, source.fallbackPoster]) {
            if (poster && !seenPosters.has(poster)) {
                candidates.push({ poster })
                seenPosters.add(poster)
            }
        }
        if (source.imdbId && !seenImdb.has(source.imdbId)) candidates.push({ imdbId: source.imdbId })
        if (source.imdbId) seenImdb.add(source.imdbId)
    }
    if (identity?.provider === 'imdb') pushCandidate({ imdbId: identity.value })
    if (info) pushCandidate(info)
    const current = candidates[attempt]

    if (!identity || !current) {
        const MediaIcon = record.type === 'episode' ? Tv : Film
        return <div data-theme-part="image-tile" className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-muted/50 text-muted-foreground"><div className="flex h-full items-center justify-center"><MediaIcon aria-hidden="true" className="h-4 w-4" /></div></div>
    }
    // Poster accepts onError through its props, which replaces its internal handler: this
    // component owns the fallback chain and advances to the next candidate on failure.
    return <div data-theme-part="image-tile" className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-muted/50 text-muted-foreground">
        <Poster src={current.poster} itemId={current.imdbId} itemType={record.type === 'episode' ? 'series' : 'movie'} alt="" onError={() => setAttempt(value => value + 1)} />
    </div>
}
