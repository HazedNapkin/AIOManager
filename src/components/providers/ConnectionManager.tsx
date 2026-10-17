import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/ui/status-chip'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToolbarShell } from '@/components/ui/toolbar-shell'
import { EmptyState } from '@/components/common/EmptyState'
import { ProviderSetupDialog } from '@/components/providers/ProviderSetupDialog'
import { NuvioSetupDialog, type NuvioBackend } from '@/components/providers/NuvioSetupDialog'
import { RealStreamSetupDialog, type RealStreamTokens } from '@/components/providers/RealStreamSetupDialog'
import { ApiKeyManager } from '@/components/providers/ApiKeyManager'
import { useConnectionStore } from '@/store/connectionStore'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { getAccountEmail, getAccountById, getStremioAuthKey, getCachedAuthKey, useAccountStore } from '@/store/accountStore'
import { maskEmailLevel } from '@/lib/utils'
import { parsePremiumExpire, type PremiumStatus } from '@/lib/stremio-premium'
import { parseNuvioMemberAccess, type NuvioMemberStatus } from '@/lib/nuvio-tier'
import { trace } from '@/lib/trace'
import { toast } from '@/hooks/use-toast'
import { useShallow } from 'zustand/react/shallow'
import type { Connection } from '@/types/connection'
import type { Account } from '@/types/account'
import type { HydraDriverConfig } from '@/types/provider'
import { RefreshCw, Plus, Zap, Link2, Key, ChevronRight } from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import { PLATFORM_REGISTRY } from '@/lib/platform-registry'
import type { HydraSubscriber } from '@/api/hydra-providers'
import { stremioClient } from '@/api/stremio-client'
import { PlatformLogo } from './ConnectionPrimitives'
import { ConnectionCard } from './ConnectionCard'
import { ConnectionEditPanel } from './ConnectionEditPanel'
import { StremioSupportersBadge, NuvioTierBadge } from './ConnectionMembershipTab'
import { SubscriberCard } from './SubscriberCard'

interface ConnectionManagerProps {
    accountId: string
    account?: Account
    connections?: Connection[]
    onSubDialogChange?: (open: boolean) => void
}

export function ConnectionManager({ accountId, account, connections = [], onSubDialogChange }: ConnectionManagerProps) {
    const { syncConnections, isSyncing, connectionStates, addConnection, refreshConnectionStates } = useConnectionStore(
        useShallow(s => ({
            syncConnections: s.syncConnections,
            isSyncing: s.isSyncing,
            connectionStates: s.connectionStates,
            addConnection: s.addConnection,
            refreshConnectionStates: s.refreshConnectionStates,
        }))
    )
    const [addDialogOpen, setAddDialogOpen] = useState(false)
    const [showAdvanced, setShowAdvanced] = useState(false)
    const [hydraDialogOpen, setHydraDialogOpen] = useState(false)
    const [nuvioDialogOpen, setNuvioDialogOpen] = useState(false)
    const [realstreamDialogOpen, setRealstreamDialogOpen] = useState(false)
    const [subscribers, setSubscribers] = useState<HydraSubscriber[]>([])
    const [editingId, setEditingId] = useState<string | null>(null)
    const [subTab, setSubTab] = useState('connections')
    const [premiumByAccount, setPremiumByAccount] = useState<Map<string, PremiumStatus>>(new Map())
    const [nuvioMemberByConnection, setNuvioMemberByConnection] = useState<Map<string, NuvioMemberStatus>>(new Map())
    const premiumFetchedAccounts = useRef(new Set<string>())
    const nuvioMemberFetchedConnections = useRef(new Set<string>())
    const accountStates = connectionStates[accountId] || {}
    const isPrivacyModeEnabled = useUIStore(s => s.isPrivacyModeEnabled)
    const privacyLevelEmail = useUIStore(s => s.privacyLevelEmail)
    const emailPrivacyLevel = isPrivacyModeEnabled ? privacyLevelEmail : 0
    const storeAccount = useAccountStore(s => getAccountById(s.accounts, accountId))
    const statusAccount = account ?? storeAccount
    const encryptionKeyFromStore = useAuthStore(s => s.encryptionKey)

    // Pull live connection status (last sync, errors, expiry-driven state) so the cards can show it
    // without waiting for the next manual sync. Best-effort; the store swallows failures.
    useEffect(() => {
        refreshConnectionStates(accountId)
    }, [accountId, refreshConnectionStates])

    useEffect(() => {
        let cancelled = false
        import('@/api/hydra-providers')
            .then(({ fetchSubscribers }) => fetchSubscribers(accountId))
            .then(subs => { if (!cancelled) setSubscribers(subs) })
            .catch(() => { })
        return () => { cancelled = true }
    }, [accountId])

    useEffect(() => {
        if (!statusAccount) return
        const stremioKey = getStremioAuthKey(statusAccount)
        if (!stremioKey) {
            trace('connections', 'premium.skip', { accountId, reason: 'no-stremio-key' })
            return
        }
        if (premiumFetchedAccounts.current.has(accountId)) return
        const { encryptionKey } = useAuthStore.getState()
        if (!encryptionKey) {
            trace('connections', 'premium.skip', { accountId, reason: 'locked' })
            return
        }
        let cancelled = false
        premiumFetchedAccounts.current.add(accountId)
        ;(async () => {
            const authKey = await getCachedAuthKey(stremioKey, encryptionKey)
            const user = await stremioClient.getUser(authKey)
            const status = parsePremiumExpire((user as Record<string, unknown>).premium_expire)
            trace('connections', 'premium.result', { accountId, active: status.active, lifetime: status.lifetime, expiresAt: status.expiresAt, cancelled })
            // Write unconditionally: a cancelled-effect skip would strand the result behind the dedupe marker.
            setPremiumByAccount(prev => new Map(prev).set(accountId, status))
        })().catch(err => {
            // A failed fetch must not latch: release the dedupe marker so the next mount retries.
            premiumFetchedAccounts.current.delete(accountId)
            trace('connections', 'premium.error', { accountId, error: err instanceof Error ? err.message : String(err) })
        })
        return () => { cancelled = true }
    }, [accountId, statusAccount, encryptionKeyFromStore])

    useEffect(() => {
        if (!statusAccount) return
        const nuvioConns = connections.filter(c => c.enabled && c.platform === 'nuvio')
        if (nuvioConns.length === 0) return
        let cancelled = false
        ;(async () => {
            const [{ fetchConnectionToken }, { nuvioDriverFor }, { getCachedNuvioToken, setCachedNuvioToken }] = await Promise.all([
                import('@/api/connection'),
                import('@/lib/drivers/factory'),
                import('@/lib/nuvio-token-cache'),
            ])
            for (const conn of nuvioConns) {
                if (nuvioMemberFetchedConnections.current.has(conn.id)) continue
                nuvioMemberFetchedConnections.current.add(conn.id)
                try {
                    let token = getCachedNuvioToken(conn.id)
                    if (!token) {
                        token = await fetchConnectionToken(accountId, conn.id, 'nuvio')
                        setCachedNuvioToken(conn.id, token)
                    }
                    const rows = await nuvioDriverFor(conn).getMemberAccess(token.accessToken)
                    const status = parseNuvioMemberAccess(rows)
                    trace('connections', 'nuvioMember.result', { connectionId: conn.id, supporter: status.supporter, label: status.label, cancelled })
                    // Written unconditionally (like the premium effect): deps churn cancels the
                    // effect mid-fetch, but the result is still the freshest data for this connection.
                    setNuvioMemberByConnection(prev => new Map(prev).set(conn.id, status))
                } catch (err) {
                    // A failed fetch must not latch: release the dedupe marker so the next mount retries.
                    nuvioMemberFetchedConnections.current.delete(conn.id)
                    trace('connections', 'nuvioMember.error', { connectionId: conn.id, error: err instanceof Error ? err.message : String(err) })
                }
            }
        })().catch(() => { })
        return () => { cancelled = true }
    }, [accountId, statusAccount, connections])

    const handleRemoveSubscriber = useCallback(async (name: string) => {
        let snapshot: HydraSubscriber[] = []
        setSubscribers(prev => { snapshot = prev; return prev.filter(s => s.name !== name) })
        try {
            const { deleteSubscriber } = await import('@/api/hydra-providers')
            await deleteSubscriber(accountId, name)
        } catch (err) {
            setSubscribers(snapshot)
            toast({ title: 'Could not remove app', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' })
        }
    }, [accountId])

    const notifySubDialog = (open: boolean) => onSubDialogChange?.(open)

    const resolvedConnections = connections
    const activeCount = resolvedConnections.filter(c => (accountStates[c.id]?.status || c.status) === 'active').length

    const handleSync = async () => {
        await syncConnections(accountId)
    }

    const handleAddNative = (platform: string) => {
        addConnection(accountId, {
            platform,
            connectionType: 'native',
            enabled: true,
            status: 'error',
            credentials: {},
            capabilities: platform === 'nuvio' ? ['addons', 'plugins', 'profiles'] : ['addons'],
        })
        setAddDialogOpen(false)
    }

    const handlePlatformClick = (platform: string) => {
        if (platform === 'nuvio') {
            setAddDialogOpen(false)
            notifySubDialog(true)
            setNuvioDialogOpen(true)
        } else if (platform === 'realstream') {
            setAddDialogOpen(false)
            notifySubDialog(true)
            setRealstreamDialogOpen(true)
        } else {
            handleAddNative(platform)
        }
    }

    const handleHydraComplete = (config: HydraDriverConfig, credential: string) => {
        addConnection(accountId, {
            platform: config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            connectionType: 'hydra-outbound',
            enabled: true,
            status: 'active',
            credentials: { apiKey: credential },
            capabilities: ['addons'],
            driverConfig: config,
        })
    }

    const handleNuvioComplete = async (tokens: { accessToken: string; refreshToken: string; expiresAt: number }, profileId: string | null, _profiles: unknown[], _email: string, backend: NuvioBackend) => {
        const existing = resolvedConnections.find(c => c.platform === 'nuvio')
        const effBaseUrl = backend.baseUrl || existing?.credentials?.baseUrl || undefined
        const effPublishableKey = backend.publishableKey || existing?.credentials?.publishableKey || undefined
        const effBackendCreds: Record<string, string> = {
            ...(effBaseUrl ? { baseUrl: effBaseUrl } : {}),
            ...(effPublishableKey ? { publishableKey: effPublishableKey } : {}),
        }
        if (existing) {
            const { updateConnection } = useConnectionStore.getState()
            updateConnection(accountId, existing.id, {
                credentials: {
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    expiresAt: String(tokens.expiresAt),
                    profileId: profileId || '',
                    ...effBackendCreds,
                },
                status: 'active',
            })
            const { storeConnectionCredential } = await import('@/api/hydra-providers')
            storeConnectionCredential(accountId, existing.id, {
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                expiresAt: tokens.expiresAt,
                profileId: profileId || null,
                baseUrl: effBaseUrl || null,
                publishableKey: effPublishableKey || null,
            }, 'nuvio').catch((err) => {
                toast({ title: 'Saved locally, but the server did not store the new session', description: err instanceof Error ? err.message : 'Background sync and failover may keep using the expired session until you reconnect again.', variant: 'destructive' })
            })
            syncConnections(accountId).catch((err) => {
                toast({ title: 'Reconnected, but the sync did not finish', description: err instanceof Error ? err.message : 'Your addons may not have pushed yet.', variant: 'destructive' })
            })
        } else {
            addConnection(accountId, {
                platform: 'nuvio',
                connectionType: 'native',
                enabled: true,
                status: 'active',
                credentials: {
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    expiresAt: String(tokens.expiresAt),
                    profileId: profileId || '',
                    ...effBackendCreds,
                },
                capabilities: ['addons', 'plugins', 'profiles'],
            })
        }
    }

    const handleRealStreamComplete = async (tokens: RealStreamTokens, email: string, password: string) => {
        const credentials = {
            accessToken: tokens.accessToken,
            userId: tokens.userId || '',
            expiresAt: String(tokens.expiresAt),
            // Stored E2E-encrypted so the server can silently re-authenticate if the token expires.
            email,
            password,
        }
        const existing = resolvedConnections.find(c => c.platform === 'realstream')
        if (existing) {
            const { updateConnection } = useConnectionStore.getState()
            updateConnection(accountId, existing.id, { credentials, status: 'active' })
            const { storeConnectionCredential } = await import('@/api/hydra-providers')
            storeConnectionCredential(accountId, existing.id, {
                accessToken: tokens.accessToken,
                userId: tokens.userId || null,
                expiresAt: tokens.expiresAt,
                baseUrl: existing.credentials?.baseUrl || null,
                email,
                password,
            }, 'realstream').catch((err) => {
                toast({ title: 'Saved locally, but the server did not store the new session', description: err instanceof Error ? err.message : 'Background sync and failover may keep using the expired session until you reconnect again.', variant: 'destructive' })
            })
            syncConnections(accountId).catch((err) => {
                toast({ title: 'Reconnected, but the sync did not finish', description: err instanceof Error ? err.message : 'Your addons may not have pushed yet.', variant: 'destructive' })
            })
        } else {
            addConnection(accountId, {
                platform: 'realstream',
                connectionType: 'native',
                enabled: true,
                status: 'active',
                credentials,
                capabilities: ['addons'],
            })
        }
    }

    const renderSetupDialogs = () => (
        <>
            <ProviderSetupDialog
                open={hydraDialogOpen}
                onOpenChange={(open) => { setHydraDialogOpen(open); notifySubDialog(open) }}
                onComplete={handleHydraComplete}
            />
            <NuvioSetupDialog
                open={nuvioDialogOpen}
                onOpenChange={(open) => { setNuvioDialogOpen(open); notifySubDialog(open) }}
                onComplete={handleNuvioComplete}
                initialBackend={(() => {
                    const existing = resolvedConnections.find(c => c.platform === 'nuvio')
                    return existing ? { baseUrl: existing.credentials?.baseUrl, publishableKey: existing.credentials?.publishableKey } : undefined
                })()}
            />
            <RealStreamSetupDialog
                open={realstreamDialogOpen}
                onOpenChange={(open) => { setRealstreamDialogOpen(open); notifySubDialog(open) }}
                onComplete={handleRealStreamComplete}
            />
        </>
    )

    const editing = editingId ? resolvedConnections.find(c => c.id === editingId) : null
    const hasAny = resolvedConnections.length > 0 || subscribers.length > 0
    const hasApiKeyTab = !!account?.apiKey

    const connectionsList = (
        <div className="space-y-4">
            <ToolbarShell>
                <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                    <StatusChip size="md" className="rounded-lg bg-muted/30">
                        <Zap className="h-3.5 w-3.5" />
                        {activeCount}/{resolvedConnections.length} active{subscribers.length > 0 ? ` · ${subscribers.length} app${subscribers.length === 1 ? '' : 's'}` : ''}
                    </StatusChip>
                </div>

                <div className="flex flex-wrap gap-1.5 sm:ml-auto items-center">
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 h-8 text-xs font-medium"
                        onClick={handleSync}
                        disabled={!!isSyncing}
                    >
                        <RefreshCw className={cn('h-3.5 w-3.5', isSyncing && 'animate-spin')} />
                        {isSyncing ? 'Syncing...' : 'Sync'}
                    </Button>
                    <Button
                        size="sm"
                        className="gap-1.5 h-8 text-xs font-medium"
                        onClick={() => { notifySubDialog(true); setAddDialogOpen(true) }}
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Add Connection
                    </Button>
                </div>
            </ToolbarShell>

            {!hasAny ? (
                <EmptyState
                    icon={<Zap className="h-6 w-6" />}
                    title="No platform connections"
                    description="Add a connection to manage addons across platforms."
                    action={
                        <Button size="sm" className="gap-1.5" onClick={() => { notifySubDialog(true); setAddDialogOpen(true) }}>
                            <Plus className="h-3.5 w-3.5" />
                            Add Connection
                        </Button>
                    }
                />
            ) : (
                <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Connections</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {resolvedConnections.map(conn => {
                            const state = accountStates[conn.id]
                            const needsSignIn = conn.platform === 'stremio' && !conn.credentials?.authKey
                            const connEmail = conn.credentials?.email || (conn.platform === 'stremio' && account ? getAccountEmail(account) : undefined)
                            const maskedConnEmail = connEmail ? maskEmailLevel(connEmail, emailPrivacyLevel) : undefined
                            const premium = conn.platform === 'stremio' ? premiumByAccount.get(accountId) : undefined
                            const nuvioMember = conn.platform === 'nuvio' ? nuvioMemberByConnection.get(conn.id) : undefined
                            return (
                                <ConnectionCard
                                    key={conn.id}
                                    connection={conn}
                                    status={needsSignIn ? 'pending' : (state?.status || conn.status)}
                                    lastSync={state?.lastSync || conn.lastSync}
                                    lastError={state?.lastError}
                                    syncing={isSyncing === accountId}
                                    onEdit={() => setEditingId(conn.id)}
                                    onToggle={() => useConnectionStore.getState().toggleConnection(accountId, conn.id)}
                                    email={maskedConnEmail}
                                    badge={
                                        needsSignIn ? (
                                            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-warning">Needs sign-in</span>
                                        ) : nuvioMember || premium !== undefined ? (
                                            <>
                                                {premium?.active && <StremioSupportersBadge />}
                                                {premium && !premium.active && (
                                                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                                        Free
                                                    </span>
                                                )}
                                                {nuvioMember && <NuvioTierBadge member={nuvioMember} />}
                                            </>
                                        ) : undefined
                                    }
                                />
                            )
                        })}
                        {subscribers.map(sub => (
                            <SubscriberCard key={sub.name} subscriber={sub} onRemove={handleRemoveSubscriber} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    )

    return (
        <>
            {editing ? (
                <ConnectionEditPanel
                    accountId={accountId}
                    connection={editing}
                    status={accountStates[editing.id]?.status || editing.status}
                    premium={editing.platform === 'stremio' ? premiumByAccount.get(accountId) : undefined}
                    nuvioMember={editing.platform === 'nuvio' ? nuvioMemberByConnection.get(editing.id) : undefined}
                    onBack={() => setEditingId(null)}
                />
            ) : hasApiKeyTab ? (
                <Tabs value={subTab} onValueChange={setSubTab} className="space-y-4">
                    <TabsList>
                        <TabsTrigger value="connections"><Link2 className="h-3.5 w-3.5" />Connections</TabsTrigger>
                        <TabsTrigger value="apikey"><Key className="h-3.5 w-3.5" />API Key</TabsTrigger>
                    </TabsList>
                    <TabsContent value="connections">{connectionsList}</TabsContent>
                    <TabsContent value="apikey">{account && <ApiKeyManager account={account} />}</TabsContent>
                </Tabs>
            ) : (
                connectionsList
            )}

            <Dialog open={addDialogOpen} onOpenChange={(open) => { setAddDialogOpen(open); notifySubDialog(open); if (!open) setShowAdvanced(false) }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add Connection</DialogTitle>
                        <DialogDescription>Connect a platform to manage its addons from AIOManager.</DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                        {PLATFORM_REGISTRY
                            .filter(p => p.available)
                            .filter(p => p.connectionType !== 'hydra-outbound')
                            .map(p => {
                                const isAlreadyConnected = p.connectionType === 'native' && resolvedConnections.some(c => c.platform === p.id)
                                return { platform: p, isAlreadyConnected }
                            })
                            .map(({ platform: p, isAlreadyConnected }) => (
                                <button
                                    key={p.id}
                                    disabled={isAlreadyConnected}
                                    className={`group/card flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-4 text-left shadow-sm transition-[background-color,border-color,box-shadow,transform] duration-200 ${isAlreadyConnected ? 'opacity-50 cursor-not-allowed' : 'hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card/95 hover:shadow-md'}`}
                                    onClick={() => !isAlreadyConnected && handlePlatformClick(p.id)}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted/60 ring-1 ring-border/40 transition-colors group-hover/card:bg-background">
                                            <PlatformLogo platform={p.id} className="h-9 w-9" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-semibold">{p.name}</p>
                                                {isAlreadyConnected && (
                                                    <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-success">Connected</span>
                                                )}
                                            </div>
                                            <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>
                                        </div>
                                    </div>
                                    {!isAlreadyConnected && (
                                        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                                            Connect
                                            <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover/card:translate-x-0.5" />
                                        </span>
                                    )}
                                </button>
                            ))}

                        <div className="rounded-2xl border border-border/30 bg-muted/20 p-4 text-xs text-muted-foreground">
                            <p className="font-medium text-foreground">Apps connect to you automatically</p>
                            <p className="mt-1 leading-relaxed">Backendless apps (e.g. Fusion) pull your addons using your AIOManager URL + account API key, so there's no setup here. They appear in your <span className="font-medium text-foreground">connections list</span> once they sync. Find your API key on the API Key tab.</p>
                            <button
                                type="button"
                                onClick={() => setShowAdvanced(s => !s)}
                                className="mt-3 inline-flex items-center gap-1 rounded-md font-medium text-foreground transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', showAdvanced && 'rotate-90')} />
                                Advanced: push to another server
                            </button>
                            {showAdvanced && (
                                <button
                                    className="mt-2 flex w-full items-center gap-3 rounded-xl border border-border/40 bg-card p-3 text-left transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border/70 hover:bg-card/95 hover:shadow-md"
                                    onClick={() => { setAddDialogOpen(false); notifySubDialog(true); setHydraDialogOpen(true) }}
                                >
                                    <PlatformLogo platform="hydra-outbound" className="h-9 w-9 shrink-0" isHydra />
                                    <div>
                                        <p className="text-sm font-semibold text-foreground">Hydra (outbound)</p>
                                        <p className="text-xs text-muted-foreground">Push to a Hydra-compatible server.</p>
                                    </div>
                                </button>
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {renderSetupDialogs()}
        </>
    )
}
