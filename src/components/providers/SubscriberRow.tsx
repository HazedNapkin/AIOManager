import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { StatusChip } from '@/components/ui/status-chip'
import { Trash2 } from 'lucide-react'
import { useState, memo } from 'react'
import type { HydraSubscriber } from '@/api/hydra-providers'

// A pull subscriber that hasn't checked in for this long is treated as stale.
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

function syncedAgo(ts: number): string {
    if (!ts) return 'never'
    const m = Math.floor((Date.now() - ts) / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
}

export const SubscriberRow = memo(function SubscriberRow({ subscriber, onRemove }: {
    subscriber: HydraSubscriber
    onRemove: (name: string) => void
}) {
    const [confirmRemove, setConfirmRemove] = useState(false)
    const stale = !subscriber.last_seen_at || Date.now() - subscriber.last_seen_at > STALE_AFTER_MS
    return (
        <div className="flex items-center gap-3 rounded-2xl border border-border/40 bg-card px-3 py-2.5 shadow-sm transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border/70 hover:bg-card/95 hover:shadow-md">
            <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-xl flex items-center justify-center bg-muted">
                {subscriber.logo
                    ? <img src={subscriber.logo} alt={subscriber.name} className="h-full w-full object-contain p-1" />
                    : <span className="text-xs font-bold text-muted-foreground">{subscriber.name[0]?.toUpperCase() || '?'}</span>}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold truncate">{subscriber.name}</span>
                    {stale ? (
                        <StatusChip size="sm" variant="warning" className="text-[10px] h-4 px-1.5 gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                            Stale
                        </StatusChip>
                    ) : (
                        <StatusChip size="sm" variant="success" className="text-[10px] h-4 px-1.5 gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-success" />
                            Synced
                        </StatusChip>
                    )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">pull · synced {syncedAgo(subscriber.last_seen_at)}</p>
            </div>
            {confirmRemove ? (
                <div className="flex items-center gap-1.5 shrink-0">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirmRemove(false)}>Cancel</Button>
                    <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => { onRemove(subscriber.name); setConfirmRemove(false) }}>Remove</Button>
                </div>
            ) : (
                <Tooltip content="Remove subscriber">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setConfirmRemove(true)}>
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </Tooltip>
            )}
        </div>
    )
})
