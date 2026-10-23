import type { Connection, ConnectionStatus } from '@/types/connection'
import { AlertCircle, CheckCircle2, Loader2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getPlatformEntry } from '@/lib/platform-registry'
import { StatusChip, type StatusChipProps } from '@/components/ui/status-chip'
import type { DisplayStatus } from '@/lib/connection-format'
import hydraLogo from '@/assets/platforms/hydra.png'

export interface ConnectionTestOutcome {
    ok: boolean
    message: string
}

export function ConnectionTestButton({ testing, disabled, onClick }: {
    testing: boolean
    disabled?: boolean
    onClick: () => void
}) {
    return (
        <Button variant="subtle" size="sm" className="h-8 shrink-0 gap-1.5 text-xs" onClick={onClick} disabled={testing || disabled} aria-busy={testing}>
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            {testing ? 'Testing...' : 'Test Connection'}
        </Button>
    )
}

export function ConnectionTestResult({ result }: { result: ConnectionTestOutcome | null }) {
    if (!result) return null
    return (
        <div data-theme-tone="status"
            role={result.ok ? 'status' : 'alert'}
            data-theme-part="panel"
            className={cn(
                'flex items-start gap-2 rounded-xl border px-3 py-2 text-xs',
                result.ok
                    ? 'border-success/30 bg-success/10 text-success'
                    : 'border-destructive/30 bg-destructive/10 text-destructive'
            )}
        >
            {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="min-w-0 break-words">{result.message}</span>
        </div>
    )
}

export const STATUS_LABEL: Record<ConnectionStatus, string> = {
    active: 'Active',
    expired: 'Expired',
    error: 'Error',
    degraded: 'Degraded',
    pending: 'Pending',
}

const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
    ...STATUS_LABEL,
    expiring: 'Expiring',
}

const DISPLAY_STATUS_VARIANT: Record<DisplayStatus, StatusChipProps['variant']> = {
    active: 'success',
    expiring: 'warning',
    degraded: 'warning',
    pending: 'muted',
    expired: 'destructive',
    error: 'destructive',
}

const DISPLAY_STATUS_DOT: Record<DisplayStatus, string> = {
    active: 'bg-success',
    expiring: 'bg-warning',
    degraded: 'bg-warning',
    pending: 'bg-muted-foreground',
    expired: 'bg-destructive',
    error: 'bg-destructive',
}

export function StatusDot({ status }: { status: ConnectionStatus }) {
    return (
        <span className={cn(
            'h-1.5 w-1.5 rounded-full',
            status === 'active' ? 'bg-success' :
            status === 'expired' || status === 'error' ? 'bg-destructive' :
            'bg-warning'
        )} />
    )
}

// Labeled status pill (dot + word) used in the connection list. Larger and more legible than the
// bare StatusDot, and carries a text label so status isn't conveyed by colour alone.
export function ConnectionStatusPill({ status, className }: { status: DisplayStatus; className?: string }) {
    return (
        <StatusChip
            size="sm"
            variant={DISPLAY_STATUS_VARIANT[status]}
            className={cn('h-5 gap-1.5 px-2 text-[11px]', className)}
        >
            <span className={cn('h-1.5 w-1.5 rounded-full', DISPLAY_STATUS_DOT[status])} />
            {DISPLAY_STATUS_LABEL[status]}
        </StatusChip>
    )
}

export function PlatformLogo({ platform, className, isHydra }: { platform: string; className?: string; isHydra?: boolean }) {
    if (isHydra) {
        return (
            <div data-theme-part="image-tile" className={cn('relative overflow-hidden rounded-xl bg-muted/50', className)}>
                <img src={hydraLogo} alt="Hydra" loading="lazy" className="h-full w-full object-contain p-1" />
            </div>
        )
    }
    const entry = getPlatformEntry(platform)
    if (entry) {
        return (
            <div data-theme-part="image-tile" className={cn('relative overflow-hidden rounded-xl bg-muted/50', className)}>
                <img src={entry.logo} alt={entry.name} loading="lazy" className="h-full w-full object-contain p-1" />
            </div>
        )
    }
    return (
        <div data-theme-part="image-tile" className={cn('relative flex items-center justify-center rounded-xl bg-muted', className)}>
            <span className="relative z-10 text-xs font-bold text-muted-foreground">
                {platform[0]?.toUpperCase() || '?'}
            </span>
        </div>
    )
}

export function connectionLabel(connection: Connection): string {
    if (connection.platform === 'jellyfin') return connection.mediaServer?.productName || connection.displayName || 'Jellyfin-compatible server'
    const isHydra = connection.connectionType === 'hydra-outbound'
    const entry = getPlatformEntry(connection.platform)
    return isHydra
        ? (connection.driverConfig?.name || connection.displayName || connection.platform)
        : (entry?.name || connection.displayName || connection.platform)
}
