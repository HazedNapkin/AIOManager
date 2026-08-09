import { memo } from 'react'
import { Star } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'

export type RatingSource =
    | 'imdb'
    | 'tomatoes'
    | 'popcorn'
    | 'metacritic'
    | 'trakt'
    | 'letterboxd'
    | 'pmdb'
    | 'tmdb'
    | 'simkl'

export interface ProviderRating {
    source: RatingSource
    value: string
    votes?: string
}

export const RatingBadge = memo(function RatingBadge({ rating }: { rating: ProviderRating }) {
    const { source, value } = rating

    if (source === 'tomatoes') {
        const numVal = parseInt(value, 10)
        const isFresh = isNaN(numVal) || numVal >= 60
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/35 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                {isFresh ? (
                    <svg viewBox="0 0 32 32" className="h-4 w-4 shrink-0 drop-shadow">
                        <path d="M16 2C14.5 5 11.5 6 8.5 5.5C11 8.5 14 8.5 16 6.5C18 8.5 21 8.5 23.5 5.5C20.5 6 17.5 5 16 2Z" fill="#22C55E" />
                        <circle cx="16" cy="18" r="11" fill="#FA320A" />
                        <ellipse cx="13" cy="14" rx="2" ry="3" fill="#FF6B4A" opacity="0.6" />
                    </svg>
                ) : (
                    <svg viewBox="0 0 32 32" className="h-4 w-4 shrink-0 drop-shadow">
                        <path d="M16 6C12 7.5 8 5.5 5.5 11.5C3.5 17.5 7.5 24.5 14 26.5C20.5 28.5 26.5 24.5 26.5 18.5C26.5 12.5 22.5 10.5 16 6Z" fill="#68A040" />
                        <circle cx="10" cy="15" r="1.5" fill="#4B772D" />
                        <circle cx="20" cy="19" r="2" fill="#4B772D" />
                    </svg>
                )}
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        )
    }

    if (source === 'popcorn') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                <svg viewBox="0 0 32 32" className="h-4 w-4 shrink-0 drop-shadow">
                    <circle cx="12" cy="9" r="3.5" fill="#FFE58F" />
                    <circle cx="16" cy="7" r="4" fill="#FFF0B6" />
                    <circle cx="20" cy="9" r="3.5" fill="#FFE58F" />
                    <path d="M9 12L11 26H21L23 12H9Z" fill="#FA320A" />
                    <path d="M13 12L14 26H16L15 12H13Z" fill="#FFFFFF" />
                    <path d="M17 12L18 26H20L19 12H17Z" fill="#FFFFFF" />
                </svg>
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        )
    }

    if (source === 'metacritic') {
        const score = parseInt(value, 10)
        const bg = isNaN(score) || score >= 60 ? 'bg-emerald-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500'
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                <span className={`flex h-4 w-4 items-center justify-center rounded-sm text-[10px] font-black text-black ${bg}`}>m</span>
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        )
    }

    if (source === 'imdb') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                <svg viewBox="0 0 64 32" className="h-4 w-9 shrink-0 rounded-sm">
                    <rect width="64" height="32" rx="4" fill="#F5C518" />
                    <text x="32" y="22" fill="#000000" fontSize="20" fontWeight="900" textAnchor="middle" fontFamily="Arial Black, Impact, sans-serif">IMDb</text>
                </svg>
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        )
    }

    if (source === 'trakt') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-600/40 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                <svg viewBox="0 0 32 32" className="h-4 w-4 shrink-0 rounded-sm">
                    <rect width="32" height="32" rx="6" fill="#ED1C24" />
                    <path d="M8 9H24V13H18V24H14V13H8V9Z" fill="#FFFFFF" />
                </svg>
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        )
    }

    if (source === 'letterboxd') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                <svg viewBox="0 0 36 16" className="h-3.5 w-8 shrink-0">
                    <circle cx="8" cy="8" r="6" fill="#00E054" />
                    <circle cx="18" cy="8" r="6" fill="#40BCF4" />
                    <circle cx="28" cy="8" r="6" fill="#FF8000" />
                </svg>
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        )
    }

    if (source === 'tmdb') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                <svg viewBox="0 0 40 20" className="h-3.5 w-7 shrink-0 rounded-sm">
                    <rect width="40" height="20" rx="3" fill="#0D253F" />
                    <text x="20" y="14" fill="#01B4E4" fontSize="11" fontWeight="900" textAnchor="middle" fontFamily="Arial Black, sans-serif">TMDB</text>
                </svg>
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        )
    }

    if (source === 'pmdb') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                <svg viewBox="0 0 40 20" className="h-3.5 w-8 shrink-0 rounded-sm">
                    <rect width="40" height="20" rx="3" fill="#7C3AED" />
                    <text x="20" y="14" fill="#FFFFFF" fontSize="10" fontWeight="900" textAnchor="middle" fontFamily="Arial Black, sans-serif">PMDB</text>
                </svg>
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        )
    }

    if (source === 'simkl') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-orange-500/40 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                <svg viewBox="0 0 40 20" className="h-3.5 w-8 shrink-0 rounded-sm">
                    <rect width="40" height="20" rx="3" fill="#F97316" />
                    <text x="20" y="14" fill="#FFFFFF" fontSize="9" fontWeight="900" textAnchor="middle" fontFamily="Arial Black, sans-serif">SIMKL</text>
                </svg>
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        )
    }

    return (
        <Tooltip content={`${source} Rating`}>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                <Star className="h-3.5 w-3.5 fill-current text-blue-400" />
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        </Tooltip>
    )
})
