
import { useTheme } from '@/contexts/ThemeContext'
import { ActivityItem } from '@/types/activity'
import { formatDistanceToNow } from 'date-fns'
import { PlayCircle, Trash2 } from 'lucide-react'
import { memo, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

import { cn, openStremioDetail } from '@/lib/utils'
import { Poster } from '@/components/common/Poster'
import { PlatformSourceBadge } from '@/components/activity/PlatformSourceBadge'
import { SquircleOverlay } from '@/components/ui/squircle-overlay'

const AVATAR_COLORS = [
  'bg-blue-500/20 text-blue-400',
  'bg-purple-500/20 text-purple-400',
  'bg-green-500/20 text-green-400',
  'bg-yellow-500/20 text-yellow-400',
  'bg-rose-500/20 text-rose-400',
  'bg-cyan-500/20 text-cyan-400',
  'bg-orange-500/20 text-orange-400',
  'bg-pink-500/20 text-pink-400',
] as const

interface ActivityItemCardProps {
    entry: ActivityItem
    viewMode: 'grid' | 'list'
    isSelected: boolean
    isBulkMode: boolean
    onToggleSelect?: (id: string | string[]) => void
    onDelete?: (id: string | string[], removeFromLibrary: boolean) => void
}

export const ActivityItemCard = memo(({
    entry,
    viewMode,
    isSelected,
    isBulkMode,
    onToggleSelect,
    onDelete
}: ActivityItemCardProps) => {
    const { isLight } = useTheme()

    const item = entry
    const isEpisodeLike = item.type === 'series' || item.type === 'anime' || item.type === 'episode'
    const episodeLabel = isEpisodeLike && item.episode !== undefined ? `S${item.season ?? 1} E${item.episode}` : null

    const userName = item.accountName || 'Unknown User'

    const itemDate = useMemo(() => {
        const d = new Date(item.timestamp)
        return isNaN(d.getTime()) ? new Date() : d
    }, [item.timestamp])

    const isLive = useMemo(() => Date.now() - itemDate.getTime() < 1200000, [itemDate])

    const remainingMinutes = useMemo(() => item.duration && item.watched
        ? Math.max(0, Math.round((item.duration - item.watched) / 60000))
        : 0, [item.duration, item.watched])

    const getAvatarColor = (index: number) => {
        return AVATAR_COLORS[index % AVATAR_COLORS.length]
    }

    const handleClick = () => {
        if (isBulkMode || isSelected) { // If bulk mode OR passing selection, toggle
            onToggleSelect?.(item.id)
        } else {
            // Open in Stremio Desktop App
            openStremioDetail(item.type, item.itemId)
        }
    }

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation()
        onDelete?.(item.id, true)
    }


    if (viewMode === 'grid') {
        return (
            <div
                className="group flex flex-col gap-1.5 cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                role="button"
                tabIndex={0}
                onClick={handleClick}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick() } }}
            >

                <div className={cn(
                    "relative aspect-[2/3] rounded-2xl overflow-hidden border transition-[transform,opacity,box-shadow] duration-200 shadow-sm group-hover:shadow-lg",
                    isSelected ? `border-primary ring-2 ${isLight ? 'ring-primary/20' : 'ring-primary/10'} scale-[0.98]` : 'border-transparent group-hover:border-primary/40'
                )}>

                    {isSelected && (
                        <div className="absolute top-2 left-2 z-30 w-6 h-6 rounded-full border-2 border-background shadow-lg flex items-center justify-center animate-in zoom-in-50 duration-200" style={{ background: 'hsl(var(--primary))' }}>
                            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                    )}

                    <Poster
                        src={item.poster}
                        itemId={item.itemId}
                        itemType={item.type}
                        alt={item.name}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                    />

                    {item.source && <PlatformSourceBadge source={item.source} />}


                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />


                    {!isBulkMode && !isSelected && (
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                            <div className="rounded-full border border-white/25 bg-black/75 p-3 shadow-xl">
                                <PlayCircle className={`w-7 h-7 text-white ${isLight ? 'drop-shadow-lg' : 'drop-shadow-sm'}`} />
                            </div>
                        </div>
                    )}


                    {item.progress > 0 && (
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
                            <div className="h-full bg-primary transition-[transform,opacity,box-shadow] duration-500" style={{ width: `${item.progress}%` }} />
                        </div>
                    )}


                    {isLive && (
                        <div className="absolute top-2 right-2 z-20">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/65 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white shadow-xl">
                                <span className="h-1.5 w-1.5 rounded-full bg-success" /> Now
                            </span>
                        </div>
                    )}


                    {episodeLabel && (
                        <div className="absolute bottom-2 left-2 z-10">
                            <span className={cn(
                                "text-xs font-bold px-1.5 py-0.5 rounded-full bg-black/75",
                                getAvatarColor(item.accountColorIndex).split(' ')[1]
                            )}>
                                {episodeLabel}
                            </span>
                        </div>
                    )}


                    {item.progress > 0 && !isLive && (
                        <div className="absolute bottom-2 right-2 z-10">
                            <span className="text-xs font-bold text-white/80 bg-black/75 rounded-full px-1.5 py-0.5">
                                {Math.round(item.progress)}%
                            </span>
                        </div>
                    )}
                </div>


                <div className="px-0.5 space-y-0.5">
                    <p className="font-bold text-xs text-foreground leading-tight line-clamp-1 truncate">{item.name}</p>
                    <div className="flex items-center gap-1.5">
                        {episodeLabel && (
                            <span className="shrink-0 font-mono text-xs font-bold text-primary">
                                {episodeLabel}
                            </span>
                        )}

                        <div className="relative w-4 h-4 shrink-0 flex items-center justify-center">
                            <SquircleOverlay />
                            <span className="relative z-10 text-xs font-bold text-muted-foreground">{userName[0]?.toUpperCase()}</span>
                        </div>
                        <span className="text-xs text-muted-foreground truncate font-medium">{userName}</span>
                        {!isLive && (
                            <span className="text-xs text-muted-foreground/60 font-mono ml-auto shrink-0">
                                {formatDistanceToNow(itemDate, { addSuffix: false })}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        )
    }

    // LIST VIEW
    return (
        <div
            role="button"
            tabIndex={0}
            className={cn(
                'group flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-2xl border bg-card/70 p-3 shadow-sm transition-[transform,opacity,box-shadow] duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background md:gap-4 md:p-4',
                isSelected
                    ? `border-primary ring-2 ${isLight ? 'ring-primary/20' : 'ring-primary/10'} bg-primary/5`
                    : 'border-border/40 hover:border-border hover:bg-muted/25 hover:shadow-md'
            )}
            onClick={handleClick}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick() } }}
        >

            {isSelected && (
                <div className="shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-[transform,opacity,box-shadow] bg-primary border-primary">
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                </div>
            )}


            <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-2xl bg-muted shadow-sm md:h-28 md:w-20">
                <Poster
                    src={item.poster}
                    itemId={item.itemId}
                    itemType={item.type}
                    className="w-full h-full object-cover"
                    loading="lazy"
                />
                {item.source && <PlatformSourceBadge source={item.source} />}
                {isLive && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <div className={`w-2 h-2 rounded-full bg-success animate-pulse ${isLight ? 'shadow-lg shadow-success/50' : 'shadow-sm shadow-success/20'}`} />
                    </div>
                )}
                {item.progress > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
                        <div className="h-full bg-primary transition-[transform,opacity,box-shadow] duration-500" style={{ width: `${item.progress}%` }} />
                    </div>
                )}
            </div>


            <div className="min-w-0 flex-1 space-y-1.5">

                <div className="flex items-start justify-between gap-2">
                    <h4 className="truncate text-base font-bold leading-tight tracking-tight md:text-lg">{item.name}</h4>
                    {isLive && (
                        <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-xs font-semibold uppercase text-success">
                            <span className="h-1.5 w-1.5 rounded-full bg-success" /> Live
                        </span>
                    )}
                </div>


                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">

                    <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/45 px-2 py-0.5 text-xs font-semibold uppercase text-muted-foreground">
                        {item.type}
                    </span>

                    {episodeLabel && (
                        <span className="text-xs font-mono font-bold text-muted-foreground">
                            {episodeLabel}
                        </span>
                    )}

                </div>


                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                        <div className="relative w-5 h-5 shrink-0 flex items-center justify-center">
                            <SquircleOverlay />
                            <span className="relative z-10 text-xs font-bold text-muted-foreground">{userName[0]?.toUpperCase()}</span>
                        </div>
                        <span className="text-xs font-semibold text-muted-foreground">{userName}</span>
                    </div>
                    <span className="text-xs text-muted-foreground/60 font-mono">
                        {isLive ? 'Watching now' : formatDistanceToNow(itemDate, { addSuffix: true })}
                    </span>
                </div>


                {item.progress > 0 && (
                    <div className="flex items-center gap-2 max-w-xs">
                        <Progress value={item.progress} className="h-1 flex-1" />
                        <span className="text-xs font-bold text-muted-foreground/60 tabular-nums">
                            {Math.round(item.progress)}%{remainingMinutes > 0 && ` · ${remainingMinutes}m`}
                        </span>
                    </div>
                )}

            </div>

            <Button
                variant="ghost"
                size="icon"
                className="inline-flex h-8 w-8 shrink-0 text-muted-foreground transition-opacity hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
                onClick={handleDelete}
                aria-label="Delete activity item"
            >
                <Trash2 className="h-4 w-4" />
            </Button>
        </div>
    )
})

ActivityItemCard.displayName = 'ActivityItemCard'
