import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { RefreshCw, Loader2, Pencil, Check, X, Trash2, Plus, BookOpen, Layers, User, Users, Crosshair, Download, AlertCircle, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { toast } from '@/hooks/use-toast'
import { cn, maskEmailLevel, maskNameLevel, maskProfileLevel } from '@/lib/utils'
import { Poster } from '@/components/common/Poster'
import { EmptyState } from '@/components/common/EmptyState'
import { NuvioPluginsPanel } from './NuvioPluginsTab'
import { readNuvioLibrary, readNuvioCollections, readNuvioProfiles, renameNuvioProfile, createNuvioProfile, deleteNuvioProfile } from '@/lib/nuvio-data'
import type { NuvioLibraryItem, NuvioCollection, NuvioProfileRow } from '@/lib/nuvio-data'
import type { Connection, ConnectionStatus } from '@/types/connection'
import { downloadNuvioBackup } from '@/api/nuvio-backup'
import { NUVIO_BACKUP_COPY } from './nuvio-backup-copy'
import { useAccountStore } from '@/store/accountStore'
import { useUIStore } from '@/store/uiStore'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { getProfileClaims, resolveProfileState, profileClaimKey, loginScope } from '@/lib/profile-claims'
import type { ProfileRosterState } from '@/lib/profile-claims'
import { resolveNuvioSyncTarget, storedNuvioTargetId } from './nuvio-sync-target'
import type { NuvioTargetProfile } from './nuvio-sync-target'
import { ProfileQuickAddReview } from './ProfileQuickAddReview'
import type { ProfileQuickAddEntry as NuvioQuickAddEntry } from '@/store/account/profileQuickAdd'

const errMsg = (e: unknown, fallback = 'Try again.') => (e instanceof Error ? e.message : fallback)

const ReadOnlyBadge = () => (
    <span data-theme-part="badge" className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Read-only - manage in Nuvio
    </span>
)

// Identity-keyed resource loader. A boolean `cancelled` flag cannot tell two
// in-flight requests apart: after an identity switch the flag is false again,
// so the OLD request could overwrite the new one's data. A monotonic
// generation counter discards any response that is not from the newest
// request. Data is reset only when the identity (or eligibility) changes :
// a same-scope retry keeps the last successful data underneath the reload.
function useNuvioResource<T>(load: () => Promise<T>, identity: string, enabled = true) {
    const [data, setData] = useState<T | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const generation = useRef(0)
    const loadRef = useRef(load)
    const enabledRef = useRef(enabled)
    loadRef.current = load
    enabledRef.current = enabled

    const reload = useCallback(async () => {
        if (!enabledRef.current) return
        const gen = ++generation.current
        setLoading(true)
        setError(null)
        try {
            const result = await loadRef.current()
            if (gen !== generation.current) return
            setData(result)
        } catch (err) {
            if (gen !== generation.current) return
            setError(err instanceof Error ? err.message : 'Could not load. Try re-authenticating this connection.')
        } finally {
            if (gen === generation.current) setLoading(false)
        }
    }, [])

    const invalidate = useCallback(() => { generation.current++ }, [])

    useEffect(() => {
        // Invalidate anything still in flight for the previous scope: React runs
        // this before the previous effect's requests can be accepted, and every
        // scope start bumps past every previously issued generation.
        invalidate()
        setData(null)
        setError(null)
        if (!enabled) {
            setLoading(false)
            return invalidate
        }
        setLoading(true)
        void reload()
        return invalidate
    }, [identity, enabled, reload, invalidate])

    return { data, loading, error, reload }
}

export function TabToolbar({ label, count, loading, onReload, icon, badge }: {
    label?: string
    count?: number
    loading: boolean
    onReload: () => void
    icon?: ReactNode
    badge?: ReactNode
}) {
    return (
        <div className="flex items-center gap-2 mb-4">
            {icon && (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-muted/40 text-muted-foreground">
                    {icon}
                </span>
            )}
            {label && (
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground flex-1">{label}</p>
            )}
            {!label && <span className="flex-1" />}
            {badge}
            {count !== undefined && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-md bg-muted px-1.5 text-xs font-semibold text-muted-foreground">
                    {count}
                </span>
            )}
            <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground"
                onClick={onReload}
                disabled={loading}
                aria-label="Reload"
            >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
        </div>
    )
}

function TabLoading() {
    return (
        <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
        </div>
    )
}

function TabError({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="space-y-3">
            <div data-theme-tone="status" data-theme-part="panel" className="rounded-2xl bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-xs text-destructive shadow-sm">{message}</div>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onRetry}>
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
            </Button>
        </div>
    )
}

// The read path (lib/nuvio-data withNuvio) keys off the connection id, the
// backend credentials and the stored profile scope. so those fields, not the
// whole connection object, form the resource identity. Unrelated connection
// churn (status/lastSync updates during a sync) must not re-issue reads.
function nuvioReadIdentity(accountId: string, connection: Connection, includeScope: boolean): string {
    const creds = connection.credentials
    return [
        accountId,
        connection.id,
        creds?.baseUrl || '',
        creds?.publishableKey || '',
        ...(includeScope ? [creds?.profileId || ''] : []),
    ].join('|')
}

function LibrarySection({ accountId, connection }: { accountId: string; connection: Connection }) {
    const identity = nuvioReadIdentity(accountId, connection, true)
    const load = useCallback(() => readNuvioLibrary(accountId, connection), [accountId, connection])
    const { data, loading, error, reload } = useNuvioResource<NuvioLibraryItem[]>(load, identity)
    const items = data || []

    return (
        <div>
            <TabToolbar label="Library" count={data ? items.length : undefined} loading={loading} onReload={reload} badge={<ReadOnlyBadge />} />
            {error ? <TabError message={error} onRetry={reload} /> : loading ? <TabLoading /> : items.length === 0 ? (
                <EmptyState
                    icon={<BookOpen className="h-5 w-5" />}
                    title="Library is empty"
                    description="Content you save on Nuvio will appear here."
                />
            ) : (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7">
                    {items.map((item, i) => (
                        <div key={`${item.content_id}-${i}`} className="group space-y-1.5">
                            <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-border/40 bg-muted shadow-sm transition-[transform,opacity,box-shadow] duration-200 group-hover:border-primary/50 group-hover:shadow-lg">
                                <Poster src={item.poster} itemId={item.content_id} itemType={item.content_type} alt={item.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                            </div>
                            <Tooltip content={item.name || item.content_id}>
                              <TooltipTrigger asChild>
                                <p className="truncate text-[11px] font-medium leading-tight">
                                  {item.name || item.content_id}
                                </p>
                              </TooltipTrigger>
                            </Tooltip>
                            {(item.release_info || item.imdb_rating) && (
                                <p className="truncate text-xs text-muted-foreground">
                                    {[item.release_info, item.imdb_rating ? `★ ${item.imdb_rating}` : null].filter(Boolean).join(' · ')}
                                </p>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

function CollectionsSection({ accountId, connection }: { accountId: string; connection: Connection }) {
    const identity = nuvioReadIdentity(accountId, connection, true)
    const load = useCallback(() => readNuvioCollections(accountId, connection), [accountId, connection])
    const { data, loading, error, reload } = useNuvioResource<NuvioCollection[]>(load, identity)
    const collections = data || []

    return (
        <div>
            <TabToolbar label="Collections" count={data ? collections.length : undefined} loading={loading} onReload={reload} badge={<ReadOnlyBadge />} />
            {error ? <TabError message={error} onRetry={reload} /> : loading ? <TabLoading /> : collections.length === 0 ? (
                <EmptyState
                    icon={<Layers className="h-5 w-5" />}
                    title="No collections"
                    description="Collections you create on Nuvio will appear here."
                />
            ) : (
                <div className="space-y-1.5">
                    {collections.map((c, i) => (
                        <div
                            key={c.id || i}
                            className="flex items-center gap-3 rounded-2xl border border-border/40 bg-card shadow-sm px-3.5 py-2.5 transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border/70 hover:bg-card/95 hover:shadow-md"
                            data-theme-part="panel"
                        >
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{c.title || 'Untitled collection'}</p>
                                <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                                    {(c.folders?.length ?? 0)} folder{(c.folders?.length ?? 0) === 1 ? '' : 's'}
                                    {c.pinToTop ? ' · Pinned' : ''}
                                    {c.viewMode ? ` · ${c.viewMode}` : ''}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

// ONE roster is both the sync-target picker and the profile manager (approved
// unified-roster direction): the radio column selects the target, each row
// states its role and ownership in words, and every occasional or destructive
// action lives in the row menu. There is no second list that a create, delete,
// rename, or switch could leave stale.
function NuvioProfilesRoster({ accountId, connection, status, activeProfileId, profiles, loading, error, reload }: {
    accountId: string
    connection: Connection
    status?: ConnectionStatus
    activeProfileId?: string | null
    profiles: NuvioProfileRow[]
    loading: boolean
    error: string | null
    reload: () => Promise<void>
}) {
    const accounts = useAccountStore(s => s.accounts)
    const privacyEnabled = useUIStore(s => s.isPrivacyModeEnabled)
    const privacyLevelProfiles = useUIStore(s => s.privacyLevelProfiles)
    const privacyLevelNames = useUIStore(s => s.privacyLevelNames)
    const privacyLevelEmail = useUIStore(s => s.privacyLevelEmail)
    const profilePrivacyLevel = privacyEnabled ? privacyLevelProfiles : 0
    const profileLabel = useCallback((name?: string) => maskProfileLevel(name || 'Profile', profilePrivacyLevel), [profilePrivacyLevel])
    const accountLabel = (name: string) => name.includes('@')
        ? maskEmailLevel(name, privacyEnabled ? privacyLevelEmail : 0)
        : maskNameLevel(name, privacyEnabled ? privacyLevelNames : 0)
    const [busy, setBusy] = useState(false)
    const [editId, setEditId] = useState<string | null>(null)
    const [editName, setEditName] = useState('')
    const [newName, setNewName] = useState('')
    const [confirm, setConfirm] = useState<NuvioProfileRow | null>(null)
    const [quickAddEntries, setQuickAddEntries] = useState<NuvioQuickAddEntry[] | null>(null)
    const [switching, setSwitching] = useState(false)
    const [pending, setPending] = useState<NuvioTargetProfile | null>(null)

    // Account-level subscription: deleting an account must release its claim chip.
    const claims = useMemo(() => getProfileClaims(accounts, {
        baseUrl: connection.credentials?.baseUrl,
        loginId: loginScope(connection.credentials),
        profiles: profiles.map(profile => ({ id: profile.id, index: profile.profile_index })),
    }), [accounts, connection.credentials, profiles])
    const stale = !!error || status === 'expired'
    // Destructive actions stay off while the list is refreshing or unverified:
    // a rename/create/delete against a stale list is a write we can't stand behind.
    const actionsDisabled = stale || busy || loading
    // A stale or still-loading list cannot back a target switch either.
    const switchDisabled = switching || loading || !!error

    const openClaimedAccount = useCallback((claimAccountId: string) => {
        const owner = accounts.find(a => a.id === claimAccountId)
        if (!owner) return
        useUIStore.getState().openAddAccountDialog(owner)
    }, [accounts])

    const rosterBackend = connection.credentials?.baseUrl
    const rosterLogin = loginScope(connection.credentials)

    const rowState = (p: NuvioProfileRow): ProfileRosterState =>
        resolveProfileState(
            { platform: 'nuvio', profileId: String(p.profile_index), baseUrl: rosterBackend, loginId: rosterLogin },
            claims,
            accountId,
            connection.id,
        )

    const claimedOnRow = (p: NuvioProfileRow) => claims.get(profileClaimKey({ platform: 'nuvio', profileId: String(p.profile_index), baseUrl: rosterBackend, loginId: rosterLogin }))

    // The roster follows the SAME effective target the writer uses
    // (mapping > profileIndex > profileId, digits = index), including the
    // driver's primary-profile default when nothing is stored: the radio marks
    // that default like an explicit target, and the delete guard protects it.
    const currentTargetId = useMemo(
        () => storedNuvioTargetId({ credentials: connection.credentials, profileMapping: connection.profileMapping, activeProfileId }),
        [connection.credentials, connection.profileMapping, activeProfileId],
    )
    const target = useMemo(
        () => resolveNuvioSyncTarget(
            profiles.map(p => ({ id: p.id, index: p.profile_index, name: p.name })),
            currentTargetId,
        ),
        [profiles, currentTargetId],
    )
    const isTargetProfile = (p: NuvioProfileRow) =>
        !!target.active && target.active.id === p.id && target.active.index === p.profile_index

    const beginSwitch = (p: NuvioProfileRow) => {
        if (switchDisabled || isTargetProfile(p)) return
        // Opening one confirm closes the other: both replace addon state and
        // must never be armed at the same time.
        setConfirm(null)
        setPending({ id: p.id, index: p.profile_index, name: p.name })
    }

    // Mirror the writer: mapping > profileIndex > profileId, digits resolve as
    // an index and anything else as a UUID. An empty stored target means the
    // driver's primary-profile default is the effective target.
    const doSwitch = useCallback(async (p: NuvioTargetProfile) => {
        if (switchDisabled) return
        const profileKey = p.index > 0 ? String(p.index) : p.id
        if (!profileKey) { toast({ title: 'Profile has no usable id', variant: 'destructive' }); return }
        setSwitching(true)
        try {
            const { setConnectionProfile } = await import('@/api/connection')
            await setConnectionProfile(connection.id, profileKey)
            const { updateConnection, syncConnections } = (await import('@/store/connectionStore')).useConnectionStore.getState()
            // The writer's credential fallback reads profileIndex BEFORE
            // profileId, so both fields must point at the chosen profile or
            // the switch would not move the effective push target.
            await updateConnection(accountId, connection.id, {
                ...(activeProfileId && connection.profileMapping?.[activeProfileId] !== undefined && p.index > 0
                    ? { profileMapping: { ...connection.profileMapping, [activeProfileId]: p.index } }
                    : {}),
                credentials: {
                    ...connection.credentials,
                    profileId: profileKey,
                    profileIndex: p.index > 0 ? String(p.index) : '',
                },
            })
            toast({ title: `Switched to ${profileLabel(p.name)}` })
            syncConnections(accountId).catch((err) => {
                toast({ title: 'Profile switched, but sync did not finish', description: err instanceof Error ? err.message : 'Addons may not have pushed to the new profile yet.', variant: 'destructive' })
            })
        } catch (err) {
            toast({ title: 'Could not switch profile', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' })
        } finally {
            setSwitching(false)
            setPending(null)
        }
    }, [accountId, connection.id, connection.credentials, connection.profileMapping, activeProfileId, switchDisabled, profileLabel])

    const doRename = async (p: NuvioProfileRow) => {
        // Keyboard (Enter) path must respect the same gate as the buttons.
        if (actionsDisabled) return
        const name = editName.trim()
        if (!name || name === p.name) { setEditId(null); return }
        setBusy(true)
        try { await renameNuvioProfile(accountId, connection, p.id, name); setEditId(null); await reload(); toast({ title: 'Profile renamed' }) }
        catch (e) { toast({ title: 'Rename failed', description: errMsg(e), variant: 'destructive' }) }
        finally { setBusy(false) }
    }
    const used = new Set(profiles.map(p => p.profile_index))
    let nextIdx = 1
    while (used.has(nextIdx) && nextIdx <= 4) nextIdx++
    const canCreate = nextIdx <= 4

    const doCreate = async () => {
        if (actionsDisabled) return
        const name = newName.trim()
        if (!name || !canCreate) return
        setBusy(true)
        try { await createNuvioProfile(accountId, connection, { profileIndex: nextIdx, name }); setNewName(''); await reload(); toast({ title: 'Profile created' }) }
        catch (e) { toast({ title: 'Create failed', description: errMsg(e), variant: 'destructive' }) }
        finally { setBusy(false) }
    }

    // Deleting the active sync target would leave pushes aimed at nothing, so
    // it is blocked until the target moves.
    const doDelete = async () => {
        if (!confirm) return
        if (actionsDisabled) return
        if (isTargetProfile(confirm)) {
            toast({ title: 'Switch the sync target first', description: `${profileLabel(confirm.name)} is this account's active sync target.`, variant: 'destructive' })
            return
        }
        setBusy(true)
        try { await deleteNuvioProfile(accountId, connection, confirm.profile_index); setConfirm(null); await reload(); toast({ title: 'Profile deleted' }) }
        catch (e) { toast({ title: 'Delete failed', description: errMsg(e), variant: 'destructive' }) }
        finally { setBusy(false) }
    }

    const unclaimedProfiles = profiles.filter(p => rowState(p) === 'unclaimed')
    const doQuickAddAll = () => setQuickAddEntries(unclaimedProfiles.map(p => ({
        profileIndex: p.profile_index,
        name: p.name,
        avatarColorHex: p.avatar_color_hex,
    })))

    return (
        <div>
            <TabToolbar label="Profiles" count={loading ? undefined : profiles.length} loading={loading} onReload={reload} icon={<Users className="h-3.5 w-3.5" />} />
            <p className="-mt-2.5 mb-1 text-xs text-muted-foreground">Choose the Nuvio profile that receives this account's addons. Each profile can also have its own AIOManager account.</p>
            <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground/80">
                Adding a profile as an account makes it a full account, just like the ones you already manage: its own addons, its own watch history. It stays on the same Nuvio login and nothing changes on Nuvio. You can delete the account anytime.
            </p>
            {error && profiles.length === 0 ? (
                <TabError message={error} onRetry={reload} />
            ) : loading && profiles.length === 0 ? <TabLoading /> : (
                <div className="space-y-1.5">
                    {stale && (
                        <div data-theme-tone="status" data-theme-part="panel" role="status" data-nuvio="stale-banner" className="mb-1.5 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/8 px-3 py-2 text-[11px] text-muted-foreground">
                            <RefreshCw className="h-3 w-3 shrink-0" />
                            <span className="flex-1">Showing last known profiles. Switching and profile changes are off until this list refreshes.</span>
                            <Button variant="ghost" size="sm" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => reload()}>Retry</Button>
                        </div>
                    )}

                    {target.danglingId && (
                        <div data-theme-tone="status" data-theme-part="panel" data-nuvio="dangling-banner" className="mb-1.5 flex items-start gap-2 rounded-xl border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>
                                Sync target profile {profileLabel(target.danglingId)} no longer exists on Nuvio. Pick a new target in the roster; pushes to the missing profile are refused until you switch.
                            </span>
                        </div>
                    )}

                    {target.isDefault && profiles.length > 0 && (
                        <p className="text-[11px] leading-relaxed text-muted-foreground" data-nuvio="default-target-hint">
                            No explicit target is stored yet, so pushes go to the primary profile. Choosing a target below records it.
                        </p>
                    )}

                    {profiles.length === 0 && (
                        <EmptyState
                            icon={<User className="h-5 w-5" />}
                            title="No profiles yet"
                            description="Create your first Nuvio profile below."
                        />
                    )}

                    {profiles.length > 0 && (
                        <div className="space-y-1.5" role="radiogroup" aria-label="Sync target" data-nuvio="roster">
                            {profiles.map(p => {
                                const state = rowState(p)
                                const claim = state === 'claimed' ? claimedOnRow(p) : undefined
                                const isTarget = isTargetProfile(p)
                                const pendingThis = !!pending && pending.id === p.id && pending.index === p.profile_index
                                return (
                                    <div
                                        key={p.id}
                                        data-nuvio="roster-row"
                                        data-is-target={isTarget}
                                        className={cn(
                                            'flex flex-wrap items-center gap-3 rounded-2xl border px-3.5 py-2.5 transition-colors',
                                            isTarget ? 'border-primary/30 bg-primary/8' : 'border-border/40 bg-card',
                                            pendingThis && 'outline outline-1 outline-warning/50',
                                        )}
                                    >
                                        <span
                                            aria-hidden="true"
                                            className={cn(
                                                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold',
                                                !p.avatar_color_hex && 'bg-muted/60 text-muted-foreground',
                                            )}
                                            style={p.avatar_color_hex ? { backgroundColor: `${p.avatar_color_hex}26`, color: p.avatar_color_hex } : undefined}
                                        >
                                            {p.profile_index}
                                        </span>
                                        {editId === p.id ? (
                                            <>
                                                <Input
                                                    value={editName}
                                                    onChange={e => setEditName(e.target.value)}
                                                    className="h-7 flex-1 min-w-0 text-xs"
                                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); doRename(p) } if (e.key === 'Escape') setEditId(null) }}
                                                    autoFocus
                                                    aria-label="New profile name"
                                                />
                                                <Button variant="ghost" size="icon" className="h-7 w-7 flex items-center justify-center shrink-0 text-primary hover:text-primary hover:bg-primary/10" onClick={() => doRename(p)} disabled={busy} aria-label="Save name">
                                                    <Check className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-7 w-7 flex items-center justify-center shrink-0 text-muted-foreground" onClick={() => setEditId(null)} disabled={busy} aria-label="Cancel">
                                                    <X className="h-3.5 w-3.5" />
                                                </Button>
                                            </>
                                        ) : (
                                            <>
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-sm font-medium">{profileLabel(p.name)}</p>
                                                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground/80">
                                                        <span className="font-mono">slot {p.profile_index}</span>
                                                        {isTarget && (
                                                            <>
                                                                <span aria-hidden="true">·</span>
                                                                <span className="text-primary">{target.isDefault ? 'receives this account’s addons by default' : 'receives this account’s addons'}</span>
                                                            </>
                                                        )}
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    role="radio"
                                                    aria-checked={isTarget}
                                                    data-nuvio="target-radio"
                                                    disabled={isTarget || switchDisabled}
                                                    onClick={() => beginSwitch(p)}
                                                    className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                                                >
                                                    <span
                                                        aria-hidden="true"
                                                        className={cn(
                                                            'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                                                            isTarget ? 'border-primary' : 'border-muted-foreground/40',
                                                        )}
                                                    >
                                                        {isTarget && <span className="h-2 w-2 rounded-full bg-primary" />}
                                                    </span>
                                                    <span className="truncate">{isTarget ? 'Receives these addons' : 'Send addons here'}</span>
                                                </button>
                                                {state === 'active-here' && (
                                                    <span data-theme-part="badge" className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/25 bg-primary/12 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                                                        <Check className="h-3 w-3" />
                                                        Managed here
                                                    </span>
                                                )}
                                                {state === 'claimed' && claim && (
                                                    <Tooltip content={`Open ${accountLabel(claim.accountName)}`} side="top">
                                                        <button
                                                            type="button"
                                                            data-theme-part="badge"
                                                            onClick={() => openClaimedAccount(claim.accountId)}
                                                            className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border/40 bg-muted/40 py-0.5 pl-0.5 pr-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border/70 hover:text-foreground"
                                                        >
                                                            <AccountAvatar
                                                                size="sm"
                                                                showStatus={false}
                                                                account={{
                                                                    name: accountLabel(claim.accountName),
                                                                    email: maskEmailLevel(claim.accountEmail || '', privacyEnabled ? privacyLevelEmail : 0),
                                                                    emoji: claim.emoji,
                                                                    avatar: claim.avatar,
                                                                    status: claim.status ?? 'active',
                                                                }}
                                                            />
                                                            <span className="truncate">Managed separately · {accountLabel(claim.accountName)}</span>
                                                        </button>
                                                    </Tooltip>
                                                )}
                                                {state === 'unclaimed' && (
                                                    <span data-theme-part="badge" className="inline-flex shrink-0 items-center rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[11px] font-medium text-muted-foreground/80">
                                                        Not managed
                                                    </span>
                                                )}
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger
                                                        className="h-7 w-7 shrink-0 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                                        aria-label={`Actions for ${profileLabel(p.name)}`}
                                                        data-nuvio="row-menu"
                                                    >
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        {!isTarget && (
                                                            <DropdownMenuItem className="gap-2 text-xs" disabled={switchDisabled} onClick={() => beginSwitch(p)} data-nuvio="menu-set-target">
                                                                <Crosshair className="h-3.5 w-3.5" /> Set as sync target…
                                                            </DropdownMenuItem>
                                                        )}
                                                        {state === 'unclaimed' && (
                                                            <DropdownMenuItem className="gap-2 text-xs" disabled={actionsDisabled} onClick={() => setQuickAddEntries([{
                                                                profileIndex: p.profile_index,
                                                                name: p.name,
                                                                avatarColorHex: p.avatar_color_hex,
                                                            }])} data-nuvio="menu-add-account">
                                                                <Plus className="h-3.5 w-3.5" /> Add as account…
                                                            </DropdownMenuItem>
                                                        )}
                                                        <DropdownMenuItem className="gap-2 text-xs" disabled={actionsDisabled} onClick={() => { setEditId(p.id); setEditName(p.name) }} data-nuvio="menu-rename">
                                                            <Pencil className="h-3.5 w-3.5" /> Rename…
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem destructive className="gap-2 text-xs" disabled={actionsDisabled} onClick={() => { setPending(null); setConfirm(p) }} data-nuvio="menu-delete">
                                                            <Trash2 className="h-3.5 w-3.5" /> Delete…
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {unclaimedProfiles.length >= 2 && (
                        <div className="flex justify-end pt-1">
                            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={doQuickAddAll} disabled={actionsDisabled} data-nuvio="bulk-add">
                                <Plus className="h-3.5 w-3.5" />
                                Add all unclaimed ({unclaimedProfiles.length})
                            </Button>
                        </div>
                    )}

                    {pending && (
                        <div data-theme-tone="status" data-theme-part="panel" data-nuvio="switch-confirm" className="rounded-2xl border border-warning/30 bg-warning/8 p-4 space-y-3 shadow-sm">
                            <p className="text-sm font-medium text-warning">Send this account's addons to <strong>{profileLabel(pending.name)}</strong>?</p>
                            <p className="text-xs text-muted-foreground">
                                This replaces that profile's current addons on Nuvio and can't be undone.
                                {target.active && target.active.id !== pending.id && <> Currently <strong>{profileLabel(target.active.name)}</strong> receives them.</>}
                            </p>
                            <div className="flex gap-2">
                                <Button size="sm" variant="subtle" className="h-8 flex-1 text-xs" onClick={() => setPending(null)} disabled={switching}>Cancel</Button>
                                <Button size="sm" className="h-8 flex-1 text-xs" onClick={() => doSwitch(pending)} disabled={switchDisabled}>
                                    {switching ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Switching…</> : 'Switch & sync'}
                                </Button>
                            </div>
                        </div>
                    )}

                    {confirm && (
                        <div data-theme-tone="status" data-theme-part="panel" data-nuvio="delete-confirm" className="rounded-2xl border border-destructive/30 bg-destructive/8 p-4 space-y-3 shadow-sm">
                            <p className="text-sm font-medium text-destructive">Delete <strong>{profileLabel(confirm.name)}</strong>?</p>
                            <p className="text-xs text-muted-foreground">This removes the profile and all its data on Nuvio (addons, plugins, collections, library and watch history) and can't be undone.</p>
                            {isTargetProfile(confirm) && (
                                <p data-theme-part="panel" className="rounded-xl bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-warning">
                                    {profileLabel(confirm.name)} is this account's {target.isDefault ? 'default push profile (no explicit target is set, so Nuvio pushes land on the primary profile)' : 'active sync target'}. Switch the sync target to another profile above first, then delete.
                                </p>
                            )}
                            <div className="flex gap-2">
                                <Button size="sm" variant="subtle" className="h-8 flex-1 text-xs" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
                                <Button size="sm" variant="destructive" className="h-8 flex-1 text-xs" onClick={doDelete} disabled={actionsDisabled || isTargetProfile(confirm)}>Delete profile</Button>
                            </div>
                        </div>
                    )}

                    {canCreate && (
                        <div className="flex gap-2 pt-2 border-t border-border/40 mt-2" data-nuvio="create-profile">
                            <Input
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                placeholder={`New profile name (slot ${nextIdx})`}
                                className="h-8 flex-1 text-xs"
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); doCreate() } }}
                                aria-label="New profile name"
                            />
                            <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5 text-xs" onClick={doCreate} disabled={actionsDisabled || !newName.trim()}>
                                <Plus className="h-3.5 w-3.5" /> Add
                            </Button>
                        </div>
                    )}
                    {!canCreate && (
                        <p className="pt-2 text-[11px] text-muted-foreground border-t border-border/40 mt-2">Nuvio allows up to 4 profiles per account.</p>
                    )}
                </div>
            )}

            {quickAddEntries !== null && (
                <ProfileQuickAddReview
                    open={!!quickAddEntries}
                    sourceAccountId={accountId}
                    sourceConnectionId={connection.id}
                    email={connection.credentials?.email || undefined}
                    entries={quickAddEntries}
                    onClose={() => { setQuickAddEntries(null); reload() }}
                />
            )}
        </div>
    )
}

export function NuvioBackupButton({ accountId, connectionId }: { accountId: string; connectionId: string }) {
    const [backupBusy, setBackupBusy] = useState(false)

    const doBackup = async () => {
        setBackupBusy(true)
        try {
            await downloadNuvioBackup(accountId, connectionId)
            toast({ title: 'Backup downloaded' })
        } catch (e) {
            toast({ title: 'Backup failed', description: errMsg(e), variant: 'destructive' })
        } finally {
            setBackupBusy(false)
        }
    }

    return (
        <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 text-xs" onClick={doBackup} disabled={backupBusy}>
            {backupBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download backup
        </Button>
    )
}

export function NuvioPluginsTab({ accountId, connection }: { accountId: string; connection: Connection }) {
    return (
        <div data-theme-part="panel" className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
            <NuvioPluginsPanel accountId={accountId} connection={connection} />
        </div>
    )
}

export function NuvioProfilesTab({ accountId, connection, status }: {
    accountId: string
    connection: Connection
    status?: ConnectionStatus
}) {
    const activeProfileId = useAccountStore(s => s.accounts.find(a => a.id === accountId)?.activeProfileId)
    const canSwitchProfile = status !== 'expired' && connection.capabilities.includes('profiles')
    // One roster is both the picker and the manager, so a create, delete,
    // rename, or target switch all read and write the same list and a deleted
    // target can never linger. The read is gated on the tab's own eligibility:
    // an expired or incapable connection must not issue profile reads at all.
    const identity = nuvioReadIdentity(accountId, connection, false)
    const load = useCallback(() => readNuvioProfiles(accountId, connection), [accountId, connection])
    const { data, loading, error, reload } = useNuvioResource<NuvioProfileRow[]>(load, identity, canSwitchProfile)
    const profiles = data || []

    if (!canSwitchProfile) {
        return (
            <div data-theme-part="panel" className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
                <p className="text-sm font-semibold">Nuvio profiles</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {status === 'expired'
                        ? 'This connection needs re-authentication before its profiles can be loaded. Use Test or re-authenticate on the Connection tab.'
                        : 'This connection cannot manage Nuvio profiles.'}
                </p>
            </div>
        )
    }

    return (
        <div data-theme-part="panel" className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
            <NuvioProfilesRoster
                accountId={accountId}
                connection={connection}
                status={status}
                activeProfileId={activeProfileId}
                profiles={profiles}
                loading={loading}
                error={error}
                reload={reload}
            />
        </div>
    )
}

export function NuvioLibraryTab({ accountId, connection }: { accountId: string; connection: Connection }) {
    return (
        <div data-theme-part="panel" className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
            <LibrarySection accountId={accountId} connection={connection} />
        </div>
    )
}

export function NuvioCollectionsTab({ accountId, connection }: { accountId: string; connection: Connection }) {
    return (
        <div data-theme-part="panel" className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
            <CollectionsSection accountId={accountId} connection={connection} />
        </div>
    )
}

export function NuvioBackupTab({ accountId, connection }: { accountId: string; connection: Connection }) {
    return (
        <div data-theme-part="panel" className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm space-y-3">
            <div className="min-w-0">
                <p className="text-sm font-semibold">Account backup</p>
                <p className="text-xs text-muted-foreground">Keep a safety copy of this Nuvio account.</p>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground/80">{NUVIO_BACKUP_COPY}</p>
            <div className="flex flex-wrap gap-2">
                <NuvioBackupButton accountId={accountId} connectionId={connection.id} />
            </div>
        </div>
    )
}
