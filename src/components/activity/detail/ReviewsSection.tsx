import { useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ReviewCard } from '@/components/activity/detail/ReviewCard'
import type { CinemetaReview } from '@/lib/activity-utils'

interface ReviewsSectionProps {
    reviews: CinemetaReview[]
}

export function ReviewsSection({ reviews }: ReviewsSectionProps) {
    const [showAllReviews, setShowAllReviews] = useState(false)
    const [selectedReviewSource, setSelectedReviewSource] = useState<'all' | 'TMDB' | 'Trakt'>('all')

    if (!reviews || reviews.length === 0) return null

    const filtered = reviews.filter(r => {
        if (selectedReviewSource === 'all') return true
        const src = r.source || (r.id?.startsWith('trakt') ? 'Trakt' : 'TMDB')
        return src.toLowerCase() === selectedReviewSource.toLowerCase()
    })
    const displayList = showAllReviews ? filtered : filtered.slice(0, 4)
    const traktCount = reviews.filter(r => r.source === 'Trakt' || r.id?.startsWith('trakt')).length
    const tmdbCount = reviews.filter(r => r.source === 'TMDB' || !r.id?.startsWith('trakt')).length

    return (
        <div className="mt-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
                    <MessageSquare className="h-3.5 w-3.5 text-primary" />
                    Audience Reviews & Discussions ({reviews.length})
                </h3>

                <div className="flex items-center gap-1 rounded-full border border-border/40 bg-muted/40 p-0.5 text-[11px] font-bold">
                    <button
                        type="button"
                        onClick={() => setSelectedReviewSource('all')}
                        className={cn(
                            'rounded-full px-2.5 py-0.5 transition-all',
                            selectedReviewSource === 'all' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground'
                        )}
                    >
                        All ({reviews.length})
                    </button>
                    {traktCount > 0 && (
                        <button
                            type="button"
                            onClick={() => setSelectedReviewSource('Trakt')}
                            className={cn(
                                'rounded-full px-2.5 py-0.5 transition-all',
                                selectedReviewSource === 'Trakt' ? 'bg-red-600 text-white shadow' : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            Trakt ({traktCount})
                        </button>
                    )}
                    {tmdbCount > 0 && (
                        <button
                            type="button"
                            onClick={() => setSelectedReviewSource('TMDB')}
                            className={cn(
                                'rounded-full px-2.5 py-0.5 transition-all',
                                selectedReviewSource === 'TMDB' ? 'bg-[#01b4e4] text-black shadow' : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            TMDB ({tmdbCount})
                        </button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                {displayList.map((rv, idx) => (
                    <ReviewCard key={`rv-${rv.id || idx}`} rv={rv} />
                ))}
            </div>

            {filtered.length > 4 && (
                <div className="flex justify-center pt-2">
                    <button
                        type="button"
                        onClick={() => setShowAllReviews(prev => !prev)}
                        className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-6 py-2 text-xs font-bold text-primary shadow transition-all hover:bg-primary/20 hover:scale-105 active:scale-95"
                    >
                        {showAllReviews ? 'Show Fewer Reviews' : `Show All Reviews (${filtered.length})`}
                    </button>
                </div>
            )}
        </div>
    )
}
