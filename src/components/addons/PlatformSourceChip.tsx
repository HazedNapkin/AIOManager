import { useMemo } from 'react'
import { getPlatformEntry } from '@/lib/platform-registry'
import { Tooltip } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useRelativeTime } from '@/hooks/use-relative-time'
import { aggregatePlatformSources, type PlatformSourceAccount, type PlatformSyncTarget } from './platform-source'

export function platformName(id: string): string {
    return getPlatformEntry(id)?.name || id
}

function TinyPlatformLogo({ platform }: { platform: string }) {
    const entry = getPlatformEntry(platform)
    if (entry) {
        return <img src={entry.logo} alt="" loading="lazy" className="h-3.5 w-3.5 shrink-0 rounded-full object-contain" />
    }
    return (
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-muted text-[8px] font-bold text-muted-foreground">
            {platform[0]?.toUpperCase() || '?'}
        </span>
    )
}

// Honest per-target state line. Never claims the addon is verified there: connectivity and
// last sync state only describe where the collection is mirrored when sync succeeds.
function targetStateLine(target: PlatformSyncTarget, formatRelative: (input: number | Date | null | undefined) => string | null): string {
    const rel = target.lastSync ? formatRelative(target.lastSync) : null
    switch (target.status) {
        case 'active':
            if (target.implicit) return rel ? `Session synced ${rel}` : 'Session not synced yet'
            return rel ? `Synced ${rel}` : 'Not synced yet. Installation is unverified.'
        case 'pending':
            return rel ? `Last synced ${rel}. Waiting to sync again.` : 'Waiting for first sync'
        case 'degraded':
            return rel ? `Degraded. Last synced ${rel}.` : 'Degraded. Not synced yet.'
        case 'error':
            return `Last sync failed${target.lastError ? `: ${target.lastError}` : ''}`
        case 'expired':
            return 'Session expired. Reconnect to resume syncing.'
    }
}

function targetStateClass(target: PlatformSyncTarget): string {
    switch (target.status) {
        case 'active':
            return target.lastSync ? 'text-muted-foreground' : 'text-muted-foreground/80'
        case 'pending':
            return 'text-muted-foreground/80'
        case 'degraded':
            return 'text-warning'
        case 'error':
        case 'expired':
            return 'text-destructive'
    }
}

interface PlatformSourceChipProps {
    // Single owning account (surfaces inside one account's addon list).
    account?: PlatformSourceAccount | null
    // Several accounts. e.g. every account whose recorded list contains one saved addon.
    // Their targets are aggregated per platform (freshest sync, worst status).
    accounts?: Array<PlatformSourceAccount | null | undefined>
    // Copy context for the details popover: 'account' explains one account's connections,
    // 'addon' explains a saved addon's recorded homes. Defaults to 'account'.
    scope?: 'account' | 'addon'
    className?: string
}

// Shows which platform(s) an addon collection lives on, derived from the owning account's
// connections (or, for a saved addon, from the accounts whose recorded lists contain it).
// One platform renders a named chip; several render stacked logos with the full list on
// hover. Paused platforms still show: pausing sync never removes existing addons. Hover
// keeps the original "Lives on ..." text; focus/tap opens an accessible details popover
// describing the connected sync targets, their last synced state, and paused platforms.
export function PlatformSourceChip({ account, accounts, scope = 'account', className }: PlatformSourceChipProps) {
    const list = useMemo(
        () => (accounts ?? (account ? [account] : [])).filter((a): a is PlatformSourceAccount => !!a),
        [account, accounts]
    )
    const { platforms, targets, paused } = useMemo(() => aggregatePlatformSources(list), [list])
    const formatRelative = useRelativeTime()

    if (platforms.length === 0) return null

    const names = platforms.map(platformName)
    const hoverText = `Lives on ${names.join(', ')}`
    const intro =
        scope === 'addon'
            ? 'These platforms are connected to accounts that have this addon in their recorded lists. Installation on each platform has not been verified.'
            : "These platforms are connected to this account. Sync sends the account's addon collection to them. Installation on each platform has not been verified."

    return (
        <Popover>
            <Tooltip content={hoverText}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        aria-label={`${hoverText}. Sync target details`}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        className={cn(
                            'inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-full border border-border/40 bg-muted/30 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/40',
                            platforms.length === 1 ? 'pl-1 pr-1.5' : 'px-1.5',
                            className
                        )}
                    >
                        {platforms.length === 1 ? (
                            <>
                                <TinyPlatformLogo platform={platforms[0]} />
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{names[0]}</span>
                            </>
                        ) : (
                            <>
                                <span className="flex -space-x-1">
                                    {platforms.slice(0, 3).map(id => (
                                        <span key={id} className="rounded-full ring-1 ring-card">
                                            <TinyPlatformLogo platform={id} />
                                        </span>
                                    ))}
                                </span>
                                <span className="text-[10px] font-semibold text-muted-foreground">{platforms.length} platforms</span>
                            </>
                        )}
                    </button>
                </PopoverTrigger>
            </Tooltip>
            <PopoverContent side="top" className="w-72 p-3 text-left">
                    <p className="text-xs font-semibold text-foreground">Sync targets</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{intro}</p>
                    {targets.length === 0 ? (
                        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                            No active sync targets. Every connection is paused.
                        </p>
                    ) : (
                        <ul className="mt-2 space-y-1.5">
                            {targets.map(target => (
                                <li key={target.platform} className="flex items-start gap-2">
                                    <span className="mt-0.5 shrink-0">
                                        <TinyPlatformLogo platform={target.platform} />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-xs font-medium text-foreground">{platformName(target.platform)}</span>
                                        <span className={cn('block text-[11px] leading-snug', targetStateClass(target))}>
                                            {targetStateLine(target, formatRelative)}
                                            {target.accountCount && target.accountCount > 1 ? ` · ${target.accountCount} accounts` : ''}
                                        </span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                    {paused.length > 0 && (
                        <p className="mt-2 border-t border-border/40 pt-2 text-[11px] leading-relaxed text-muted-foreground/80">
                            Sync paused for {paused.map(platformName).join(', ')}. Existing installations there are unchanged.
                        </p>
                    )}
                </PopoverContent>
        </Popover>
    )
}
