import { memo, useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'

export interface ReviewData {
    author: string
    content: string
    rating?: number
    avatar?: string
}

export const ReviewCard = memo(function ReviewCard({ rv }: { rv: ReviewData }) {
    const [expanded, setExpanded] = useState(false)
    const isLong = rv.content.length > 220
    const displayText = !expanded && isLong ? rv.content.slice(0, 220) + '\u2026' : rv.content

    return (
        <div className="flex flex-col justify-between rounded-2xl border border-border/40 bg-card/60 p-4 shadow-sm backdrop-blur-md space-y-2.5">
            <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-primary/40 bg-muted font-bold text-xs text-primary shadow">
                    {rv.avatar ? (
                        <img src={rv.avatar} alt={rv.author} className="h-full w-full object-cover" />
                    ) : (
                        rv.author.charAt(0).toUpperCase()
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="truncate text-xs font-bold text-foreground">{rv.author}</p>
                        <span className="rounded border border-[#01b4e4]/30 bg-[#0d253f]/60 px-1.5 py-0.2 text-[9px] font-black leading-none text-[#01b4e4]/80 uppercase tracking-wide">
                            Via TMDB
                        </span>
                    </div>
                    {rv.rating && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-black text-amber-400">
                            ★ {rv.rating}/10
                        </span>
                    )}
                </div>
            </div>
            <div>
                <p className="text-xs leading-relaxed text-muted-foreground/90 font-medium italic">
                    "{displayText}"
                </p>
                {isLong && (
                    <button
                        type="button"
                        onClick={() => setExpanded(e => !e)}
                        className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-primary/80 hover:text-primary transition-colors"
                    >
                        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {expanded ? 'Show less' : 'Read more'}
                    </button>
                )}
            </div>
        </div>
    )
})
