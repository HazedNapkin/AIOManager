import { useMemo, type ComponentProps } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { CHART_PALETTE } from '@/lib/chart-colors'

interface ContentDonutProps {
    typeCounts: { movie: number; series: number; other: number }
    loading?: boolean
}

const SEGMENTS = [
    { key: 'movie', label: 'Movies', color: CHART_PALETTE.orange.text },
    { key: 'series', label: 'Series', color: CHART_PALETTE.blue.text },
    { key: 'other', label: 'Other', color: CHART_PALETTE.purple.text },
]

export function ContentDonut({ typeCounts, loading }: ContentDonutProps) {
    const data = useMemo(() =>
        SEGMENTS.map(s => ({
            name: s.label,
            value: typeCounts?.[s.key as keyof typeof typeCounts] || 0,
            color: s.color,
        })).filter(d => d.value > 0),
        [typeCounts]
    )

    const total = data.reduce((sum, d) => sum + d.value, 0)

    if (loading) {
        return <div className="h-[180px] animate-pulse rounded-xl bg-muted/30" />
    }

    if (data.length === 0) {
        return <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">No data</div>
    }

    const tooltipFormatter: NonNullable<ComponentProps<typeof Tooltip>['formatter']> = (value, name) =>
        [`${value} (${Math.round(Number(value) / total * 100)}%)`, name]

    return (
        <div className="grid gap-3 sm:grid-cols-[180px_1fr] sm:items-center">
            <div className="relative">
                <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={75}
                            paddingAngle={3}
                            dataKey="value"
                            strokeWidth={0}
                            isAnimationActive={true}
                            animationDuration={600}
                            animationBegin={100}
                        >
                            {data.map((entry, index) => (
                                <Cell key={index} fill={entry.color} fillOpacity={0.82} />
                            ))}
                        </Pie>
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'hsl(var(--card))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '0.75rem',
                                fontSize: '12px',
                                zIndex: 100,
                                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                            }}
                            wrapperStyle={{ zIndex: 100, outline: 'none' }}
                            formatter={tooltipFormatter}
                        />
                    </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                        <div className="text-xl font-bold">{total}</div>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">plays</div>
                    </div>
                </div>
            </div>
            <div className="space-y-2">
                {data.map((entry) => (
                    <div key={entry.name} className="flex items-center justify-between rounded-2xl border border-border/35 bg-muted/15 px-3 py-2">
                        <span className="flex items-center gap-2 text-sm font-medium">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: entry.color }} />
                            {entry.name}
                        </span>
                        <span className="text-sm font-bold tabular-nums">{Math.round(entry.value / total * 100)}%</span>
                    </div>
                ))}
            </div>
        </div>
    )
}
