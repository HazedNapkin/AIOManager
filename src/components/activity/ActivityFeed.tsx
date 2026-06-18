
import { ActivityItem } from '@/types/activity'
import { isToday, isYesterday, format } from 'date-fns'
import { Activity, ArrowUp } from 'lucide-react'
import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ActivityItemCard } from './ActivityItemCard'
import { ActivityEmptyState } from '@/components/common/PageEmptyStates'
import { NumberTicker } from '@/components/ui/number-ticker'
import { StatusChip } from '@/components/ui/status-chip'

const INITIAL_VISIBLE_COUNT = 60
const VISIBLE_COUNT_INCREMENT = 40
const EMPTY_SELECTED_ITEMS = new Set<string>()

interface ActivityFeedProps {
    history: ActivityItem[]
    viewMode?: 'grid' | 'list'
    todayHours?: number
    todayTrend?: 'up' | 'down'
    onToggleSelect?: (id: string | string[]) => void
    onDelete?: (id: string | string[], removeFromLibrary: boolean) => void
    selectedItems?: Set<string>
    isBulkMode?: boolean
}

export function ActivityFeed({
    history,
    viewMode = 'grid',
    todayHours = 0,
    todayTrend = 'up',
    onToggleSelect,
    onDelete,
    selectedItems,
    isBulkMode = false,
}: ActivityFeedProps) {
    const safeSelectedItems = selectedItems ?? EMPTY_SELECTED_ITEMS
    const [activeTab, setActiveTab] = useState("all")
    const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT)
    const [showScrollTop, setShowScrollTop] = useState(false)

    useEffect(() => {
        setVisibleCount(INITIAL_VISIBLE_COUNT)
    }, [activeTab])

    useEffect(() => {
        let ticking = false
        const handleScroll = () => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    setShowScrollTop(window.scrollY > 400)
                    ticking = false
                })
                ticking = true
            }
        }
        window.addEventListener('scroll', handleScroll, { passive: true })
        return () => window.removeEventListener('scroll', handleScroll)
    }, [])

    const scrollToTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    const filteredHistory = useMemo(() => {
        let filtered = history

        if (activeTab === 'movies') filtered = filtered.filter(h => h.type === 'movie')
        else if (activeTab === 'series') filtered = filtered.filter(h => h.type === 'series' || h.type === 'anime' || h.type === 'episode')
        else if (activeTab === 'now') {
            const twentyMinsAgo = new Date().getTime() - (20 * 60 * 1000)
            filtered = filtered.filter(h => new Date(h.timestamp).getTime() > twentyMinsAgo)
        }

        return filtered
    }, [history, activeTab])

    const groupedHistory = useMemo(() => {
        const dates: string[] = []
        const groups: Record<string, ActivityItem[]> = {}

        const sortedHistory = [...filteredHistory].sort((a, b) => {
            const ta = new Date(a.timestamp).getTime()
            const tb = new Date(b.timestamp).getTime()
            return (isNaN(tb) ? -Infinity : tb) - (isNaN(ta) ? -Infinity : ta)
        })

        sortedHistory.forEach(item => {
            const date = new Date(item.timestamp)
            const dateStr = isNaN(date.getTime()) ? 'Unknown Date' : date.toDateString()

            if (!groups[dateStr]) {
                groups[dateStr] = []
                dates.push(dateStr)
            }

            // Activity is an event log: each episode/watch should remain visible.
            groups[dateStr].push(item)
        })

        return dates.map(date => {
            let dateId = ''
            if (date !== 'Unknown Date') {
                const d = new Date(date)
                if (!isNaN(d.getTime())) {
                    dateId = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                }
            }
            const items = groups[date]
            return { date, dateId, items, watchCount: items.length }
        })
    }, [filteredHistory])

    const filteredWatchHours = useMemo(() => {
        const seriesWithOverall = new Map<string, number>()
        let totalMs = 0
        for (const item of filteredHistory) {
            const isSeries = item.type === 'series' || item.type === 'anime' || item.type === 'episode'
            if (isSeries && item.overallTimeWatched) {
                const prev = seriesWithOverall.get(item.itemId) || 0
                if (item.overallTimeWatched > prev) {
                    totalMs += item.overallTimeWatched - prev
                    seriesWithOverall.set(item.itemId, item.overallTimeWatched)
                }
            } else {
                totalMs += item.watched || 0
            }
        }
        return Math.round(totalMs / 3600000)
    }, [filteredHistory])
    const tabCounts = useMemo(() => {
        const twentyMinsAgo = new Date().getTime() - (20 * 60 * 1000)
        let now = 0
        let movies = 0
        let series = 0

        for (const item of history) {
            if (new Date(item.timestamp).getTime() > twentyMinsAgo) now++
            if (item.type === 'movie') movies++
            if (item.type === 'series' || item.type === 'anime' || item.type === 'episode') series++
        }

        return {
            all: history.length,
            now,
            movies,
            series,
        }
    }, [history])

    const formatDateHeader = useCallback((dateStr: string) => {
        if (dateStr === 'Unknown Date') return dateStr
        const date = new Date(dateStr)
        if (isToday(date)) return 'Today'
        if (isYesterday(date)) return 'Yesterday'
        return format(date, 'MMMM d, yyyy')
    }, [])

    const { visibleGroups, hasMore } = useMemo(() => {
        let count = 0
        const visible: typeof groupedHistory = []
        let moreAvailable = false

        for (const group of groupedHistory) {
            if (count >= visibleCount) {
                moreAvailable = true
                break
            }

            visible.push(group)
            count += group.watchCount
        }

        return {
            visibleGroups: visible,
            hasMore: moreAvailable
        }
    }, [groupedHistory, visibleCount])

    const sentinelRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        if (!hasMore || !sentinelRef.current) return
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setVisibleCount(c => c + VISIBLE_COUNT_INCREMENT)
                }
            },
            { threshold: 0.1 }
        )
        observer.observe(sentinelRef.current)
        return () => observer.disconnect()
    }, [hasMore, visibleGroups.length])

    const renderEmptyState = () => <ActivityEmptyState />

    const renderFeedContent = () => {
        if (filteredHistory.length === 0) return renderEmptyState()

        return (
            <div className="space-y-4 pb-20">
                {visibleGroups.map(({ date, dateId, items, watchCount }) => (
                    <section
                        key={date}
                        id={dateId ? `activity-date-${dateId}` : undefined}
                        className="space-y-3 rounded-2xl border border-border/40 bg-card/50 p-3 shadow-sm"
                    >
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                                <Activity className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate text-sm font-semibold">{formatDateHeader(date)}</span>
                            </div>
                            <StatusChip variant="muted" className="rounded-lg bg-background/70 px-2 tabular-nums">
                                {watchCount} {watchCount === 1 ? 'watch' : 'watches'}
                            </StatusChip>
                        </div>

                        <div className={viewMode === 'grid' ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4" : "space-y-3"}>
                            {items.map((item) => (
                                <ActivityItemCard
                                    key={item.id}
                                    entry={item}
                                    viewMode={viewMode}
                                    isSelected={safeSelectedItems.has(item.id)}
                                    isBulkMode={isBulkMode}
                                    onToggleSelect={onToggleSelect}
                                    onDelete={onDelete}
                                />
                            ))}
                        </div>
                    </section>
                ))}

                {hasMore && (
                    <div ref={sentinelRef} className="py-12 flex justify-center w-full">
                        <div className="flex items-center gap-2 text-muted-foreground animate-pulse">
                            <Activity className="h-4 w-4" />
                            <span className="text-sm font-medium">Loading history...</span>
                        </div>
                    </div>
                )}
            </div>
        )
    }

    const renderTabCount = (count: number) => (
        <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-lg border border-border/35 bg-background/70 px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
            {count}
        </span>
    )

    return (
        <div className="space-y-6">
            <Tabs defaultValue="all" onValueChange={setActiveTab} className="w-full">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <TabsList>
                        <TabsTrigger value="all">All Activity {renderTabCount(tabCounts.all)}</TabsTrigger>
                        <TabsTrigger value="now">Recent {renderTabCount(tabCounts.now)}</TabsTrigger>
                        <TabsTrigger value="movies">Movies {renderTabCount(tabCounts.movies)}</TabsTrigger>
                        <TabsTrigger value="series">Series {renderTabCount(tabCounts.series)}</TabsTrigger>
                    </TabsList>

                    <div className="flex max-w-full flex-nowrap items-center gap-x-1.5 gap-y-1 overflow-x-auto rounded-xl border border-border/40 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
                        <span className="opacity-70">Showing</span>
                        <span className="font-semibold tabular-nums text-foreground">
                            {filteredHistory.length === 0
                                ? '0'
                                : <NumberTicker value={Math.min(visibleCount, filteredHistory.length)} />
                            }
                        </span>
                        <span className="opacity-50">of</span>
                        <span className="font-semibold tabular-nums text-foreground">
                            {filteredHistory.length === 0
                                ? '0'
                                : <NumberTicker value={filteredHistory.length} />
                            }
                        </span>
                        <span className="h-3.5 w-px bg-border/60" />
                        <span className="tabular-nums text-foreground"><NumberTicker value={filteredWatchHours} />h total</span>
                        {todayHours > 0 && (
                            <>
                                <span className="h-3.5 w-px bg-border/60" />
                                <span className={todayTrend === 'up' ? 'text-success' : 'text-warning'}>
                                    Today <span className="font-semibold tabular-nums">{todayTrend === 'up' ? '↑' : '↓'}{todayHours}h</span>
                                </span>
                            </>
                        )}
                    </div>
                </div>

                <TabsContent value="all" className="mt-0">{renderFeedContent()}</TabsContent>
                <TabsContent value="movies" className="mt-0">{renderFeedContent()}</TabsContent>
                <TabsContent value="series" className="mt-0">{renderFeedContent()}</TabsContent>
                <TabsContent value="now" className="mt-0">{renderFeedContent()}</TabsContent>
            </Tabs>

            <div className={`fixed bottom-24 right-5 md:bottom-8 md:right-8 z-40 transition-[transform,opacity,box-shadow] duration-300 ${showScrollTop ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}>
                <Button
                    size="icon"
                    variant="outline"
                    className="h-10 w-10 rounded-full shadow-lg md:h-11 md:w-11"
                    onClick={scrollToTop}
                >
                    <ArrowUp className="h-5 w-5 md:h-6 md:w-6" />
                </Button>
            </div>
        </div>
    )
}
