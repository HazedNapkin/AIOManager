import { useState, useEffect, useRef } from 'react'
import { Tv, Play, Calendar, Clock, Star, ChevronRight } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { fetchSeasonEpisodes, fetchSeasonsList, proxyFetch, type SeasonInfo, type EpisodeInfo } from '@/api/metadata/adapters/tmdb'
import type { DetailItem } from '@/components/activity/detail/types'

interface SeasonBrowserProps {
    seriesTmdbId: number | null
    activeItem: DetailItem | null
    isLight: boolean
    loading: boolean
    onEpisodeClick?: (data: {
        episodeNumber: number
        episodeName: string
        episodeOverview?: string
        airDate?: string
        still?: string
        seasonNumber: number
        seriesTmdbId: number | null
    }) => void
}

export function SeasonBrowser({ seriesTmdbId, activeItem, isLight, loading, onEpisodeClick }: SeasonBrowserProps) {
    const [seasons, setSeasons] = useState<SeasonInfo[]>([])
    const [selectedSeason, setSelectedSeason] = useState<number | null>(null)
    const [episodes, setEpisodes] = useState<EpisodeInfo[]>([])
    const [episodesLoading, setEpisodesLoading] = useState(false)
    const [cinemetaSeasons, setCinemetaSeasons] = useState<SeasonInfo[]>([])
    const [cinemetaEpisodesBySeason, setCinemetaEpisodesBySeason] = useState<Map<number, EpisodeInfo[]>>(new Map())
    const [cinemetaTmdbId, setCinemetaTmdbId] = useState<number | null>(null)
    const [tmdbSeasonsFailed, setTmdbSeasonsFailed] = useState(false)
    const absoluteSeasonRedirectRef = useRef<string | null>(null)

    const effectiveTmdbId = seriesTmdbId ?? cinemetaTmdbId

    useEffect(() => {
        setSeasons([])
        setSelectedSeason(null)
        setEpisodes([])
        setCinemetaTmdbId(null)
        absoluteSeasonRedirectRef.current = null
    }, [activeItem])

    useEffect(() => {
        if (!seriesTmdbId) return
        let active = true
        setTmdbSeasonsFailed(false)
        fetchSeasonsList(seriesTmdbId)
            .then(list => {
                if (!active) return
                const filtered = list.filter(s => s.seasonNumber > 0)
                if (filtered.length === 0) { setTmdbSeasonsFailed(true); return }
                setSeasons(filtered)
                const watched = activeItem?.season
                const target = watched != null && filtered.some(s => s.seasonNumber === watched)
                    ? watched
                    : filtered[0].seasonNumber
                setSelectedSeason(target)
            })
            .catch(() => { if (active) setTmdbSeasonsFailed(true) })
        return () => { active = false }
    }, [seriesTmdbId, activeItem?.season])

    useEffect(() => {
        if (!seriesTmdbId || selectedSeason === null) return
        let active = true
        const controller = new AbortController()
        setEpisodesLoading(true)
        fetchSeasonEpisodes(seriesTmdbId, selectedSeason, controller.signal)
            .then(eps => {
                if (!active || controller.signal.aborted) return
                setEpisodes(eps)
            })
            .catch(() => { })
            .finally(() => { if (active && !controller.signal.aborted) setEpisodesLoading(false) })
        return () => { active = false; controller.abort() }
    }, [seriesTmdbId, selectedSeason])

    useEffect(() => {
        setCinemetaSeasons([])
        setCinemetaEpisodesBySeason(new Map())
        if (!activeItem) return
        if (seriesTmdbId && !tmdbSeasonsFailed) return
        const isSeries = activeItem.type === 'series' || activeItem.type === 'anime' || activeItem.type === 'episode'
        if (!isSeries) return
        let active = true
        const cinemetaController = new AbortController()
        const cinemetaTimeout = setTimeout(() => cinemetaController.abort(), 8000)
        const fetchCinemeta = (imdb: string) => {
            fetch(`https://cinemeta-live.strem.io/meta/series/${encodeURIComponent(imdb)}.json`, { signal: cinemetaController.signal })
                .then(res => res.ok ? res.json() : null)
                .then(data => {
                    if (!active || !data?.meta?.videos) return
                    if (typeof data.meta.moviedb_id === 'number' && data.meta.moviedb_id > 0) {
                        setCinemetaTmdbId(data.meta.moviedb_id)
                    }
                    const vids: Array<Record<string, unknown>> = data.meta.videos
                    const bySeason = new Map<number, EpisodeInfo[]>()
                    const seasonSet = new Set<number>()
                    for (const v of vids) {
                        const season = typeof v.season === 'number' ? v.season : 1
                        const episode = typeof v.episode === 'number' ? v.episode : typeof v.number === 'number' ? v.number : 0
                        if (season < 1 || episode < 1) continue
                        seasonSet.add(season)
                        const ep: EpisodeInfo = {
                            episodeNumber: episode,
                            name: String(v.name || v.title || `Episode ${episode}`),
                            overview: typeof v.overview === 'string' ? v.overview : typeof v.description === 'string' ? v.description : undefined,
                            airDate: typeof v.released === 'string' ? v.released : typeof v.firstAired === 'string' ? v.firstAired : undefined,
                            still: typeof v.thumbnail === 'string' ? v.thumbnail : undefined,
                        }
                        const arr = bySeason.get(season) ?? []
                        arr.push(ep)
                        bySeason.set(season, arr)
                    }
                    for (const arr of bySeason.values()) arr.sort((a, b) => a.episodeNumber - b.episodeNumber)
                    const seasonList: SeasonInfo[] = Array.from(seasonSet)
                        .sort((a, b) => b - a)
                        .map(sn => ({
                            seasonNumber: sn,
                            name: sn === 0 ? 'Specials' : `Season ${sn}`,
                            episodeCount: bySeason.get(sn)?.length ?? 0,
                        }))
                    if (active && seasonList.length > 0) {
                        setCinemetaSeasons(seasonList)
                        setCinemetaEpisodesBySeason(bySeason)
                    }
                })
                .catch(() => { })
        }
        const itemId = activeItem.itemId
        if (itemId.startsWith('tt')) {
            fetchCinemeta(itemId)
        } else if (seriesTmdbId && tmdbSeasonsFailed) {
            proxyFetch<{ imdb_id?: string }>(`tv/${seriesTmdbId}/external_ids`)
                .then(ext => {
                    if (!active) return
                    if (ext?.imdb_id) {
                        fetchCinemeta(ext.imdb_id)
                    } else if (activeItem.name) {
                        const nameQuery = encodeURIComponent(activeItem.name)
                        Promise.all([
                            fetch(`https://cinemeta-live.strem.io/catalog/series/top/search=${nameQuery}.json`)
                                .then(r => r.ok ? r.json() : null)
                                .catch(() => null),
                            fetch(`https://cinemeta-live.strem.io/catalog/movie/top/search=${nameQuery}.json`)
                                .then(r => r.ok ? r.json() : null)
                                .catch(() => null),
                        ])
                            .then(([seriesData, movieData]) => {
                                if (!active) return
                                const metas: Array<Record<string, unknown>> = [
                                    ...((Array.isArray(seriesData?.metas) ? seriesData.metas : []) as Array<Record<string, unknown>>),
                                    ...((Array.isArray(movieData?.metas) ? movieData.metas : []) as Array<Record<string, unknown>>),
                                ]
                                if (metas.length === 0) return
                                const match = metas.find((m: Record<string, unknown>) =>
                                    m.type === 'series' &&
                                    String(m.name || '').toLowerCase() === activeItem.name!.toLowerCase()
                                ) || metas[0]
                                if (match?.id && String(match.id).startsWith('tt')) {
                                    fetchCinemeta(String(match.id))
                                }
                            })
                            .catch(() => {})
                    }
                })
                .catch(() => {})
        }
        return () => { active = false; clearTimeout(cinemetaTimeout); cinemetaController.abort() }
    }, [seriesTmdbId, activeItem, tmdbSeasonsFailed])

    useEffect(() => {
        if ((seriesTmdbId && !tmdbSeasonsFailed) || cinemetaSeasons.length === 0 || selectedSeason !== null) return
        const watched = activeItem?.season
        const target = watched != null && cinemetaSeasons.some(s => s.seasonNumber === watched)
            ? watched
            : cinemetaSeasons[0].seasonNumber
        setSelectedSeason(target)
    }, [cinemetaSeasons, seriesTmdbId, selectedSeason, activeItem, tmdbSeasonsFailed])

    if (loading || (seasons.length === 0 && cinemetaSeasons.length === 0)) return null

    const activeSeasons = seasons.length > 0 ? seasons : cinemetaSeasons
    const activeEpisodes = seriesTmdbId ? episodes : (cinemetaEpisodesBySeason.get(selectedSeason ?? -1) ?? [])
    const isLoadingEps = seriesTmdbId ? episodesLoading : false

    // Anime watch events usually carry absolute episode numbers on a flat season 1,
    // while TMDB splits the show into real seasons. When the watched episode isn't in
    // the selected season, map it through cumulative episode counts (absolute →
    // season/offset) so the watched episode still gets selected and highlighted.
    const watchedSeason = activeItem?.season
    const watchedEpisode = activeItem?.episode
    const directHit = watchedSeason != null && watchedEpisode != null
        && watchedSeason === selectedSeason
        && activeEpisodes.some(ep => ep.episodeNumber === watchedEpisode)
    const mappedFromAbsolute = (!directHit && watchedEpisode != null && activeItem?.type === 'anime')
        ? (() => {
            const ordered = [...activeSeasons].sort((a, b) => a.seasonNumber - b.seasonNumber)
            let before = 0
            for (const s of ordered) {
                const count = s.episodeCount || 0
                if (watchedEpisode! <= before + count) {
                    return { season: s.seasonNumber, episode: watchedEpisode! - before }
                }
                before += count
            }
            return null
        })()
        : null
    const redirectKey = activeItem ? `${activeItem.itemId}:${watchedSeason ?? ''}:${watchedEpisode ?? ''}` : null
    if (
        mappedFromAbsolute &&
        redirectKey !== null &&
        absoluteSeasonRedirectRef.current !== redirectKey &&
        selectedSeason != null &&
        selectedSeason === watchedSeason &&
        mappedFromAbsolute.season !== selectedSeason &&
        !isLoadingEps
    ) {
        absoluteSeasonRedirectRef.current = redirectKey
        setSelectedSeason(mappedFromAbsolute.season)
    }
    const highlight = directHit
        ? { season: watchedSeason!, episode: watchedEpisode! }
        : mappedFromAbsolute ?? null

    const handleEpisodeClick = (ep: EpisodeInfo) => {
        if (!onEpisodeClick || selectedSeason === null) return
        onEpisodeClick({
            episodeNumber: ep.episodeNumber,
            episodeName: ep.name,
            episodeOverview: ep.overview,
            airDate: ep.airDate,
            still: ep.still,
            seasonNumber: selectedSeason,
            seriesTmdbId: effectiveTmdbId,
        })
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
                    <Tv className="h-3.5 w-3.5 text-primary" />
                    Episodes
                </h3>
                {selectedSeason !== null && (() => {
                    const s = activeSeasons.find(x => x.seasonNumber === selectedSeason)
                    return s ? (
                        <span className="text-[11px] font-medium text-muted-foreground/60">
                            {s.episodeCount} episode{s.episodeCount === 1 ? '' : 's'}
                            {s.airDate ? ` \u00b7 ${new Date(s.airDate).getFullYear()}` : ''}
                        </span>
                    ) : null
                })()}
            </div>

            <div className="scrollbar-hide -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                {activeSeasons.map(s => {
                    const isActive = s.seasonNumber === selectedSeason
                    return (
                        <button
                            key={s.seasonNumber}
                            type="button"
                            onClick={() => setSelectedSeason(s.seasonNumber)}
                            className={cn(
                                'shrink-0 rounded-full px-4 py-2 text-xs font-bold transition-all active:scale-95',
                                isActive
                                    ? (isLight ? 'bg-primary text-primary-foreground shadow' : 'bg-white text-black shadow')
                                    : (isLight ? 'bg-muted/50 text-muted-foreground hover:bg-muted' : 'bg-white/10 text-white/80 hover:bg-white/20')
                            )}
                        >
                            {s.seasonNumber === 0 ? 'Specials' : `S${s.seasonNumber}`}
                        </button>
                    )
                })}
            </div>

            <div className="space-y-1.5">
                {isLoadingEps ? (
                    [0, 1, 2, 3].map(i => (
                        <div key={i} className="flex gap-3 rounded-xl border border-border/40 bg-muted/30 p-2.5">
                            <Skeleton className="h-14 w-24 shrink-0 rounded-lg" />
                            <div className="flex-1 space-y-1.5 py-1">
                                <Skeleton className="h-3.5 w-3/4 rounded" />
                                <Skeleton className="h-3 w-1/2 rounded" />
                            </div>
                        </div>
                    ))
                ) : activeEpisodes.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground/60">
                        No episode data available for this season.
                    </p>
                ) : (
                    activeEpisodes.map(ep => {
                        const isWatched = highlight !== null && highlight.season === selectedSeason && highlight.episode === ep.episodeNumber
                        return (
                            <Tooltip content="View episode details" side="top">
                            <button
                                key={ep.episodeNumber}
                                type="button"
                                onClick={() => handleEpisodeClick(ep)}
                                className={cn(
                                    'group flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-all',
                                    isWatched
                                        ? 'border-primary/60 bg-primary/10 shadow-sm'
                                        : 'border-border/40 bg-muted/20 hover:border-border hover:bg-muted/40'
                                )}
                            >
                                <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-muted sm:h-16 sm:w-28">
                                    {ep.still ? (
                                        <img src={ep.still} alt="" loading="lazy" className="h-full w-full object-cover" />
                                    ) : null}
                                    <span className={cn(
                                        'absolute left-1 top-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none',
                                        isWatched
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-black/70 text-white'
                                    )}>
                                        E{ep.episodeNumber}
                                    </span>
                                    {isWatched && (
                                        <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                            <Play className="h-2.5 w-2.5 fill-current" />
                                        </span>
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className={cn(
                                        'line-clamp-1 text-xs font-bold leading-tight sm:text-sm',
                                        isWatched ? 'text-primary' : 'text-foreground/90'
                                    )}>
                                        {ep.name}
                                    </p>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground/70">
                                        {ep.airDate && (
                                            <span className="inline-flex items-center gap-0.5">
                                                <Calendar className="h-3 w-3" />
                                                {new Date(ep.airDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </span>
                                        )}
                                        {ep.runtime ? (
                                            <span className="inline-flex items-center gap-0.5">
                                                <Clock className="h-3 w-3" />
                                                {ep.runtime}m
                                            </span>
                                        ) : null}
                                        {typeof ep.voteAverage === 'number' && ep.voteAverage > 0 && (
                                            <span className="inline-flex items-center gap-0.5">
                                                <Star className="h-3 w-3" />
                                                {ep.voteAverage.toFixed(1)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                            </button>
                            </Tooltip>
                        )
                    })
                )}
            </div>
        </div>
    )
}
