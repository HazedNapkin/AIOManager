import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Tooltip } from '@/components/ui/tooltip'
import { CHART_PALETTE } from '@/lib/chart-colors'
import { useInView } from '@/hooks/use-in-view'

interface ContributionGraphProps {
    dailyActivity: Record<string, number>
    loading?: boolean
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const CELL = 13
const GAP = 3

function getIntensity(count: number, max: number): number {
    if (count === 0) return 0
    const ratio = count / max
    if (ratio < 0.25) return 1
    if (ratio < 0.5) return 2
    if (ratio < 0.75) return 3
    return 4
}

const INTENSITY_COLORS = [
    'hsl(var(--muted))',
    CHART_PALETTE.blue.text + '33',
    CHART_PALETTE.blue.text + '66',
    CHART_PALETTE.blue.text + '99',
    CHART_PALETTE.blue.text,
]

export function ContributionGraph({ dailyActivity, loading }: ContributionGraphProps) {
    const { ref, inView } = useInView<HTMLDivElement>()
    const { weeks, monthBorders, maxVal, total } = useMemo(() => {
        const entries = Object.entries(dailyActivity)
        if (entries.length === 0) return { weeks: [] as { date: string; count: number }[][], monthBorders: [] as { label: string; weekIndex: number }[], maxVal: 0, total: 0 }

        const dates = entries.map(([d]) => new Date(d))
        const minDate = new Date(Math.min(...dates.map(d => d.getTime())))
        const maxDate = new Date()

        const startSunday = new Date(minDate)
        startSunday.setDate(minDate.getDate() - minDate.getDay())

        const days: { date: string; count: number }[] = []
        const cursor = new Date(startSunday)
        while (cursor <= maxDate) {
            const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
            days.push({ date: key, count: dailyActivity[key] || 0 })
            cursor.setDate(cursor.getDate() + 1)
        }

        const weekChunks: { date: string; count: number }[][] = []
        for (let i = 0; i < days.length; i += 7) {
            weekChunks.push(days.slice(i, i + 7))
        }

        const borders: { label: string; weekIndex: number }[] = []
        let lastMonth = -1
        weekChunks.forEach((week, wi) => {
            const firstDay = week[0]
            if (firstDay) {
                const month = new Date(firstDay.date).getMonth()
                if (month !== lastMonth) {
                    borders.push({ label: MONTH_LABELS[month], weekIndex: wi })
                    lastMonth = month
                }
            }
        })

        return {
            weeks: weekChunks,
            monthBorders: borders,
            maxVal: Math.max(...entries.map(([, c]) => c), 1),
            total: entries.reduce((sum, [, c]) => sum + c, 0),
        }
    }, [dailyActivity])

    if (loading) {
        return <div className="h-[200px] animate-pulse rounded-xl bg-muted/30" />
    }

    if (weeks.length === 0) {
        return <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">No activity data</div>
    }

    const labelColWidth = 28
    const weekWidth = CELL + GAP
    const gridWidth = weeks.length * weekWidth

    return (
        <div ref={ref} className="rounded-2xl border border-border/35 bg-muted/15 p-3">
            <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{total} plays in the last year</span>
            </div>
            <div className="overflow-x-auto">
                <div style={{ minWidth: `${labelColWidth + gridWidth + 10}px` }}>
                    <div className="relative mb-1" style={{ height: '16px', marginLeft: `${labelColWidth}px` }}>
                        <svg width={gridWidth} height={16} style={{ overflow: 'visible' }}>
                            {monthBorders.map((mb, i) => (
                                <text
                                    key={i}
                                    x={mb.weekIndex * weekWidth}
                                    y={12}
                                    fill="hsl(var(--muted-foreground))"
                                    fontSize={10}
                                    fontWeight={500}
                                    opacity={0.7}
                                >
                                    {mb.label}
                                </text>
                            ))}
                        </svg>
                    </div>
                    <div className="flex gap-1">
                        <div className="flex flex-col shrink-0" style={{ width: `${labelColWidth}px` }}>
                            {DAY_LABELS.map((day, i) => (
                                <div key={day} className="flex items-center" style={{ height: `${CELL}px`, marginBottom: `${GAP}px` }}>
                                    {i % 2 === 1 && <span className="text-[9px] text-muted-foreground/60">{day}</span>}
                                </div>
                            ))}
                        </div>
                        <div className="flex" style={{ gap: `${GAP}px` }}>
                            {weeks.map((week, wi) => (
                                <div key={wi} className="flex flex-col" style={{ gap: `${GAP}px` }}>
                                    {Array.from({ length: 7 }, (_, di) => {
                                        const day = week[di]
                                        if (!day) return <div key={di} style={{ height: `${CELL}px`, width: `${CELL}px` }} />
                                        const intensity = getIntensity(day.count, maxVal)
                                        return (
                                            <Tooltip
                                                key={di}
                                                content={day.count > 0 ? `${day.date}: ${day.count} plays` : `${day.date}: no activity`}
                                                delayDuration={100}
                                            >
                                                <motion.div
                                                    style={{
                                                        height: `${CELL}px`,
                                                        width: `${CELL}px`,
                                                        borderRadius: '2px',
                                                        background: INTENSITY_COLORS[intensity],
                                                    }}
                                                    initial={{ opacity: 0, scale: 0.5 }}
                                                    animate={inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.5 }}
                                                    transition={{ type: 'spring', stiffness: 200, damping: 20, delay: Math.min((wi * 7 + di) * 0.001, 0.4) }}
                                                />
                                            </Tooltip>
                                        )
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            <div className="mt-3 flex items-center justify-end gap-1.5">
                <span className="text-[10px] text-muted-foreground/60">Less</span>
                {INTENSITY_COLORS.map((c, i) => (
                    <div key={i} className="h-[10px] w-[10px] rounded-sm" style={{ background: c }} />
                ))}
                <span className="text-[10px] text-muted-foreground/60">More</span>
            </div>
        </div>
    )
}
