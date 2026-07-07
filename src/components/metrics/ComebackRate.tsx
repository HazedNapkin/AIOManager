import { motion } from 'framer-motion'
import { CHART_PALETTE } from '@/lib/chart-colors'
import { RotateCcw } from 'lucide-react'
import { Poster } from '@/components/common/Poster'
import { useInView } from '@/hooks/use-in-view'

interface ComebackRateProps {
    titles: { name: string; gap: number; poster: string }[]
    loading?: boolean
}

export function ComebackRate({ titles, loading }: ComebackRateProps) {
    const { ref, inView } = useInView<HTMLDivElement>()
    if (loading) {
        return <div className="h-[160px] animate-pulse rounded-xl bg-muted/30" />
    }

    if (!titles || titles.length === 0) {
        return (
            <div className="flex h-[160px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <RotateCcw className="h-5 w-5 opacity-50" />
                <span>No comebacks detected</span>
                <span className="text-xs text-muted-foreground/60">Titles you returned to after 2+ weeks</span>
            </div>
        )
    }

    return (
        <div ref={ref} className="space-y-2">
            {titles.map((t, i) => {
                const isLong = t.gap > 90
                const color = isLong ? CHART_PALETTE.orange.text : CHART_PALETTE.purple.text
                return (
                    <motion.div
                        key={`${t.name}-${i}`}
                        className="flex items-center gap-3 rounded-2xl border border-border/35 bg-muted/15 p-2.5"
                        initial={{ opacity: 0, x: -8 }}
                        animate={inView ? { opacity: 1, x: 0 } : { opacity: 0, x: -8 }}
                        transition={{ type: 'spring', stiffness: 120, damping: 20, delay: i * 0.06 }}
                    >
                        <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-lg border border-border/40 bg-muted">
                            {t.poster ? (
                                <Poster src={t.poster} alt={t.name} className="h-full w-full object-cover" />
                            ) : (
                                <div className="flex h-full w-full items-center justify-center">
                                    <RotateCcw className="h-4 w-4 text-muted-foreground/40" />
                                </div>
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">{t.name}</div>
                            <div className="mt-0.5 flex items-center gap-1.5">
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/50">
                                    <motion.div
                                        className="h-full rounded-full"
                                        style={{ background: color }}
                                        initial={{ width: '0%' }}
                                        animate={{ width: `${Math.min(t.gap / 180 * 100, 100)}%` }}
                                        transition={{ type: 'spring', stiffness: 100, damping: 20, delay: i * 0.06 + 0.2 }}
                                    />
                                </div>
                                <span className="text-[10px] text-muted-foreground/60 shrink-0">2wk</span>
                            </div>
                        </div>
                        <div className="shrink-0 text-right">
                            <div className="text-lg font-bold tabular-nums leading-none" style={{ color }}>{t.gap}</div>
                            <div className="text-[9px] text-muted-foreground/60">days</div>
                        </div>
                    </motion.div>
                )
            })}
        </div>
    )
}
