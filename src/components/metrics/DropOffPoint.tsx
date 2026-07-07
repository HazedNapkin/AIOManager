import { motion } from 'framer-motion'
import { CHART_PALETTE } from '@/lib/chart-colors'
import { TrendingDown } from 'lucide-react'
import { useInView } from '@/hooks/use-in-view'

interface DropOffPointProps {
    avgEpisodes: number
    loading?: boolean
}

export function DropOffPoint({ avgEpisodes, loading }: DropOffPointProps) {
    const { ref, inView } = useInView<HTMLDivElement>()
    if (loading) {
        return <div className="h-[140px] animate-pulse rounded-xl bg-muted/30" />
    }

    const hasData = avgEpisodes > 0
    const label = !hasData ? 'Not enough data' : avgEpisodes < 2 ? 'Quick to Judge' : avgEpisodes < 4 ? 'Give It a Few' : avgEpisodes < 7 ? 'Patient Viewer' : 'Thorough Explorer'
    const color = !hasData ? CHART_PALETTE.blue.text : avgEpisodes < 2 ? '#ef4444' : avgEpisodes < 4 ? CHART_PALETTE.orange.text : avgEpisodes < 7 ? CHART_PALETTE.blue.text : CHART_PALETTE.green.text
    const insight = !hasData ? 'Watch more series to see patterns' : avgEpisodes < 2 ? 'You barely give shows a chance' : avgEpisodes < 4 ? 'You sample before committing' : avgEpisodes < 7 ? 'You invest before deciding' : 'You go deep before giving up'

    const maxEps = 10
    const fillCount = Math.min(Math.round(avgEpisodes), maxEps)

    return (
        <div ref={ref} className="rounded-2xl border border-border/35 bg-muted/15 p-4 space-y-3">
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0" style={{ background: color + '22' }}>
                    <TrendingDown className="h-4 w-4" style={{ color }} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold tabular-nums leading-none">{hasData ? avgEpisodes : '—'}</span>
                        {hasData && <span className="text-xs font-medium text-muted-foreground">eps avg</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{insight}</div>
                </div>
                <div className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: color + '22', color }}>
                    {label}
                </div>
            </div>
            {hasData && (
                <div className="relative">
                    <svg width="100%" height="32" viewBox="0 0 100 32" preserveAspectRatio="none">
                        <defs>
                            <linearGradient id="dropoffGrad" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stopColor={color} stopOpacity={0.8} />
                                <stop offset={`${(fillCount / maxEps) * 100}%`} stopColor={color} stopOpacity={0.8} />
                                <stop offset={`${(fillCount / maxEps) * 100}%`} stopColor="hsl(var(--muted))" stopOpacity={0.4} />
                                <stop offset="100%" stopColor="hsl(var(--muted))" stopOpacity={0.4} />
                            </linearGradient>
                        </defs>
                        <motion.rect
                            x="0" y="8" width="100" height="16" rx="8"
                            fill="url(#dropoffGrad)"
                            initial={{ scaleX: 0 }}
                            animate={inView ? { scaleX: 1 } : { scaleX: 0 }}
                            transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                            style={{ transformOrigin: 'left' }}
                        />
                        <motion.line
                            x1={`${(fillCount / maxEps) * 100}`} y1="4" x2={`${(fillCount / maxEps) * 100}`} y2="28"
                            stroke={color} strokeWidth="0.8" strokeLinecap="round"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.4, duration: 0.3 }}
                        />
                    </svg>
                    <div className="mt-1 flex justify-between text-[9px] text-muted-foreground/50">
                        <span>Ep 1</span>
                        <span>Ep 5</span>
                        <span>Ep 10+</span>
                    </div>
                </div>
            )}
        </div>
    )
}
