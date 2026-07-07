import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { CHART_PALETTE } from '@/lib/chart-colors'
import { Tooltip } from '@/components/ui/tooltip'
import { useInView } from '@/hooks/use-in-view'

interface ActivityHeatmapProps {
    itemsByHour: number[]
    loading?: boolean
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const HOUR_LABELS = HOURS.map(h => {
    const period = h < 12 ? 'am' : 'pm'
    const display = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${display}${period}`
})

const COLORS = [
    CHART_PALETTE.purple.text, CHART_PALETTE.purple.text,
    CHART_PALETTE.blue.text, CHART_PALETTE.blue.text,
    CHART_PALETTE.blue.text, CHART_PALETTE.blue.text,
    CHART_PALETTE.cyan.text, CHART_PALETTE.cyan.text,
    CHART_PALETTE.cyan.text, CHART_PALETTE.green.text,
    CHART_PALETTE.green.text, CHART_PALETTE.green.text,
    CHART_PALETTE.yellow.text, CHART_PALETTE.yellow.text,
    CHART_PALETTE.orange.text, CHART_PALETTE.orange.text,
    CHART_PALETTE.orange.text, CHART_PALETTE.red.text,
    CHART_PALETTE.red.text, CHART_PALETTE.pink.text,
    CHART_PALETTE.pink.text, CHART_PALETTE.purple.text,
    CHART_PALETTE.purple.text, CHART_PALETTE.purple.text,
]

export function ActivityHeatmap({ itemsByHour, loading }: ActivityHeatmapProps) {
    const { ref, inView } = useInView<HTMLDivElement>()
    const data = useMemo(() =>
        HOURS.map((h, i) => ({
            hour: HOUR_LABELS[i],
            short: h.toString().padStart(2, '0'),
            count: itemsByHour?.[h] || 0,
            color: COLORS[h],
        })),
        [itemsByHour]
    )

    if (loading) {
        return <div className="h-[200px] animate-pulse rounded-xl bg-muted/30" />
    }

    const maxVal = Math.max(...data.map(d => d.count), 1)

    const peak = data.reduce((best, item) => item.count > best.count ? item : best, data[0])

    return (
        <div ref={ref} className="h-[200px] rounded-2xl border border-border/35 bg-muted/15 p-3">
            <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Peak hour</span>
                <span className="text-xs font-bold text-foreground">{peak?.hour || '12am'}</span>
            </div>
            <div className="grid h-32 items-end gap-1" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                {data.map((entry) => {
                    const height = Math.max(8, (entry.count / maxVal) * 100)
                    return (
                        <Tooltip key={entry.hour} content={`${entry.hour}: ${entry.count} plays`} delayDuration={100}>
                            <motion.div
                                className="rounded-full transition-opacity hover:opacity-100"
                                style={{
                                    background: entry.color,
                                    opacity: entry.count > 0 ? 0.22 + (entry.count / maxVal) * 0.78 : 0.18,
                                }}
                                initial={{ height: '0%' }}
                                animate={inView ? { height: `${height}%` } : { height: '0%' }}
                                transition={{ type: 'spring', stiffness: 120, damping: 18, delay: entry.short === '00' ? 0 : parseInt(entry.short) * 0.02 }}
                            />
                        </Tooltip>
                    )
                })}
            </div>
            <div className="mt-2 flex justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                <span>12a</span>
                <span>6a</span>
                <span>12p</span>
                <span>6p</span>
                <span>11p</span>
            </div>
        </div>
    )
}
