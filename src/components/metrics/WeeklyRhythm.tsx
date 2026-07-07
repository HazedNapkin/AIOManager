import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { CHART_PALETTE } from '@/lib/chart-colors'
import { useInView } from '@/hooks/use-in-view'

interface WeeklyRhythmProps {
    weeklyRhythm: number[]
    loading?: boolean
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WORK_DAYS = [1, 2, 3, 4, 5]

export function WeeklyRhythm({ weeklyRhythm, loading }: WeeklyRhythmProps) {
    const { ref, inView } = useInView<HTMLDivElement>()
    const { max, total, peakDay } = useMemo(() => {
        const max = Math.max(...(weeklyRhythm || []), 1)
        const total = (weeklyRhythm || []).reduce((a, b) => a + b, 0)
        const peakDay = (weeklyRhythm || []).indexOf(max)
        return { max, total, peakDay }
    }, [weeklyRhythm])

    if (loading) {
        return <div className="h-[160px] animate-pulse rounded-xl bg-muted/30" />
    }

    if (total === 0) {
        return <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">No activity data</div>
    }

    const isWeekendWarrior = weeklyRhythm[0] + weeklyRhythm[6] > total * 0.4
    const subtitle = isWeekendWarrior ? 'Weekends are your prime time' : peakDay >= 0 ? `${DAY_LABELS[peakDay]} is your biggest day` : ''

    return (
        <div ref={ref} className="rounded-2xl border border-border/35 bg-muted/15 p-3">
            <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{subtitle}</span>
                <span className="text-xs font-bold">{total} plays</span>
            </div>
            <div className="grid grid-cols-7 gap-2">
                {DAY_LABELS.map((day, i) => {
                    const count = weeklyRhythm?.[i] || 0
                    const height = Math.max(8, (count / max) * 100)
                    const isWeekend = !WORK_DAYS.includes(i)
                    return (
                        <div key={day} className="flex flex-col items-center">
                            <div className="flex h-24 items-end rounded-xl bg-background/30 p-1 w-full">
                                <motion.div
                                    className="w-full mt-auto rounded-lg"
                                    style={{ background: isWeekend ? CHART_PALETTE.orange.text : CHART_PALETTE.blue.text }}
                                    initial={{ height: '0%' }}
                                    animate={inView ? { height: `${height}%` } : { height: '0%' }}
                                    transition={{ type: 'spring', stiffness: 120, damping: 18, delay: i * 0.06 }}
                                />
                            </div>
                            <div className="mt-1.5 text-[10px] font-bold tabular-nums">{count}</div>
                            <div className={`text-[10px] ${isWeekend ? 'text-orange-500/70 font-semibold' : 'text-muted-foreground/60'}`}>{day}</div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
