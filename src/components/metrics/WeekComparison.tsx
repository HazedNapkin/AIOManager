import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { CHART_PALETTE } from '@/lib/chart-colors'
import { useInView } from '@/hooks/use-in-view'

interface WeekComparisonProps {
    thisWeekCount: number
    lastWeekCount: number
    weekOverWeek: number
    loading?: boolean
}

export function WeekComparison({ thisWeekCount, lastWeekCount, weekOverWeek, loading }: WeekComparisonProps) {
    const { ref, inView } = useInView<HTMLDivElement>()
    const data = useMemo(() => [
        { period: 'Last Week', count: lastWeekCount || 0, color: CHART_PALETTE.purple.text },
        { period: 'This Week', count: thisWeekCount || 0, color: CHART_PALETTE.blue.text },
    ], [thisWeekCount, lastWeekCount])

    const maxVal = Math.max(thisWeekCount || 0, lastWeekCount || 0, 1)
    const diff = (thisWeekCount || 0) - (lastWeekCount || 0)
    const isUp = diff > 0
    const isFlat = diff === 0

    if (loading) {
        return <div className="h-[200px] animate-pulse rounded-xl bg-muted/30" />
    }

    const TrendIcon = isFlat ? Minus : isUp ? TrendingUp : TrendingDown

    return (
        <div ref={ref} className="space-y-3">
            <div className="flex items-center justify-between rounded-2xl border border-border/35 bg-muted/15 px-3 py-2.5">
                <div className="flex items-center gap-2">
                    <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${isFlat ? 'bg-muted' : isUp ? 'bg-success/10' : 'bg-destructive/10'}`}>
                        <TrendIcon className={`h-3.5 w-3.5 ${isFlat ? 'text-muted-foreground' : isUp ? 'text-success' : 'text-destructive'}`} />
                    </div>
                    <div>
                        <div className="text-sm font-bold">
                            {isFlat ? 'Steady' : isUp ? `Up ${diff} item${diff !== 1 ? 's' : ''}` : `Down ${Math.abs(diff)} item${Math.abs(diff) !== 1 ? 's' : ''}`}
                        </div>
                        <div className="text-xs text-muted-foreground">vs last week</div>
                    </div>
                </div>
                {weekOverWeek !== 0 && (
                    <span className={`text-lg font-bold tabular-nums ${isUp ? 'text-success' : 'text-destructive'}`}>
                        {weekOverWeek > 0 ? '+' : ''}{Math.round(weekOverWeek)}%
                    </span>
                )}
            </div>
            <div className="grid grid-cols-2 gap-3">
                {data.map((entry, i) => {
                    const pct = Math.max(6, (entry.count / maxVal) * 100)
                    return (
                        <div key={entry.period} className="flex flex-col rounded-2xl bg-muted/15 border border-border/30 p-3">
                            <div className="mb-1.5 text-xs font-medium text-muted-foreground">{entry.period}</div>
                            <div className="mb-2 text-2xl font-bold tabular-nums">{entry.count}</div>
                            <div className="text-[10px] text-muted-foreground/70 mb-2">items watched</div>
                            <div className="flex h-16 items-end rounded-xl bg-background/40 p-1.5">
                                <motion.div
                                    className="w-full mt-auto rounded-lg"
                                    style={{ background: entry.color }}
                                    initial={{ height: '0%' }}
                                    animate={inView ? { height: `${pct}%` } : { height: '0%' }}
                                    transition={{ type: 'spring', stiffness: 100, damping: 18, delay: i * 0.1 }}
                                />
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
