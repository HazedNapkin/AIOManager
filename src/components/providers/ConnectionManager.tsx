import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/ui/status-chip'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { TabsContent, TabsTrigger } from '@/components/ui/tabs'
import { WorkspaceTabs } from '@/components/ui/workspace-tabs'
import { Tooltip } from '@/components/ui/tooltip'
import { EmptyState } from '@/components/common/EmptyState'
import { ProviderSetupDialog } from '@/components/providers/ProviderSetupDialog'
import { NuvioSetupDialog, type NuvioBackend } from '@/components/providers/NuvioSetupDialog'
import { RealStreamSetupDialog, type RealStreamTokens } from '@/components/providers/RealStreamSetupDialog'
import { JellyfinSetupDialog } from './JellyfinSetupDialog'
import { StremioSetupDialog, type StremioSignIn } from './StremioSetupDialog'
import { HouseholdSetupDialog } from './HouseholdSetupDialog'
import { WatchMigrationPicker } from './WatchMigrationPicker'
import { isAIOStreamsAddon } from '@/lib/aiostreams-utils'
import { JellyfinConnectionPanel } from './JellyfinConnectionPanel'
import { validateJellyfinReconnect, type JellyfinSession } from '@/lib/jellyfin/session'
import { openJellyfinSecret, sealJellyfinSecret } from '@/lib/jellyfin/connection-data'
import { decrypt, encrypt } from '@/lib/crypto'
import { ApiKeyManager } from '@/components/providers/ApiKeyManager'
import { useConnectionStore } from '@/store/connectionStore'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { getAccountEmail, getAccountById, getStremioAuthKey, getStremioConnection, getCachedAuthKey, useAccountStore } from '@/store/accountStore'
import { maskEmailLevel, maskNameLevel } from '@/lib/utils'
import { parsePremiumExpire, type PremiumStatus } from '@/lib/stremio-premium'
import { parseNuvioMemberAccess, type NuvioMemberStatus } from '@/lib/nuvio-tier'
import { trace } from '@/lib/trace'
import { toast } from '@/hooks/use-toast'
import { useShallow } from 'zustand/react/shallow'
import { isAddonConnection, type Connection } from '@/types/connection'
import type { Account } from '@/types/account'
import type { HydraDriverConfig } from '@/types/provider'
import { RefreshCw, Plus, Zap, Link2, Key, ChevronRight, Users, History } from 'lucide-react'
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
    const [hydraDialogOpen, setHydraDialogOpen] = useState(false)
    const [nuvioDialogOpen, setNuvioDialogOpen] = useState(false)
    const [realstreamDialogOpen, setRealstreamDialogOpen] = useState(false)
    const [jellyfinDialogOpen, setJellyfinDialogOpen] = useState(false)
    const [stremioDialogOpen, setStremioDialogOpen] = useState(false)
    const [personSaving, setPersonSaving] = useState(false)
    const [jellyfinReconnectId, setJellyfinReconnectId] = useState<string | null>(null)
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
    const privacyLevelNames = useUIStore(s => s.privacyLevelNames)
    const emailPrivacyLevel = isPrivacyModeEnabled ? privacyLevelEmail : 0
    const namePrivacyLevel = isPrivacyModeEnabled ? privacyLevelNames : 0
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
                        token = await fetchConnectionToken(accountId, conn.id, 'nuvio', conn.credentials?.baseUrl)
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
    const activeCount = resolvedConnections.filter(c => {
        const state = accountStates[c.id]
        return (state ? state.status : c.status) === 'active'
    }).length

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
        if (platform === 'jellyfin') {
            setAddDialogOpen(false)
            setJellyfinReconnectId(null)
            setJellyfinDialogOpen(true)
            notifySubDialog(true)
        } else if (platform === 'stremio') {
            // Verified sign-in only: a placeholder "needs sign-in" Stremio connection can
            // no longer be created, and several Stremio logins may be bound to one account.
            setAddDialogOpen(false)
            notifySubDialog(true)
            setStremioDialogOpen(true)
        } else if (platform === 'nuvio') {
            setAddDialogOpen(false)
            notifySubDialog(true)
            setNuvioDialogOpen(true)
        } else if (platform === 'realstream') {
            setAddDialogOpen(false)
            notifySubDialog(true)
            setRealstreamDialogOpen(true)
        } else if (platform === 'hydra-outbound') {
            setAddDialogOpen(false)
            notifySubDialog(true)
            setHydraDialogOpen(true)
        } else {
            handleAddNative(platform)
        }
    }

    const handleJellyfinComplete = async (session: JellyfinSession) => {
        const key = useAuthStore.getState().encryptionKey
        if (!key) throw new Error('Unlock your vault before saving a connection')
        const existing = jellyfinReconnectId ? resolvedConnections.find(c => c.id === jellyfinReconnectId) : undefined
        if (jellyfinReconnectId && !existing) throw new Error('This connection was removed. Add a new connection instead.')
        if (existing) {
            const previous = existing.credentials?.jellyfin
                ? await openJellyfinSecret(existing, value => decrypt(value, key)).catch(() => undefined) : undefined
            validateJellyfinReconnect(existing, session, previous)
        }
        const credentials = await sealJellyfinSecret(session.secret, value => encrypt(value, key))
        if (useAuthStore.getState().encryptionKey !== key) throw new Error('Your vault changed while saving. Unlock it and try again.')
        const data = { credentials, mediaServer: { ...session.identity, serverId: session.identity.serverId || existing?.mediaServer?.serverId }, status: 'active' as const,
            displayName: session.identity.productName, lastError: undefined, lastErrorAt: undefined }
        if (existing) await useConnectionStore.getState().updateConnection(accountId, existing.id, data)
        else await addConnection(accountId, { ...data, platform: 'jellyfin', connectionType: 'native', enabled: true, capabilities: [] })
    }

    // Verified Stremio sign-in from StremioSetupDialog. Seals the key per connection;
    // a legacy account that still keeps its login only in account.authKey gets that
    // login materialized as the canonical connection FIRST so the existing session
    // stays primary and the new login binds as a true secondary.
    const handleStremioComplete = async (signIn: StremioSignIn) => {
        const key = useAuthStore.getState().encryptionKey
        if (!key) throw new Error('Unlock your vault before saving a connection')
        const account = useAccountStore.getState().accounts.find(a => a.id === accountId)
        if (!account) throw new Error('This account no longer exists. Reload and add the connection again.')
        const hasStoredStremio = (account.connections || []).some(c => c.platform === 'stremio')
        if (!hasStoredStremio && account.authKey && account.authKey.length > 60) {
            await addConnection(accountId, {
                platform: 'stremio',
                connectionType: 'native',
                enabled: true,
                status: 'active',
                credentials: { authKey: account.authKey, ...(account.email ? { email: account.email } : {}) },
                capabilities: ['addons'],
            })
            // Vault generation through the asynchronous materialization: re-check before
            // sealing the NEW login so a vault rotated mid-add never persists a stale-key blob.
            if (useAuthStore.getState().encryptionKey !== key) throw new Error('Your vault changed while saving. Unlock it and try again.')
        }
        const sealed = await encrypt(signIn.authKey, key)
        // Vault generation through the asynchronous claim: the sealed blob must land
        // under the SAME vault the dialog verified against, so re-check before the add.
        if (useAuthStore.getState().encryptionKey !== key) throw new Error('Your vault changed while saving. Unlock it and try again.')
        await addConnection(accountId, {
            platform: 'stremio',
            connectionType: 'native',
            enabled: true,
            status: 'active',
            credentials: {
                authKey: sealed,
                ...(signIn.email ? { email: signIn.email } : {}),
                // Verified remote identity: duplicate binding detection and per-connection
                // attribution key on the user Stremio actually authenticated, not the key blob.
                ...(signIn.userId ? { userId: signIn.userId } : {}),
            },
            capabilities: ['addons'],
        })
        useConnectionStore.getState().syncConnections(accountId).catch(() => {})
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

    // Adding is always additive: reconnecting an existing login is a per-connection
    // edit (ConnectionEditPanel), never a second sign-in that overwrites the first.
    const handleNuvioComplete = async (tokens: { accessToken: string; refreshToken: string; expiresAt: number }, profileId: string | null, _profiles: unknown[], email: string, backend: NuvioBackend) => {
        const effBackendCreds: Record<string, string> = {
            ...(backend.baseUrl ? { baseUrl: backend.baseUrl } : {}),
            ...(backend.publishableKey ? { publishableKey: backend.publishableKey } : {}),
        }
        await addConnection(accountId, {
            platform: 'nuvio',
            connectionType: 'native',
            enabled: true,
            status: 'active',
            credentials: {
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                expiresAt: String(tokens.expiresAt),
                profileId: profileId || '',
                // The sign-in email labels THIS login on its card — with several Nuvio
                // logins bound, exact edit/reconnect/remove must be human-identifiable.
                ...(email ? { email } : {}),
                ...effBackendCreds,
            },
            capabilities: ['addons', 'plugins', 'profiles'],
        })
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
        await addConnection(accountId, {
            platform: 'realstream',
            connectionType: 'native',
            enabled: true,
            status: 'active',
            credentials,
            capabilities: ['addons'],
        })
    }

    const renderSetupDialogs = () => (
        <>
            {jellyfinDialogOpen && <JellyfinSetupDialog
                open={jellyfinDialogOpen}
                reconnectCredentials={jellyfinReconnectId ? resolvedConnections.find(c => c.id === jellyfinReconnectId)?.credentials?.jellyfin : undefined}
                onOpenChange={open => { setJellyfinDialogOpen(open); notifySubDialog(open); if (!open) setJellyfinReconnectId(null) }}
                onComplete={handleJellyfinComplete}
            />}
            {stremioDialogOpen && <StremioSetupDialog
                accountId={accountId}
                open={stremioDialogOpen}
                onOpenChange={open => { setStremioDialogOpen(open); notifySubDialog(open) }}
                onComplete={handleStremioComplete}
            />}
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
    const hasApiKeyTab = !!statusAccount?.apiKey
    // Media-server connections never take addon pushes (isAddonConnection excludes jellyfin),
    // so a media-only or fully paused account has nothing to sync. Explain the disabled Sync
    // instead of leaving it silent.
    const syncBlockedReason = resolvedConnections.some(c => c.enabled && isAddonConnection(c))
        ? ''
        : 'Nothing to sync yet — enable an addon connection such as Stremio or Nuvio'

    const connectionActions = <>
                    <Tooltip content={syncBlockedReason} disabled={!!isSyncing || !syncBlockedReason} className="max-w-[min(20rem,calc(100vw-2rem))] whitespace-normal leading-relaxed">
                        <Button
                            variant="outline"
                            size="sm"
                            className={cn('gap-1.5 h-8 text-xs font-medium', syncBlockedReason && 'cursor-not-allowed opacity-50 active:scale-100')}
                            onClick={() => { if (!syncBlockedReason) void handleSync() }}
                            disabled={!!isSyncing}
                            aria-disabled={syncBlockedReason ? true : undefined}
                        >
                            <RefreshCw className={cn('h-3.5 w-3.5', isSyncing && 'animate-spin')} />
                            {isSyncing ? 'Syncing...' : 'Sync'}
                        </Button>
                    </Tooltip>
                    <Button
                        size="sm"
                        className="gap-1.5 h-8 text-xs font-medium"
                        onClick={() => { notifySubDialog(true); setAddDialogOpen(true) }}
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Add Connection
                    </Button>
    </>
    const connectionsList = (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <StatusChip size="md" className="shrink-0 rounded-lg bg-muted/30"><Zap className="h-3.5 w-3.5" />{activeCount}/{resolvedConnections.length} active{subscribers.length > 0 ? ` · ${subscribers.length} app${subscribers.length === 1 ? '' : 's'}` : ''}</StatusChip>
                <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">Each connection has its own sign-in. Add several accounts or servers from the same platform.</p>
            </div>

            {!hasAny ? (
                <EmptyState
                    icon={<Zap className="h-6 w-6" />}
                    title="No connections yet"
                    description="Connect an addon platform or a media server."
                    action={
                        <Button size="sm" className="gap-1.5" onClick={() => { notifySubDialog(true); setAddDialogOpen(true) }}>
                            <Plus className="h-3.5 w-3.5" />
                            Add Connection
                        </Button>
                    }
                />
            ) : (
                <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {resolvedConnections.map(conn => {
                            const state = conn.platform === 'jellyfin' ? undefined : accountStates[conn.id]
                            // The live state entry is authoritative while present: its
                            // lastError: null means the error is CLEARED (the stored
                            // connection copy must not resurrect it) and lastSync: 0
                            // means never synced. Only fall back to the stored fields
                            // when there is no live entry at all.
                            const liveStatus = state ? state.status : conn.status
                            const liveLastSync = state ? state.lastSync : conn.lastSync
                            const liveLastError = state ? state.lastError : (conn.lastError ?? null)
                            const needsSignIn = (conn.platform === 'stremio' && !conn.credentials?.authKey)
                                || (conn.platform === 'jellyfin' && !conn.credentials?.jellyfin)
                            // Account-level identity (email, premium) belongs to the
                            // CANONICAL Stremio login only; every other login shows its
                            // OWN bound identity so same-platform cards stay human-identifiable
                            // (exact edit/reconnect/remove per login). displayName covers
                            // logins whose platform stores no email (e.g. labeled Nuvio).
                            const isPrimaryStremio = conn.platform === 'stremio' && !!statusAccount && getStremioConnection(statusAccount)?.id === conn.id
                            const connIdentityRaw = conn.mediaServer?.userName
                                || conn.credentials?.email
                                || (conn.connectionType !== 'hydra-outbound' ? conn.displayName : undefined)
                                || (isPrimaryStremio && account ? getAccountEmail(account) : undefined)
                            const connIsEmail = !!connIdentityRaw?.includes('@')
                            const maskedConnIdentity = connIdentityRaw
                                ? (connIsEmail ? maskEmailLevel(connIdentityRaw, emailPrivacyLevel) : maskNameLevel(connIdentityRaw, namePrivacyLevel))
                                : undefined
                            const connEmail = maskedConnIdentity
                            const premium = isPrimaryStremio ? premiumByAccount.get(accountId) : undefined
                            const nuvioMember = conn.platform === 'nuvio' ? nuvioMemberByConnection.get(conn.id) : undefined
                            // lastKnownAddonCount is not maintained after connection creation.
                            // Show the current account collection rather than a stale remote count.
                            const accountAddonCount = statusAccount?.addons?.length
                            // Same-platform cards stay distinguishable: the canonical addon
                            // connection is labelled, every login shows its own identity.
                            const isPrimaryAddonConnection = !!statusAccount && conn.id === statusAccount.primaryConnectionId
                            return (
                                <ConnectionCard
                                    key={conn.id}
                                    connection={conn}
                                    status={needsSignIn ? 'pending' : liveStatus}
                                    lastSync={liveLastSync}
                                    lastError={liveLastError}
                                    syncing={isSyncing === accountId}
                                    onEdit={() => setEditingId(conn.id)}
                                    onToggle={() => useConnectionStore.getState().toggleConnection(accountId, conn.id)}
                                    email={connEmail}
                                    addonCount={conn.platform === 'jellyfin' ? undefined : accountAddonCount}
                                    badge={
                                        <>
                                            {isPrimaryAddonConnection && !needsSignIn && (
                                                <span data-theme-part="badge" className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">Primary</span>
                                            )}
                                            {needsSignIn ? (
                                                <span data-theme-part="badge" className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-warning">Needs sign-in</span>
                                            ) : nuvioMember || premium !== undefined ? (
                                                <>
                                                    {premium?.active && <StremioSupportersBadge />}
                                                    {premium && !premium.active && (
                                                        <span data-theme-part="badge" className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                                            Free
                                                        </span>
                                                    )}
                                                    {nuvioMember && <NuvioTierBadge member={nuvioMember} />}
                                                </>
                                            ) : undefined}
                                        </>
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
                (() => {
                    if (editing.platform === 'jellyfin') return <JellyfinConnectionPanel
                        key={editing.id} accountId={accountId} connection={editing}
                        onBack={() => setEditingId(null)}
                        onReconnect={() => { setJellyfinReconnectId(editing.id); setJellyfinDialogOpen(true); notifySubDialog(true) }}
                    />
                    // Same authority rule as the cards: the live state entry wins as a
                    // whole; the stored connection fields only serve when it is absent.
                    const editState = accountStates[editing.id]
                    const editingIsPrimaryStremio = editing.platform === 'stremio' && !!statusAccount && getStremioConnection(statusAccount)?.id === editing.id
                    return (
                        <ConnectionEditPanel
                            accountId={accountId}
                            connection={editing}
                            status={editState ? editState.status : editing.status}
                            lastError={editState ? editState.lastError : (editing.lastError ?? null)}
                            lastSync={editState ? editState.lastSync : editing.lastSync}
                            premium={editingIsPrimaryStremio ? premiumByAccount.get(accountId) : undefined}
                            nuvioMember={editing.platform === 'nuvio' ? nuvioMemberByConnection.get(editing.id) : undefined}
                            onBack={() => setEditingId(null)}
                        />
                    )
                })()
            ) : (
                <WorkspaceTabs value={subTab} onValueChange={value => { if (!personSaving) setSubTab(value) }} label="Connection tools" actions={subTab === 'connections' ? connectionActions : undefined} tabs={<>
                            <TabsTrigger disabled={personSaving} value="connections"><Link2 className="h-3.5 w-3.5" />Linked accounts</TabsTrigger>
                            <TabsTrigger disabled={personSaving} value="history"><History className="h-3.5 w-3.5" />Watch history</TabsTrigger>
                            <TabsTrigger value="person"><Users className="h-3.5 w-3.5" />Set up a person</TabsTrigger>
                            {hasApiKeyTab && <TabsTrigger disabled={personSaving} value="apikey"><Key className="h-3.5 w-3.5" />API Key</TabsTrigger>}
                </>}>
                    <TabsContent value="connections">{connectionsList}</TabsContent>
                    <TabsContent value="history"><WatchMigrationPicker accountId={accountId} embedded /></TabsContent>
                    <TabsContent value="person">
                        {statusAccount?.addons.some(isAIOStreamsAddon) ? <HouseholdSetupDialog accountId={accountId} open embedded onSavingChange={setPersonSaving} onOpenChange={value => { if (!value) setSubTab('connections') }} /> : <div data-theme-part="panel" className="space-y-3 rounded-2xl border border-border/40 bg-card/50 p-5"><h3 className="text-base font-semibold">Set up a person with AIOS / AIOM</h3><p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">Set up their Jellyfin playback here without switching between AIOStreams and AIOMetadata. Create their AIOStreams variant and user, optionally use that variant in their AIOMetadata configuration, then attach their verified sign-in to a local account you manage.</p><p className="text-xs leading-relaxed text-muted-foreground">Start by adding an AIOStreams configuration to this account’s addons. To connect an existing Jellyfin, AIOS or AIOM user, use Add Connection in Linked accounts.</p></div>}
                    </TabsContent>
                    {hasApiKeyTab && <TabsContent value="apikey">{statusAccount && <ApiKeyManager account={statusAccount} />}</TabsContent>}
                </WorkspaceTabs>
            )}

            <Dialog open={addDialogOpen} onOpenChange={(open) => { setAddDialogOpen(open); notifySubDialog(open) }}>
                <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl sm:p-7">
                    <DialogHeader>
                        <DialogTitle>Add Connection</DialogTitle>
                        <DialogDescription>Connect a platform or media server to AIOManager.</DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                        {PLATFORM_REGISTRY
                            .filter(p => p.available)
                            .map(p => {
                                // Multiplicity: a connected platform stays clickable so
                                // another remote login on the same platform can be bound;
                                // the badge only reports what is already connected.
                                const isAlreadyConnected = p.connectionType === 'native' && resolvedConnections.some(c => c.platform === p.id)
                                return { platform: p, isAlreadyConnected }
                            })
                            .map(({ platform: p, isAlreadyConnected }) => (
                                <button
                                    key={p.id}
                                    data-theme-part="card"
                                    className="group/card flex min-w-0 flex-col justify-between gap-4 rounded-2xl border border-border/40 bg-card p-5 text-left shadow-sm transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card/95 hover:shadow-md"
                                    onClick={() => handlePlatformClick(p.id)}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted/60 ring-1 ring-border/40 transition-colors group-hover/card:bg-background">
                                            <PlatformLogo platform={p.id} className="h-9 w-9" isHydra={p.connectionType === 'hydra-outbound'} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                                <p className="text-sm font-semibold">{p.name}{p.connectionType === 'hydra-outbound' && <span className="ml-1 font-normal text-muted-foreground">· outbound</span>}</p>
                                                {isAlreadyConnected && (
                                                    <span data-theme-part="badge" className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-success">Connected</span>
                                                )}
                                            </div>
                                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.description}</p>
                                        </div>
                                    </div>
                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                                        {isAlreadyConnected ? 'Add another' : 'Connect'}
                                        <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover/card:translate-x-0.5" />
                                    </span>
                                </button>
                            ))}

                        <div data-theme-part="panel" className="rounded-2xl border border-border/30 bg-muted/20 p-4 text-xs text-muted-foreground sm:col-span-2">
                            <p className="font-medium text-foreground">Apps connect to you automatically</p>
                            <p className="mt-1 leading-relaxed">Apps such as Odin pull your addons using your AIOManager URL and account API key through the Hydra API. They appear in your <span className="font-medium text-foreground">connections list</span> after they sync. Find your API key on the API Key tab.</p>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {renderSetupDialogs()}
        </>
    )
}
