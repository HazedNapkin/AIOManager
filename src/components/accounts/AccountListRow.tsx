import { memo, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Account } from '@/types/account'
import { Tooltip } from '@/components/ui/tooltip'
import { AccountAvatar } from './AccountAvatar'
import { PlatformLogo } from '@/components/providers/ConnectionPrimitives'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn, getLatestAddonVersion, maskEmail, getTimeAgo, isNewerVersion } from '@/lib/utils'
import { AlertTriangle, ShieldCheck, ArrowUpCircle, Pencil, RefreshCw, ChevronRight, StickyNote, AlertCircle, MoreVertical, RotateCw, Trash } from 'lucide-react'
import { useAddonStore } from '@/store/addonStore'
import { useFailoverStore } from '@/store/failoverStore'
import { useLibraryCache } from '@/store/libraryCache'
import { useAccountStore, getAccountEmail, getStremioAuthKey, hasPlatformConnection } from '@/store/accountStore'
import { useShallow } from 'zustand/react/shallow'
import { useAccounts } from '@/hooks/useAccounts'
import { useUIStore } from '@/store/uiStore'
import { useToast } from '@/hooks/use-toast'

interface AccountListRowProps {
    account: Account
    isPrivacyMode?: boolean
    isSelected?: boolean
    isSelectionMode?: boolean
    onToggleSelect?: (accountId: string) => void
    onDelete?: (accountId: string) => void
}

export const AccountListRow = memo(function AccountListRow({
    account,
    isPrivacyMode = false,
    isSelected = false,
    isSelectionMode = false,
    onToggleSelect,
    onDelete,
}: AccountListRowProps) {
    const navigate = useNavigate()
    const { toast } = useToast()
    const { syncAccount, repairAccount, loading } = useAccounts()
    const openAddAccountDialog = useUIStore((state) => state.openAddAccountDialog)
    const [isMenuOpen, setIsMenuOpen] = useState(false)

    const accountEmail = getAccountEmail(account)
    const isNameCustomized = account.name !== accountEmail && account.name !== 'Account' && account.name !== 'Stremio Account'
    const displayName =
        isPrivacyMode && !isNameCustomized
            ? account.name.includes('@') ? maskEmail(account.name) : '********'
            : (account.name || accountEmail || 'Unnamed Account')

    const updateCount = useAddonStore(
        useShallow((state) =>
            account.addons.filter(addon => {
                const latest = getLatestAddonVersion(state.latestVersions, addon)
                return latest && isNewerVersion(addon.manifest.version, latest)
            }).length
        )
    )

    const recentChanges = useAccountStore(
        useShallow((state) => state.changelog.filter(
            e => e.accountId === account.id &&
                Date.now() - new Date(e.timestamp).getTime() < 24 * 60 * 60 * 1000
        ).length)
    )

    const failoverRules = useFailoverStore(
        useShallow((state) => state.rules.filter(r => r.accountId === account.id))
    )
    const activeRules = useMemo(() => failoverRules.filter(r => r.isActive), [failoverRules])
    const failedOverRules = useMemo(() => activeRules.filter(r => r.activeUrl !== r.priorityChain?.[0]), [activeRules])

    const protectedCount = useMemo(
        () => account.addons.filter(a => a.flags?.protected).length,
        [account.addons]
    )

    const accountItems = useLibraryCache(
        useShallow((state) => state.items.filter(i => i.accountId === account.id))
    )
    const lastWatched = useMemo(() => {
        if (accountItems.length === 0) return null
        return [...accountItems].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0]
    }, [accountItems])

    const timeStr = getTimeAgo(new Date(account.lastSync))
    const isStale = (Date.now() - new Date(account.lastSync).getTime()) > 24 * 60 * 60 * 1000
    const hasAccentColor = account.accentColor && account.accentColor !== 'none'
    const accentColor = hasAccentColor ? account.accentColor! : null

    const handleCardClick = () => {
        if (isMenuOpen) return
        if (isSelectionMode) {
            onToggleSelect?.(account.id)
            return
        }
        navigate(`/account/${account.id}`)
    }

    return (
        <>
        <div
            role="button"
            tabIndex={0}
            aria-pressed={isSelectionMode ? isSelected : undefined}
            onClick={handleCardClick}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick() } }}
            className={cn(
                'group relative flex cursor-pointer items-center gap-2 rounded-[1.35rem] border border-border/45 bg-card/80 px-3 py-3 shadow-sm transition-[background-color,border-color,box-shadow,transform,opacity] duration-200 hover:-translate-y-0.5 hover:border-border/70 hover:bg-card/95 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:gap-3 sm:px-4',
                isSelected && 'border-primary/45 bg-primary/8 shadow-[0_0_0_1px_hsl(var(--primary)/0.18)]',
                isMenuOpen && 'z-40'
            )}
        >
            {isSelectionMode && (
                <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                >
                    <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onToggleSelect?.(account.id)}
                        aria-label={isPrivacyMode ? 'Select account' : `Select ${displayName}`}
                    />
                </div>
            )}


            <div className="relative shrink-0">
                <AccountAvatar account={account} size="md" />
                {accentColor && (
                    <span
                        className="pointer-events-none absolute inset-0 rounded-xl"
                        style={{ boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accentColor} 65%, transparent)` }}
                        aria-hidden="true"
                    />
                )}
            </div>


            <div className="flex-1 min-w-0">

                <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate text-sm font-semibold tracking-tight">{displayName}</span>
                    {account.status === 'error' && (
                        <Tooltip content="Try syncing again. If it keeps failing, open account settings and update credentials." side="top">
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive shrink-0">
                                <AlertCircle className="w-3 h-3" /> Sync failed
                            </span>
                        </Tooltip>
                    )}
                    {account.status === 'expired' && (
                        <Tooltip content="A session token was rejected. Re-authenticate this account to refresh it." side="top">
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-warning shrink-0">
                                <AlertCircle className="w-3 h-3" /> Session expired
                            </span>
                        </Tooltip>
                    )}
                </div>


                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    {(hasPlatformConnection(account) || (account.connections || []).filter(c => c.platform !== 'stremio').length > 0) && (
                        <div className="flex items-center gap-0.5">
                            {getStremioAuthKey(account) && (
                                <PlatformLogo platform="stremio" className="h-4 w-4" />
                            )}
                            {(account.connections || []).filter(c => c.platform !== 'stremio').map(conn => (
                                <PlatformLogo key={conn.id} platform={conn.platform} className={cn("h-4 w-4", conn.enabled === false && "opacity-40 grayscale")} />
                            ))}
                        </div>
                    )}
                    {!account.hideLastWatched && lastWatched && (
                        <>
                            <span className="hidden sm:inline shrink-0">·</span>
                            <span className="hidden truncate text-muted-foreground sm:inline">
                                Watching <span className="font-medium text-foreground/80">{lastWatched.name}</span>
                            </span>
                        </>
                    )}
                    {!account.hideLastWatched && lastWatched && (
                        <span className="hidden min-[380px]:inline shrink-0">·</span>
                    )}
                    <span className="hidden min-[380px]:flex shrink-0 items-center gap-1">
                        {isStale && <AlertTriangle className="w-2.5 h-2.5 text-warning" />}
                        Synced {timeStr}
                    </span>
                </div>
            </div>


            <div className="hidden items-center gap-2 shrink-0 sm:flex">
                <Tooltip content={`${account.addons.length} addon${account.addons.length !== 1 ? 's' : ''}${protectedCount > 0 ? `, ${protectedCount} protected` : ''}`} side="top">
                    <span className="inline-flex h-6 items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">{account.addons.length}</span> addons
                        {protectedCount > 0 && (
                            <>
                                <span className="text-border">/</span>
                                <ShieldCheck className="h-3 w-3 shrink-0 text-success/80" />
                                <span className="font-semibold text-foreground">{protectedCount}</span>
                            </>
                        )}
                    </span>
                </Tooltip>
                {updateCount > 0 && (
                    <Tooltip content={`${updateCount} update${updateCount !== 1 ? 's' : ''} available`} side="top">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/12 border border-primary/25 text-xs font-semibold text-primary">
                            <ArrowUpCircle className="w-3 h-3" />
                            {updateCount}
                        </span>
                    </Tooltip>
                )}

                {recentChanges > 0 && updateCount === 0 && (
                    <Tooltip content={`${recentChanges} change${recentChanges !== 1 ? 's' : ''} today · Click to dismiss`} side="top">
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                useAccountStore.getState().clearChangelog(account.id)
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/12 border border-primary/25 text-xs font-semibold text-primary cursor-pointer hover:bg-primary/20 transition-colors"
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                            {recentChanges}
                        </button>
                    </Tooltip>
                )}

                {activeRules.length > 0 && (
                    failedOverRules.length > 0 ? (
                        <Tooltip content={`${failedOverRules.length} rule${failedOverRules.length !== 1 ? 's' : ''} failed over`} side="top">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/10 border border-warning/25 text-xs font-semibold text-warning">
                                <AlertTriangle className="w-3 h-3" />
                                {failedOverRules.length}
                            </span>
                        </Tooltip>
                    ) : (
                        <Tooltip content={`${activeRules.length} Autopilot rule${activeRules.length !== 1 ? 's' : ''} healthy`} side="top">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 border border-success/25 text-xs font-semibold text-success">
                                <ShieldCheck className="w-3 h-3" />
                                {activeRules.length}
                            </span>
                        </Tooltip>
                    )
                )}

                {account.note && (
                    <Tooltip content={`Note: ${account.note.slice(0, 60)}${account.note.length > 60 ? '…' : ''}`} side="top">
                        <StickyNote className="w-3.5 h-3.5 text-primary" />
                    </Tooltip>
                )}
            </div>


            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                <Tooltip content="Sync" side="top">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="hidden h-8 w-8 rounded-full text-muted-foreground hover:bg-muted/45 hover:text-foreground sm:inline-flex"
                        onClick={async (e) => {
                            e.stopPropagation()
                            try {
                                toast({ title: 'Syncing...', description: `Refreshing ${displayName}` })
                                await syncAccount(account.id)
                                toast({ title: 'Sync Complete', description: `Successfully synced ${displayName}` })
                            } catch {
                                toast({ variant: 'destructive', title: 'Sync Failed', description: `Could not sync ${displayName}` })
                            }
                        }}
                        disabled={loading}
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                </Tooltip>
                <Tooltip content="Edit" side="top">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="hidden h-8 w-8 rounded-full text-muted-foreground hover:bg-muted/45 hover:text-foreground sm:inline-flex"
                        onClick={(e) => {
                            e.stopPropagation()
                            openAddAccountDialog(account)
                        }}
                    >
                        <Pencil className="h-3.5 w-3.5" />
                    </Button>
                </Tooltip>
                <DropdownMenu onOpenChange={(open) => {
                    setIsMenuOpen(open)
                }}>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground hover:bg-muted/45 hover:text-foreground" onClick={(e) => e.stopPropagation()}>
                            <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52 max-w-[calc(100vw-2rem)] z-50">
                        <div className="px-2 py-1.5 text-xs font-medium uppercase text-muted-foreground">Manage Account</div>
                        {account.status === 'expired' && (
                            <DropdownMenuItem className="gap-2 text-warning focus:text-warning" onClick={(e) => { e.stopPropagation(); openAddAccountDialog(account); setIsMenuOpen(false) }}>
                                <AlertCircle className="h-4 w-4 shrink-0" /> Fix Session
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem className="gap-2 sm:hidden" onClick={(e) => { e.stopPropagation(); openAddAccountDialog(account); setIsMenuOpen(false) }}>
                            <Pencil className="h-4 w-4 shrink-0" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2 sm:hidden" onClick={async (e) => {
                            e.stopPropagation()
                            try {
                                toast({ title: 'Syncing...', description: `Refreshing ${displayName}` })
                                await syncAccount(account.id)
                                toast({ title: 'Sync Complete', description: `Successfully synced ${displayName}` })
                            } catch {
                                toast({ variant: 'destructive', title: 'Sync Failed', description: `Could not sync ${displayName}` })
                            }
                        }} disabled={loading}>
                            <RefreshCw className={`h-4 w-4 shrink-0 ${loading ? 'animate-spin' : ''}`} /> Sync
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2" onClick={async (e) => {
                            e.stopPropagation()
                            try {
                                toast({ title: 'Repairing...', description: `Deep refreshing ${displayName}` })
                                await repairAccount(account.id)
                                toast({ title: 'Repair Complete', description: `${displayName} is now healthy` })
                            } catch {
                                toast({ variant: 'destructive', title: 'Repair Failed', description: `Failed to repair ${displayName}` })
                            }
                        }} disabled={loading}>
                            <RefreshCw className="h-4 w-4 shrink-0 text-warning" /> Repair
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2" onClick={async (e) => {
                            e.stopPropagation()
                            if (!hasPlatformConnection(account)) return
                            try {
                                toast({ title: 'Refreshing...', description: `Reinstalling all addons on ${displayName}` })
                                const { useAddonStore } = await import('@/store/addonStore')
                                await useAddonStore.getState().bulkReinstallAllOnAccount(account.id, getStremioAuthKey(account))
                                toast({ title: 'Refresh Complete', description: `All addons on ${displayName} reinstalled` })
                            } catch {
                                toast({ variant: 'destructive', title: 'Refresh Failed', description: `Could not reinstall addons on ${displayName}` })
                            }
                        }} disabled={loading}>
                            <RotateCw className="h-4 w-4 shrink-0 text-primary" /> Refresh Addons
                        </DropdownMenuItem>
                        {onDelete && (
                            <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(account.id) }}>
                                <Trash className="h-4 w-4 shrink-0" /> Delete
                            </DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground sm:block" />
        </div>

        </>
    )
})
