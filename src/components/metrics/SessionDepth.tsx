import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { CHART_PALETTE } from '@/lib/chart-colors'
import { useInView } from '@/hooks/use-in-view'

interface SessionDepthProps {
    sessionDepths: { label: string; count: number }[]
    loading?: boolean
}

const COLORS = [
    CHART_PALETTE.blue.text,
    CHART_PALETTE.cyan.text,
    CHART_PALETTE.purple.text,
    CHART_PALETTE.orange.text,
]

export function SessionDepth({ sessionDepths, loading }: SessionDepthProps) {
    const { ref, inView } = useInView<HTMLDivElement>()
    const max = useMemo(() => Math.max(...(sessionDepths?.map(s => s.count) || [0]), 1), [sessionDepths])
    const total = useMemo(() => sessionDepths?.reduce((sum, s) => sum + s.count, 0) || 0, [sessionDepths])

    if (loading) {
        return <div className="h-[140px] animate-pulse rounded-xl bg-muted/30" />
    }

    if (!sessionDepths || total === 0) {
        return <div className="flex h-[140px] items-center justify-center text-sm text-muted-foreground">No session data</div>
    }

    return (
        <div ref={ref} className="rounded-2xl border border-border/35 bg-muted/15 p-3">
            <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{total} total sessions</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
                {sessionDepths.map((s, i) => {
                    const pct = (s.count / max) * 100
                    const sharePct = total > 0 ? Math.round((s.count / total) * 100) : 0
                    return (
                        <div key={s.label} className="flex flex-col rounded-2xl bg-background/30 p-3 border border-border/30">
                            <div className="mb-1 text-lg font-bold tabular-nums">{s.count}</div>
                            <div className="mb-2 text-[10px] text-muted-foreground">{s.label}</div>
                            <div className="flex h-16 items-end rounded-xl bg-muted/40 p-1">
                                <motion.div
                                    className="w-full mt-auto rounded-lg"
                                    style={{ background: COLORS[i % COLORS.length] }}
                                    initial={{ height: '0%' }}
                                    animate={inView ? { height: `${Math.max(6, pct)}%` } : { height: '0%' }}
                                    transition={{ type: 'spring', stiffness: 100, damping: 20, delay: i * 0.08 }}
                                />
                            </div>
                            <div className="mt-1.5 text-[10px] font-semibold text-muted-foreground/70">{sharePct}%</div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
