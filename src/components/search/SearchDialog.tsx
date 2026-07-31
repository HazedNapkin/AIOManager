import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Search, X, Film, Tv, Star } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Poster } from '@/components/common/Poster'
import { searchMedia, searchCinemeta, type SearchResult } from '@/api/metadata/adapters/tmdb'
import { traceAsync } from '@/api/metadata/adapters/shared-fetch'
import { cn } from '@/lib/utils'

interface SearchDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onResultClick: (result: SearchResult) => void
}

const DEBOUNCE_MS = 300

export function SearchDialog({ open, onOpenChange, onResultClick }: SearchDialogProps) {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<SearchResult[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [activeCategory, setActiveCategory] = useState<'all' | 'movie' | 'series'>('all')
    const inputRef = useRef<HTMLInputElement>(null)
    const abortRef = useRef<AbortController | null>(null)

    const categorized = useMemo(() => ({
        all: results,
        movie: results.filter(r => r.type === 'movie'),
        series: results.filter(r => r.type === 'series'),
    }), [results])

    const visibleResults = categorized[activeCategory]

    useEffect(() => {
        if (open) {
            setQuery('')
            setResults([])
            setError(null)
            setActiveCategory('all')
            setTimeout(() => inputRef.current?.focus(), 100)
        }
        return () => { abortRef.current?.abort() }
    }, [open])

    useEffect(() => {
        if (!query.trim()) {
            setResults([])
            setLoading(false)
            setError(null)
            return
        }
        const timer = setTimeout(async () => {
            abortRef.current?.abort()
            const ac = new AbortController()
            abortRef.current = ac
            setLoading(true)
            setError(null)
            try {
                const tmdbData = await traceAsync('search-tmdb', () => searchMedia(query, ac.signal))
                if (ac.signal.aborted) return
                if (tmdbData.length > 0) {
                    setResults(tmdbData)
                } else {
                    const cinemetaData = await traceAsync('search-cinemeta', () => searchCinemeta(query, ac.signal))
                    if (!ac.signal.aborted) {
                        setResults(cinemetaData)
                        if (cinemetaData.length === 0) setError('No results found. Try a different search.')
                    }
                }
            } catch (err) {
                if (!ac.signal.aborted) {
                    const cinemetaData = await traceAsync('search-cinemeta', () => searchCinemeta(query, ac.signal))
                    if (!ac.signal.aborted) {
                        if (cinemetaData.length > 0) {
                            setResults(cinemetaData)
                        } else {
                            setError('Search failed. TMDB key may not be configured.')
                        }
                    }
                }
            } finally {
                if (!ac.signal.aborted) setLoading(false)
            }
        }, DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [query])

    useEffect(() => { setActiveCategory('all') }, [query])

    const handleResultClick = useCallback((result: SearchResult) => {
        onResultClick(result)
        onOpenChange(false)
    }, [onResultClick, onOpenChange])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-full sm:max-w-3xl max-h-[85vh] flex flex-col overflow-hidden p-0 gap-0">
                <div className="relative flex items-center gap-3 border-b border-border/40 px-3 py-2 sm:px-4 sm:py-3">
                    <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search movies, TV shows..."
                        className="min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                    />
                    {query && (
                        <button
                            type="button"
                            onClick={() => setQuery('')}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-3 sm:p-4">
                    {loading && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3">
                            {Array.from({ length: 10 }).map((_, i) => (
                                <div key={i} className="space-y-1.5">
                                    <Skeleton className="aspect-[2/3] w-full rounded-xl" />
                                    <Skeleton className="h-3 w-full" />
                                </div>
                            ))}
                        </div>
                    )}

                    {error && !loading && (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <p className="text-sm font-medium text-muted-foreground">{error}</p>
                        </div>
                    )}

                    {!loading && !error && results.length > 0 && (
                        <>
                            {results.length > 3 && (
                                <div className="mb-2 sm:mb-3 flex items-center gap-2">
                                    {([
                                        { id: 'all', label: 'All', count: categorized.all.length },
                                        { id: 'movie', label: 'Movies', count: categorized.movie.length },
                                        { id: 'series', label: 'TV Shows', count: categorized.series.length },
                                    ] as const).filter(cat => cat.count > 0).map(cat => (
                                        <button
                                            key={cat.id}
                                            type="button"
                                            onClick={() => setActiveCategory(cat.id)}
                                            className={cn(
                                                'flex items-center gap-1.5 rounded-full px-2 py-1 sm:px-3 sm:py-1.5 text-xs font-bold transition-all',
                                                activeCategory === cat.id
                                                    ? 'bg-primary text-primary-foreground'
                                                    : 'bg-muted/40 text-muted-foreground hover:bg-muted/60'
                                            )}
                                        >
                                            {cat.label}
                                            <span className={cn(
                                                'rounded-full px-1.5 text-[10px]',
                                                activeCategory === cat.id ? 'bg-black/20' : 'bg-muted/60'
                                            )}>
                                                {cat.count}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}

                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3">
                                {visibleResults.map((result, i) => (
                                    <motion.button
                                        key={`${result.id}-${i}`}
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.2 }}
                                        onClick={() => handleResultClick(result)}
                                        className="group flex flex-col gap-1.5 text-left"
                                    >
                                        <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-border/40 bg-muted shadow-sm transition-[transform,opacity,box-shadow] duration-200 group-hover:border-primary/50 group-hover:shadow-lg">
                                            <Poster
                                                src={result.poster}
                                                itemId={result.id}
                                                itemType={result.type}
                                                alt={result.name}
                                                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                loading="lazy"
                                            />
                                            <div className="absolute right-1.5 top-1.5">
                                                {result.type === 'series' ? (
                                                    <Tv className="h-3.5 w-3.5 text-white/80 drop-shadow-lg" />
                                                ) : (
                                                    <Film className="h-3.5 w-3.5 text-white/80 drop-shadow-lg" />
                                                )}
                                            </div>
                                            {typeof result.voteAverage === 'number' && result.voteAverage > 0 && (
                                                <div className="absolute bottom-1.5 right-1.5">
                                                    <span className="flex items-center gap-0.5 rounded-full bg-black/75 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white/90 backdrop-blur-sm">
                                                        <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                                                        {result.voteAverage.toFixed(1)}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                        <p className="line-clamp-1 text-xs font-semibold leading-tight">{result.name}</p>
                                        {result.year && (
                                            <p className="text-[10px] text-muted-foreground">{result.year}</p>
                                        )}
                                    </motion.button>
                                ))}
                            </div>
                        </>
                    )}

                    {!loading && !error && results.length === 0 && !query.trim() && (
                        <div className="flex flex-col items-center justify-center py-12 sm:py-16 text-center">
                            <div className="mb-3 sm:mb-4 flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-muted/40">
                                <Search className="h-6 w-6 text-muted-foreground/40" />
                            </div>
                            <p className="text-sm font-semibold text-muted-foreground">Start typing to search</p>
                            <p className="mt-1 text-xs text-muted-foreground/60">Find movies or TV shows to add to your watchlist</p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
