import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { CHART_PALETTE } from '@/lib/chart-colors'
import { useInView } from '@/hooks/use-in-view'

interface VelocityChartProps {
    contentVelocity: { item: { name: string }; velocity: number; days: number; episodes: number }[]
    loading?: boolean
}

export function VelocityChart({ contentVelocity, loading }: VelocityChartProps) {
    const { ref, inView } = useInView<HTMLDivElement>()
    const data = useMemo(() =>
        [...(contentVelocity || [])]
            .sort((a, b) => b.velocity - a.velocity)
            .slice(0, 8)
            .map((v, i) => ({
                name: v.item?.name?.length > 16 ? v.item.name.slice(0, 15) + '...' : v.item?.name || 'Unknown',
                velocity: Math.round((v.velocity || 0) * 10) / 10,
                episodes: v.episodes || 0,
                days: v.days || 0,
                color: i < 3 ? CHART_PALETTE.green.text : CHART_PALETTE.blue.text,
            })),
        [contentVelocity]
    )

    if (loading) {
        return <div className="h-[200px] animate-pulse rounded-xl bg-muted/30" />
    }

    if (data.length === 0) {
        return <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">No velocity data</div>
    }

    const max = Math.max(...data.map(d => d.velocity), 1)

    return (
        <div ref={ref} className="space-y-2">
            {data.map((entry, index) => (
                <div key={entry.name} className="rounded-2xl border border-border/35 bg-muted/15 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{entry.name}</div>
                            <div className="text-xs text-muted-foreground">{entry.episodes} episodes in {entry.days} day{entry.days === 1 ? '' : 's'}</div>
                        </div>
                        <div className="text-right">
                            <div className="text-sm font-bold tabular-nums">{entry.velocity}</div>
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">eps/day</div>
                        </div>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted/50">
                        <motion.div
                            className="h-full rounded-full"
                            style={{ background: index < 3 ? CHART_PALETTE.green.text : CHART_PALETTE.blue.text }}
                            initial={{ width: '0%' }}
                            animate={inView ? { width: `${Math.max(6, (entry.velocity / max) * 100)}%` } : { width: '0%' }}
                            transition={{ type: 'spring', stiffness: 100, damping: 20, delay: index * 0.06 }}
                        />
                    </div>
                </div>
            ))}
        </div>
    )
}
