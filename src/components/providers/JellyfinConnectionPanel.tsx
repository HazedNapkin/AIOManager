import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Import, Power, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/ui/status-chip'
import { ToolbarShell } from '@/components/ui/toolbar-shell'
import { useConnectionStore } from '@/store/connectionStore'
import { useAuthStore } from '@/store/authStore'
import { decrypt } from '@/lib/crypto'
import { JellyfinClient, jellyfinSignInErrorMessage, validateJellyfinReconnect } from '@/lib/jellyfin/session'
import { JellyfinError } from '@/lib/jellyfin/client'
import { openJellyfinSecret } from '@/lib/jellyfin/connection-data'
import { displayStatus, timeAgo, tokenExpiry } from '@/lib/connection-format'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import type { Connection } from '@/types/connection'
import { PlatformLogo, ConnectionStatusPill, ConnectionTestButton, ConnectionTestResult, connectionLabel, type ConnectionTestOutcome } from './ConnectionPrimitives'

const WatchMigrationDialog = lazy(() => import('./WatchMigrationDialog').then(module => ({ default: module.WatchMigrationDialog })))

function HeaderStat({ label, value, isError, title }: { label: string; value: string; isError?: boolean; title?: string }) {
    return (
        <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
            <p title={title} className={cn('mt-0.5 truncate text-xs font-medium', isError ? 'text-destructive' : 'text-foreground/80')}>{value}</p>
        </div>
    )
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className={cn('mt-0.5 text-xs font-medium text-foreground/80', mono ? 'break-all font-mono' : 'break-words')}>{value}</dd>
        </div>
    )
}

export function JellyfinConnectionPanel({ accountId, connection, onBack, onReconnect }: {
    accountId: string; connection: Connection; onBack: () => void; onReconnect: () => void
}) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [testResult, setTestResult] = useState<ConnectionTestOutcome | null>(null)
    const [confirmRemove, setConfirmRemove] = useState(false)
    const [migrationOpen, setMigrationOpen] = useState(false)
    const request = useRef<AbortController | null>(null)
    const encryptionKey = useAuthStore(state => state.encryptionKey)

    useEffect(() => {
        return () => { request.current?.abort() }
    }, [connection.id, connection.credentials?.jellyfin, connection.enabled, encryptionKey])

    const check = async () => {
        if (request.current) return
        const controller = new AbortController()
        request.current = controller
        setBusy(true)
        setError('')
        setTestResult(null)
        try {
            if (!encryptionKey) throw new Error('Unlock your vault first')
            const secret = await openJellyfinSecret(connection, value => decrypt(value, encryptionKey))
            const result = await new JellyfinClient(secret.baseUrl, secret.deviceId).signIn({ ...secret, method: 'token' }, controller.signal)
            controller.signal.throwIfAborted()
            validateJellyfinReconnect(connection, result, secret)
            await useConnectionStore.getState().updateConnection(accountId, connection.id, {
                mediaServer: { ...result.identity, serverId: result.identity.serverId || connection.mediaServer?.serverId, authMethod: connection.mediaServer?.authMethod || 'token' },
                status: 'active', lastError: undefined, lastErrorAt: undefined, consecutiveFailures: 0,
            })
            setTestResult({ ok: true, message: 'Connection healthy' })
            toast({ title: 'Connection healthy' })
        } catch (err) {
            if (!controller.signal.aborted) {
                const message = jellyfinSignInErrorMessage(err, { method: 'token', userId: connection.mediaServer?.userId })
                setError(message)
                setTestResult({ ok: false, message })
                toast({ title: 'Connection test failed', description: message, variant: 'destructive' })
                await useConnectionStore.getState().updateConnection(accountId, connection.id, {
                    status: err instanceof JellyfinError && err.kind === 'auth' ? 'expired' : 'error',
                    lastError: message, lastErrorAt: Date.now(),
                }).catch(() => {})
            }
        } finally {
            if (request.current === controller) request.current = null
            setBusy(false)
        }
    }

    const mutate = async (action: () => Promise<void>) => {
        setBusy(true)
        setError('')
        setTestResult(null)
        try { await action() }
        catch { setError('Could not save this change. Try again.') }
        finally { setBusy(false) }
    }

    const identity = connection.mediaServer
    const name = connectionLabel(connection)
    const display = displayStatus(connection.status, tokenExpiry(connection))
    const connectionError = error || connection.lastError
    // The product name already leads the header; only surface the server's own name when it says something new.
    const serverName = identity?.serverName?.trim()
    const distinctServerName = serverName && serverName !== name && serverName !== identity?.productName ? serverName : ''

    return <div className="space-y-4">
        <ToolbarShell className="w-fit max-w-full p-2" contentClassName="gap-2">
            <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 rounded-xl border border-border/40 bg-card px-2.5 text-xs font-medium text-muted-foreground shadow-sm hover:bg-muted/50 hover:text-foreground" onClick={onBack}>
                <ArrowLeft className="h-4 w-4" />
                Connections
            </Button>
        </ToolbarShell>
        <div data-theme-part="panel" className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
            <div className="flex items-center gap-3">
                <PlatformLogo platform={connection.platform} className="h-12 w-12 shrink-0" />
                <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold truncate">{name}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <ConnectionStatusPill status={display} />
                        {!connection.enabled && <StatusChip size="sm" className="h-5 px-2 text-xs bg-muted/40">Paused</StatusChip>}
                        {distinctServerName && <StatusChip size="sm" className="h-5 max-w-full truncate px-2 text-xs bg-muted/40" title={distinctServerName}>{distinctServerName}</StatusChip>}
                    </div>
                </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/30 pt-3 sm:grid-cols-3">
                <HeaderStat label="Remote user" value={identity?.userName || 'Sign-in required'} title={identity?.userName} />
                <HeaderStat label="Last verified" value={identity?.lastCheckedAt ? timeAgo(identity.lastCheckedAt) : 'Never'} title={identity?.lastCheckedAt ? new Date(identity.lastCheckedAt).toLocaleString() : undefined} />
                <HeaderStat label="Last error" value={connection.lastError || 'None'} title={connection.lastError} isError={!!connection.lastError} />
            </div>
        </div>

        <div className="space-y-4">
                <div data-theme-part="panel" className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold">Connection health</p>
                            <p className="text-xs text-muted-foreground">Verify this server is reachable and your saved sign-in still works.</p>
                        </div>
                        <ConnectionTestButton testing={busy && !!request.current} disabled={busy || !connection.enabled || !encryptionKey || !connection.credentials?.jellyfin} onClick={() => void check()} />
                    </div>
                    <ConnectionTestResult result={testResult ?? (!busy && connectionError ? { ok: false, message: connectionError } : null)} />
                </div>

                <div data-theme-part="panel" className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm space-y-3">
                    <div className="min-w-0">
                        <p className="text-sm font-semibold">Server details</p>
                        <p className="text-xs text-muted-foreground">The identity recorded when this connection was last verified.</p>
                    </div>
                    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                        <DetailRow label="Product" value={identity?.productName || 'Not recorded yet'} />
                        {distinctServerName && <DetailRow label="Server name" value={distinctServerName} />}
                        <DetailRow label="Sign-in" value={identity?.authMethod === 'password' ? 'Username & password (token saved)' : identity?.authMethod === 'token' ? 'Saved token or API key' : 'Not recorded'} />
                        {identity?.version && <DetailRow label="API version" value={identity.version} />}
                        <DetailRow label="Server ID" value={identity?.serverId || 'Unavailable'} mono />
                        <DetailRow label="User ID" value={identity?.userId || 'Unavailable'} mono />
                    </dl>
                </div>

                <div data-theme-part="panel" className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm space-y-3">
                    <div className="min-w-0">
                        <p className="text-sm font-semibold">Maintenance</p>
                        <p className="text-xs text-muted-foreground">Reconnect signs in again from scratch; pausing keeps the connection but stops media reads.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" disabled={busy} onClick={onReconnect}>
                            <RefreshCw className="h-4 w-4" />
                            Reconnect
                        </Button>
                        <Button variant="outline" disabled={busy} onClick={() => void mutate(() => useConnectionStore.getState().toggleConnection(accountId, connection.id))}>
                            <Power className="h-4 w-4" />
                            {connection.enabled ? 'Disable' : 'Enable'}
                        </Button>
                    </div>
                </div>

                <div data-theme-part="panel" className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm space-y-3">
                    <div className="min-w-0">
                        <p className="text-sm font-semibold">Import watch state</p>
                        <p className="text-xs text-muted-foreground">Preview watched titles and resume points from another connection, then copy selected matches to this user.</p>
                    </div>
                    <Button variant="outline" disabled={busy || !connection.enabled || !encryptionKey || !connection.credentials?.jellyfin} onClick={() => setMigrationOpen(true)}><Import className="h-4 w-4" />Preview import…</Button>
                </div>

                <div data-theme-part="panel" className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm space-y-3">
                    <div className="min-w-0">
                        <p className="text-sm font-semibold">Remove connection</p>
                        <p className="text-xs leading-relaxed text-muted-foreground">Removes this saved connection from AIOManager. This does not revoke the token on your media server.</p>
                    </div>
                    <div className="flex items-center justify-end gap-1.5">
                        {confirmRemove ? (
                            <div role="group" aria-label="Confirm media connection removal" className="flex items-center gap-1.5">
                                <Button size="sm" variant="subtle" className="h-8 text-xs" disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</Button>
                                <Button size="sm" variant="destructive" className="h-8 gap-1.5 text-xs" disabled={busy} onClick={() => void mutate(async () => { await useConnectionStore.getState().removeConnection(accountId, connection.id); onBack() })}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Remove connection
                                </Button>
                            </div>
                        ) : (
                            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive" disabled={busy} onClick={() => setConfirmRemove(true)}>
                                <Trash2 className="h-3.5 w-3.5" />
                                Remove connection…
                            </Button>
                        )}
                    </div>
                </div>
        </div>
        {migrationOpen && <Suspense fallback={null}><WatchMigrationDialog open={migrationOpen} onOpenChange={setMigrationOpen} accountId={accountId} connection={connection} /></Suspense>}
    </div>
}
