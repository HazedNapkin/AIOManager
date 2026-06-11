import { useMemo } from 'react'
import { CHART_PALETTE } from '@/lib/chart-colors'

interface WeekComparisonProps {
    thisWeekCount: number
    lastWeekCount: number
    weekOverWeek: number
    loading?: boolean
}

export function WeekComparison({ thisWeekCount, lastWeekCount, weekOverWeek, loading }: WeekComparisonProps) {
    const data = useMemo(() => [
        { period: 'Last Week', count: lastWeekCount || 0, color: CHART_PALETTE.purple.text },
        { period: 'This Week', count: thisWeekCount || 0, color: CHART_PALETTE.blue.text },
    ], [thisWeekCount, lastWeekCount])

    const maxVal = Math.max(thisWeekCount || 0, lastWeekCount || 0, 1)

    if (loading) {
        return <div className="h-[160px] animate-pulse rounded-xl bg-muted/30" />
    }

    return (
        <div className="rounded-2xl border border-border/35 bg-muted/15 p-3">
            <div className="mb-4 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Week over Week</span>
                {weekOverWeek !== 0 && (
                    <span className={`text-xs font-semibold ${weekOverWeek > 0 ? 'text-success' : 'text-destructive'}`}>
                        {weekOverWeek > 0 ? '+' : ''}{Math.round(weekOverWeek)}%
                    </span>
                )}
            </div>
            <div className="grid grid-cols-2 gap-3">
                {data.map((entry) => {
                    const pct = Math.max(8, (entry.count / maxVal) * 100)
                    return (
                        <div key={entry.period} className="flex h-32 flex-col justify-end rounded-2xl bg-background/35 p-3">
                            <div className="mb-2 text-2xl font-bold tabular-nums">{entry.count}</div>
                            <div className="mb-2 flex h-20 items-end rounded-full bg-muted/50 p-1">
                                <div
                                    className="mt-auto rounded-full"
                                    style={{ height: `${pct}%`, background: entry.color }}
                                />
                            </div>
                            <div className="text-xs font-medium text-muted-foreground">{entry.period}</div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
