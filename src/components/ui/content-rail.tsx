import { useRef, memo, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, X, Heart } from 'lucide-react'
import { Poster } from '@/components/common/Poster'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface RailWatcher {
    id: string
    avatar?: string
    emoji?: string
    name: string
}

export interface ContentRailCardProps {
    poster?: string
    title: string
    subtitle?: string
    caption?: string
    rank?: number
    itemId?: string
    itemType?: string
    watchers?: RailWatcher[]
    onDismiss?: () => void
    onLove?: () => void
    isLoved?: boolean
    onClick?: () => void
    index?: number
}

export interface ContentRailProps {
    title: string
    subtitle?: string
    icon?: ReactNode
    count?: number
    countLabel?: string
    children: ReactNode
    scrollAmount?: number
    className?: string
}

export const ContentRailCard = memo(function ContentRailCard({
    poster,
    title,
    subtitle,
    caption,
    rank,
    itemId,
    itemType,
    watchers,
    onDismiss,
    onLove,
    isLoved,
    onClick,
    index = 0,
}: ContentRailCardProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index * 0.04, 0.5), duration: 0.3, ease: 'easeOut' }}
            className="group relative w-32 md:w-36 shrink-0 cursor-pointer flex flex-col"
            onClick={onClick}
        >
            <div className={cn(
                'relative h-48 md:h-56 w-full overflow-hidden rounded-2xl border border-border/40 shadow-sm bg-muted',
                'transition-[transform,box-shadow,border-color] duration-200',
                'group-hover:border-primary/50 group-hover:shadow-lg',
            )}>
                <Poster
                    src={poster}
                    itemId={itemId}
                    itemType={itemType}
                    alt={title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                />

                <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/60 to-transparent" />

                {typeof rank === 'number' && (
                    <div className="absolute left-2 top-2 z-10 rounded-full bg-black/55 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-sm">
                        #{rank}
                    </div>
                )}

                {watchers && watchers.length > 0 && (
                    <div className="absolute bottom-2 right-2 z-10 flex items-center -space-x-1.5">
                        {watchers.slice(0, 3).map(w => (
                            <div key={w.id} className="h-5 w-5 rounded-full border border-background overflow-hidden bg-card shadow-sm flex items-center justify-center">
                                {w.avatar ? (
                                    <img src={w.avatar} alt="" className="h-full w-full object-cover" loading="lazy" />
                                ) : w.emoji ? (
                                    <span className="text-[9px]">{w.emoji}</span>
                                ) : (
                                    <span className="text-[8px] font-bold text-muted-foreground">{(w.name.charAt(0) || '?').toUpperCase()}</span>
                                )}
                            </div>
                        ))}
                        {watchers.length > 3 && (
                            <div className="h-5 w-5 rounded-full border border-background bg-card shadow-sm flex items-center justify-center">
                                <span className="text-[8px] font-bold text-muted-foreground">+{watchers.length - 3}</span>
                            </div>
                        )}
                    </div>
                )}

                {onDismiss && (
                    <div className="absolute right-2 top-2 z-20 flex gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
                        {onLove && (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onLove() }}
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur-sm transition-all hover:scale-110 hover:bg-black/85"
                                aria-label={isLoved ? 'Unlove' : 'Love'}
                            >
                                <Heart className={cn('h-3.5 w-3.5', isLoved && 'fill-red-500 text-red-500')} />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onDismiss() }}
                            className="flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur-sm transition-all hover:scale-110 hover:bg-black/85"
                            aria-label="Dismiss"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                )}
            </div>

            <div className="mt-2 w-full px-0.5">
                <p className="line-clamp-2 min-h-[2.25rem] text-xs font-semibold leading-tight text-foreground transition-colors group-hover:text-primary">
                    {title}
                </p>
                {subtitle && (
                    <p className="truncate text-[11px] text-muted-foreground/70 leading-tight">{subtitle}</p>
                )}
                {caption && (
                    <p className="truncate text-[10px] text-muted-foreground/60 leading-tight">{caption}</p>
                )}
            </div>
        </motion.div>
    )
})

export function ContentRail({
    title,
    subtitle,
    icon,
    count,
    countLabel,
    children,
    scrollAmount = 300,
    className,
}: ContentRailProps) {
    const scrollRef = useRef<HTMLDivElement>(null)

    const scroll = (dir: 'left' | 'right') => {
        scrollRef.current?.scrollBy({
            left: dir === 'left' ? -scrollAmount : scrollAmount,
            behavior: 'smooth',
        })
    }

    return (
        <section className={cn(
            'rounded-2xl border border-border/40 bg-card/50 p-3 shadow-sm',
            className,
        )}>
            <div className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-2">
                    {icon && <div className="shrink-0 text-primary">{icon}</div>}
                    <div className="min-w-0">
                        <h3 className="text-sm font-semibold leading-tight tracking-tight text-foreground">{title}</h3>
                        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {typeof count === 'number' && (
                        <span className="text-xs font-medium text-muted-foreground">{count} {countLabel || 'titles'}</span>
                    )}
                    <button
                        type="button"
                        onClick={() => scroll('left')}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-border/40 bg-background/95 opacity-70 shadow-sm transition-all hover:bg-muted hover:opacity-100"
                        aria-label="Scroll left"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => scroll('right')}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-border/40 bg-background/95 opacity-70 shadow-sm transition-all hover:bg-muted hover:opacity-100"
                        aria-label="Scroll right"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                </div>
            </div>
            <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-1 pt-3 scrollbar-hide scroll-smooth">
                {children}
            </div>
        </section>
    )
}

export function ContentRailSkeleton({ count = 6 }: { count?: number }) {
    return (
        <section className="rounded-2xl border border-border/40 bg-card/50 p-3 shadow-sm">
            <div className="flex items-center gap-2.5">
                <Skeleton className="h-5 w-44" />
            </div>
            <div className="flex gap-4 pt-3">
                {Array.from({ length: count }).map((_, i) => (
                    <div key={i} className="w-32 md:w-36 shrink-0 space-y-2">
                        <Skeleton className="h-48 md:h-56 w-full rounded-2xl" />
                        <Skeleton className="h-3 w-4/5" />
                        <Skeleton className="h-2.5 w-3/5" />
                    </div>
                ))}
            </div>
        </section>
    )
}
