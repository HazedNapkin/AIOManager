import type { Connection, ConnectionStatus } from '@/types/connection'
import { cn } from '@/lib/utils'
import { getPlatformEntry } from '@/lib/platform-registry'
import { StatusChip, type StatusChipProps } from '@/components/ui/status-chip'
import type { DisplayStatus } from '@/lib/connection-format'
import hydraLogo from '@/assets/platforms/hydra.png'

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
            <div className={cn('relative overflow-hidden rounded-xl', className)}>
                <img src={hydraLogo} alt="Hydra" className="h-full w-full object-contain p-1" />
            </div>
        )
    }
    const entry = getPlatformEntry(platform)
    if (entry) {
        return (
            <div className={cn('relative overflow-hidden rounded-xl', className)}>
                <img src={entry.logo} alt={entry.name} className="h-full w-full object-contain p-1" />
            </div>
        )
    }
    return (
        <div className={cn('relative flex items-center justify-center', className)}>
            <div className="absolute inset-0 rounded-xl bg-muted" />
            <span className="relative z-10 text-xs font-bold text-muted-foreground">
                {platform[0]?.toUpperCase() || '?'}
            </span>
        </div>
    )
}

export function connectionLabel(connection: Connection): string {
    const isHydra = connection.connectionType === 'hydra-outbound'
    const entry = getPlatformEntry(connection.platform)
    return isHydra
        ? (connection.driverConfig?.name || connection.displayName || connection.platform)
        : (entry?.name || connection.displayName || connection.platform)
}
