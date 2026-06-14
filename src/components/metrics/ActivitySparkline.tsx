import { useMemo } from 'react'
import { CHART_PALETTE } from '@/lib/chart-colors'

interface ActivitySparklineProps {
    streakMap: number[]
    loading?: boolean
}

export function ActivitySparkline({ streakMap, loading }: ActivitySparklineProps) {
    const data = useMemo(() => {
        if (!streakMap?.length) return []
        const visible = streakMap.slice(-30)
        const now = Date.now()
        return visible.map((count, index) => {
            const dayTs = now - (visible.length - 1 - index) * 86400000
            const d = new Date(dayTs)
            return {
                day: `${d.getMonth() + 1}/${d.getDate()}`,
                count,
            }
        })
    }, [streakMap])

    if (loading) {
        return <div className="h-[140px] animate-pulse rounded-xl bg-muted/30" />
    }

    if (data.length === 0) {
        return <div className="flex h-[140px] items-center justify-center text-sm text-muted-foreground">No activity data</div>
    }

    const max = Math.max(...data.map(d => d.count), 1)
    const total = data.reduce((sum, d) => sum + d.count, 0)

    return (
        <div className="h-[140px] rounded-2xl border border-border/35 bg-muted/15 p-3">
            <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Last 30 days</span>
                <span className="text-xs font-bold text-foreground">{total} plays</span>
            </div>
            <div className="flex h-20 items-end gap-1">
                {data.map((d, i) => {
                    const height = Math.max(8, (d.count / max) * 100)
                    const active = d.count > 0
                    return (
                        <div
                            key={`${d.day}-${i}`}
                            title={`${d.day}: ${d.count} plays`}
                            className="flex-1 rounded-full transition-opacity hover:opacity-100"
                            style={{
                                height: `${height}%`,
                                background: active ? CHART_PALETTE.blue.text : 'hsl(var(--muted))',
                                opacity: active ? 0.35 + (d.count / max) * 0.65 : 0.35,
                            }}
                        />
                    )
                })}
            </div>
            <div className="mt-2 flex justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                <span>{data[0]?.day}</span>
                <span>Today</span>
            </div>
        </div>
    )
}
