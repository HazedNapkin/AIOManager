import { Switch } from '@/components/ui/switch'
import { Tooltip } from '@/components/ui/tooltip'
import { ChevronRight, Loader2 } from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { Connection, ConnectionStatus } from '@/types/connection'
import { displayStatus, tokenExpiry } from '@/lib/connection-format'
import { PlatformLogo, ConnectionStatusPill, connectionLabel } from './ConnectionPrimitives'

function getHintText(conn: Connection): string {
    if (conn.connectionType === 'hydra-outbound') return 'API configuration'
    if (conn.platform === 'nuvio') return 'Plugins, Profiles, Library & more'
    return 'Session management'
}

interface ConnectionCardProps {
    connection: Connection
    status: ConnectionStatus
    lastSync?: number
    lastError?: string | null
    syncing?: boolean
    onEdit: () => void
    onToggle: () => void
    email?: string
}

export const ConnectionCard = memo(function ConnectionCard({
    connection,
    status,
    lastSync,
    lastError,
    syncing,
    onEdit,
    onToggle,
    email,
}: ConnectionCardProps) {
    const name = connectionLabel(connection)
    const expiry = tokenExpiry(connection)
    const display = displayStatus(status, expiry)

    const [enabled, setEnabled] = useState(connection.enabled)
    useEffect(() => { setEnabled(connection.enabled) }, [connection.enabled])

    const tint =
        display === 'expired' || display === 'error' ? 'border-destructive/30' :
        display === 'expiring' || display === 'degraded' ? 'border-warning/30' :
        undefined

    const statusTooltip = [
        lastError ? `Last error: ${lastError}` : null,
        expiry.label,
    ].filter(Boolean).join(' \u00b7 ')

    const stop = (e: React.SyntheticEvent) => e.stopPropagation()
    const hint = getHintText(connection)

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onEdit}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit() } }}
            className={cn(
                'group cursor-pointer rounded-2xl border border-border/40 bg-card text-card-foreground shadow-sm',
                'transition-[background-color,border-color,box-shadow,transform] duration-200',
                'hover:-translate-y-0.5 hover:border-border/70 hover:bg-card/95 hover:shadow-md',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                tint
            )}
        >
            <div className="flex items-start gap-3 p-4">
                <PlatformLogo platform={connection.platform} className="h-11 w-11 shrink-0 mt-0.5" isHydra={connection.connectionType === 'hydra-outbound'} />
                <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold leading-tight truncate">{name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Tooltip content={statusTooltip || undefined}>
                            <span className="inline-flex items-center gap-1.5">
                                <ConnectionStatusPill status={display} />
                                {syncing && <Loader2 className="h-3 w-3 animate-spin" />}
                            </span>
                        </Tooltip>
                    </div>
                    {email && (
                        <p className="text-xs text-muted-foreground truncate">{email}</p>
                    )}
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                        {connection.connectionType === 'hydra-outbound' ? 'Outbound \u00b7 ' : ''}Synced {lastSync ? timeAgo(lastSync) : 'never'}
                    </p>
                    {lastError && (
                        <p className="line-clamp-1 text-xs text-destructive">{lastError}</p>
                    )}
                    {(expiry.state === 'expiring' || expiry.state === 'expired') && (
                        <p className={cn('text-xs font-medium', expiry.state === 'expired' ? 'text-destructive' : 'text-warning')}>
                            {expiry.label}
                        </p>
                    )}
                    <p className="text-xs text-muted-foreground/60">{hint}</p>
                </div>
                <div className="flex shrink-0 flex-col items-center gap-1" onClick={stop} onKeyDown={stop}>
                    <Switch
                        checked={enabled}
                        onCheckedChange={() => { setEnabled(v => !v); onToggle() }}
                        className="scale-90"
                        aria-label={`${enabled ? 'Disable' : 'Enable'} ${name}`}
                    />
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 mt-1" />
                </div>
            </div>
        </div>
    )
})

function timeAgo(ts: number): string {
    const m = Math.floor((Date.now() - ts) / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
}
