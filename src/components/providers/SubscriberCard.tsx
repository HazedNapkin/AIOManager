import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/ui/status-chip'
import { Tooltip } from '@/components/ui/tooltip'
import { Trash2, Download } from 'lucide-react'
import { useState, memo } from 'react'
import { cn } from '@/lib/utils'
import type { HydraSubscriber } from '@/api/hydra-providers'

// A pull subscriber that hasn't checked in for this long is treated as stale.
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

function timeAgo(ts: number): string {
    if (!ts) return 'never'
    const m = Math.floor((Date.now() - ts) / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
}

// First-class connection card for a Hydra pull app. Shares ConnectionCard's shell so pull apps
// sit as equals in the connections grid. The push/pull asymmetry shows inside the card: a Pull
// badge, Synced/Stale in place of the live status pill, and a remove action where native cards
// carry an enable toggle (a backendless app can't be reached to toggle or push to).
export const SubscriberCard = memo(function SubscriberCard({ subscriber, onRemove }: {
    subscriber: HydraSubscriber
    onRemove: (name: string) => void
}) {
    const [confirmRemove, setConfirmRemove] = useState(false)
    const stale = !subscriber.last_seen_at || Date.now() - subscriber.last_seen_at > STALE_AFTER_MS
    const stop = (e: React.SyntheticEvent) => e.stopPropagation()

    return (
        <div
            className={cn(
                'group rounded-2xl border border-border/40 bg-card text-card-foreground shadow-sm',
                'transition-[background-color,border-color,box-shadow,transform] duration-200',
                'hover:-translate-y-0.5 hover:border-border/70 hover:bg-card/95 hover:shadow-md',
                stale && 'border-warning/30'
            )}
        >
            <div className="flex items-start gap-3 p-4">
                <div className="relative mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
                    {subscriber.logo
                        ? <img src={subscriber.logo} alt={subscriber.name} className="h-full w-full object-contain p-1" />
                        : <span className="text-sm font-bold text-muted-foreground">{subscriber.name[0]?.toUpperCase() || '?'}</span>}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold leading-tight truncate">{subscriber.name}</span>
                        <StatusChip size="sm" variant="muted" className="h-5 gap-1 px-2 text-[11px]">
                            <Download className="h-3 w-3" />
                            Pull
                        </StatusChip>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <StatusChip size="sm" variant={stale ? 'warning' : 'success'} className="h-5 gap-1.5 px-2 text-[11px]">
                            <span className={cn('h-1.5 w-1.5 rounded-full', stale ? 'bg-warning' : 'bg-success')} />
                            {stale ? 'Stale' : 'Synced'}
                        </StatusChip>
                    </div>
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                        Pulls your addons · synced {timeAgo(subscriber.last_seen_at)}
                    </p>
                    <p className="text-[11px] text-muted-foreground/50">Backendless app · read-only pull</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1" onClick={stop} onKeyDown={stop}>
                    {confirmRemove ? (
                        <div className="flex flex-col items-end gap-1.5">
                            <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => { onRemove(subscriber.name); setConfirmRemove(false) }}>Remove</Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirmRemove(false)}>Cancel</Button>
                        </div>
                    ) : (
                        <Tooltip content="Remove app">
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => setConfirmRemove(true)}>
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </Tooltip>
                    )}
                </div>
            </div>
        </div>
    )
})
