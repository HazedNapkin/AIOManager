import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Poster } from '@/components/common/Poster'
import { fetchCinemetaDetail, type CinemetaMeta } from '@/lib/cinemeta-cache'
import { parseWatchIdentity } from '@/lib/watch-state/jellyfin-records'
import type { WatchStateRecord } from '@/lib/watch-state/types'

interface TitleDetails {
    title?: string
    description?: string
    image?: string
    episode: boolean
    runtime?: number
}

// Recognition only: these optional details never participate in title matching or writes.
export function MigrationTitleDetails({ record }: { record: WatchStateRecord }) {
    const [open, setOpen] = useState(false)
    const [details, setDetails] = useState<TitleDetails | null | undefined>()
    const [loading, setLoading] = useState(false)
    const identity = record.identities.find(value => {
        const parsed = parseWatchIdentity(value)
        return parsed?.type === record.type && (parsed.provider === 'imdb' || parsed.provider === 'tmdb')
    })

    useEffect(() => {
        if (!open || details !== undefined || !identity) return
        let cancelled = false
        const controller = new AbortController()
        setLoading(true)
        const load = async (): Promise<TitleDetails | null> => {
            const parsed = parseWatchIdentity(identity)!
            let meta: Partial<CinemetaMeta> | null = null
            let tmdbId: number | undefined
            if (parsed.provider === 'imdb') {
                meta = await fetchCinemetaDetail(parsed.value, record.type === 'movie' ? 'movie' : 'series')
                tmdbId = meta?.tmdbId
            } else {
                tmdbId = Number(parsed.value)
                if (!Number.isSafeInteger(tmdbId) || tmdbId < 1) return null
                const { fetchTmdbDetailsAsMeta } = await import('@/api/metadata/adapters/tmdb')
                const result = await fetchTmdbDetailsAsMeta(tmdbId, record.type === 'movie' ? 'movie' : 'tv', controller.signal)
                meta = result.meta
            }
            if (controller.signal.aborted) return null
            if (record.type === 'episode' && tmdbId && record.season !== undefined && record.episode !== undefined) {
                const { fetchEpisodeDetail } = await import('@/api/metadata/adapters/tmdb')
                const episode = await fetchEpisodeDetail(tmdbId, record.season, record.episode, controller.signal)
                if (episode && episode.seasonNumber === record.season && episode.episodeNumber === record.episode) return { title: episode.name, description: episode.overview, image: episode.still || meta?.poster, episode: true, runtime: episode.runtime }
            }
            return meta ? { title: meta.name, description: meta.description, image: meta.poster, episode: false } : null
        }
        void load().then(value => {
            if (!cancelled) { setDetails(value); setLoading(false) }
        }).catch(() => {
            if (!cancelled) { setDetails(null); setLoading(false) }
        })
        return () => { cancelled = true; controller.abort() }
    }, [open, details, identity, record.type, record.season, record.episode])

    if (!identity) return null
    return <details className="text-xs text-muted-foreground" onToggle={event => setOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer">About this title</summary>
        {loading && <p className="mt-2 flex items-center gap-1.5"><Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />Loading title details…</p>}
        {!loading && details && <div className="mt-3 flex items-start gap-3 rounded-xl bg-muted/20 p-3">
            {details.image && <div className="h-20 w-14 shrink-0 overflow-hidden rounded-lg"><Poster src={details.image} fallback={false} alt="" /></div>}
            <div className="min-w-0 space-y-1.5">
                {record.type === 'episode' && <p className="text-[11px]">{details.episode ? `Season ${record.season} · Episode ${record.episode}` : 'About the series'}{details.runtime ? ` · ${details.runtime} min` : ''}</p>}
                <p className="font-semibold text-foreground">{details.title || record.title}</p>
                {details.description && <p className="leading-relaxed">{details.description}</p>}
            </div>
        </div>}
        {!loading && details === null && <p className="mt-2">Extra title details aren’t available right now. You can still review and import its watch information.</p>}
    </details>
}
