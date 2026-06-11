import { useMemo } from 'react'
import { CHART_PALETTE } from '@/lib/chart-colors'

interface WatchFunnelProps {
    funnel: { started: number; engaged: number; finished: number }
    loading?: boolean
}

export function WatchFunnel({ funnel, loading }: WatchFunnelProps) {
    const data = useMemo(() => [
        { stage: 'Started', count: funnel?.started || 0, color: CHART_PALETTE.blue.text },
        { stage: 'Engaged', count: funnel?.engaged || 0, color: CHART_PALETTE.purple.text },
        { stage: 'Finished', count: funnel?.finished || 0, color: CHART_PALETTE.green.text },
    ], [funnel])

    if (loading) {
        return <div className="h-[160px] animate-pulse rounded-xl bg-muted/30" />
    }

    return (
        <div className="space-y-3">
            {data.map((entry, index) => {
                const max = Math.max(...data.map(d => d.count), 1)
                const pct = Math.round((entry.count / max) * 100)
                const previous = index === 0 ? entry.count : data[index - 1].count
                const retention = previous > 0 ? Math.round((entry.count / previous) * 100) : 0
                return (
                    <div key={entry.stage} className="rounded-2xl border border-border/35 bg-muted/15 p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-semibold">{entry.stage}</div>
                                <div className="text-xs text-muted-foreground">{index === 0 ? 'All starts' : `${retention}% from previous step`}</div>
                            </div>
                            <div className="text-lg font-bold tabular-nums">{entry.count}</div>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted/50">
                            <div
                                className="h-full rounded-full"
                                style={{ width: `${pct}%`, background: entry.color }}
                            />
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
