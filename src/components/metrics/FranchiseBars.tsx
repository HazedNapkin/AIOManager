import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { CHART_PALETTE } from '@/lib/chart-colors'
import { useInView } from '@/hooks/use-in-view'

interface FranchiseBarsProps {
    franchiseFocus: { name: string; count: number }[]
    loading?: boolean
}

export function FranchiseBars({ franchiseFocus, loading }: FranchiseBarsProps) {
    const { ref, inView } = useInView<HTMLDivElement>()
    const data = useMemo(() =>
        (franchiseFocus || []).slice(0, 8).map((f, i) => ({
            name: f.name?.length > 16 ? f.name.slice(0, 15) + '...' : f.name || 'Unknown',
            count: f.count,
            color: Object.values(CHART_PALETTE)[i % Object.values(CHART_PALETTE).length].text,
        })),
        [franchiseFocus]
    )

    if (loading) {
        return <div className="h-[200px] animate-pulse rounded-xl bg-muted/30" />
    }

    if (data.length === 0) {
        return <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">No franchise data</div>
    }

    const max = Math.max(...data.map(d => d.count), 1)

    return (
        <div ref={ref} className="space-y-2">
            {data.map((entry, index) => (
                <div key={entry.name} className="rounded-2xl border border-border/35 bg-muted/15 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="text-xs font-bold text-muted-foreground/60">#{index + 1}</span>
                            <span className="truncate text-sm font-semibold">{entry.name}</span>
                        </div>
                        <span className="text-sm font-bold tabular-nums">{entry.count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted/50">
                        <motion.div
                            className="h-full rounded-full"
                            style={{ background: entry.color }}
                            initial={{ width: '0%' }}
                            animate={inView ? { width: `${Math.max(6, (entry.count / max) * 100)}%` } : { width: '0%' }}
                            transition={{ type: 'spring', stiffness: 100, damping: 20, delay: index * 0.06 }}
                        />
                    </div>
                </div>
            ))}
        </div>
    )
}
