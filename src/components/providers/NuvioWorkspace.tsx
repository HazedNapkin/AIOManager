import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { RefreshCw, Loader2, Pencil, Check, X, Trash2, Plus, BookOpen, Layers, User, Users, Crosshair, Download, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
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
    <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
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

function TabToolbar({ label, count, loading, onReload, icon, badge }: {
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
            <div className="rounded-2xl bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-xs text-destructive shadow-sm">{message}</div>
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

function ProfilesSection({ accountId, connection, status, activeProfileId, profiles, loading, error, reload }: {
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
    const [busy, setBusy] = useState(false)
    const [editId, setEditId] = useState<string | null>(null)
    const [editName, setEditName] = useState('')
    const [newName, setNewName] = useState('')
    const [confirm, setConfirm] = useState<NuvioProfileRow | null>(null)
    const [quickAddEntries, setQuickAddEntries] = useState<NuvioQuickAddEntry[] | null>(null)

    // Account-level subscription: deleting an account must release its claim chip.
    const claims = useMemo(() => getProfileClaims(accounts), [accounts])
    const stale = !!error || status === 'expired'
    // Destructive actions stay off while the list is refreshing or unverified:
    // a rename/create/delete against a stale list is a write we can't stand behind.
    const actionsDisabled = stale || busy || loading
    const addDisabled = actionsDisabled

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

    const used = new Set(profiles.map(p => p.profile_index))
    let nextIdx = 1
    while (used.has(nextIdx) && nextIdx <= 4) nextIdx++
    const canCreate = nextIdx <= 4

    const unclaimedProfiles = profiles.filter(p => rowState(p) === 'unclaimed')
    const doQuickAddAll = () => setQuickAddEntries(unclaimedProfiles.map(p => ({
        profileIndex: p.profile_index,
        name: p.name,
        avatarColorHex: p.avatar_color_hex,
    })))

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
    const doCreate = async () => {
        if (actionsDisabled) return
        const name = newName.trim()
        if (!name || !canCreate) return
        setBusy(true)
        try { await createNuvioProfile(accountId, connection, { profileIndex: nextIdx, name }); setNewName(''); await reload(); toast({ title: 'Profile created' }) }
        catch (e) { toast({ title: 'Create failed', description: errMsg(e), variant: 'destructive' }) }
        finally { setBusy(false) }
    }
    // The delete guard follows the SAME effective target the writer uses
    // (mapping > profileIndex > profileId, digits = index), including the
    // driver's primary-profile default when nothing is stored: deleting that
    // profile would silently re-aim pushes at whatever becomes primary.
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

    // Deleting the active sync target would leave pushes aimed at nothing, so
    // it is blocked until the target moves.
    const doDelete = async () => {
        if (!confirm) return
        if (actionsDisabled) return
        if (isTargetProfile(confirm)) {
            toast({ title: 'Switch the sync target first', description: `${confirm.name} is this account's active sync target.`, variant: 'destructive' })
            return
        }
        setBusy(true)
        try { await deleteNuvioProfile(accountId, connection, confirm.profile_index); setConfirm(null); await reload(); toast({ title: 'Profile deleted' }) }
        catch (e) { toast({ title: 'Delete failed', description: errMsg(e), variant: 'destructive' }) }
        finally { setBusy(false) }
    }

    return (
        <div>
            <TabToolbar label="Manage profiles" count={loading ? undefined : profiles.length} loading={loading} onReload={reload} icon={<Users className="h-3.5 w-3.5" />} />
            <p className="-mt-2.5 mb-1 text-xs text-muted-foreground">Each Nuvio profile can become its own fully managed account.</p>
            <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground/80">
                Adding a profile as an account makes it a full account, just like the ones you already manage: its own addons, its own watch history. It stays on the same Nuvio login and nothing changes on Nuvio. You can delete the account anytime.
            </p>
            {error && profiles.length === 0 ? (
                <TabError message={error} onRetry={reload} />
            ) : loading && profiles.length === 0 ? <TabLoading /> : (
                <div className="space-y-1.5">
                    {stale && (
                        <div className="mb-1.5 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/8 px-3 py-2 text-[11px] text-muted-foreground">
                            <RefreshCw className="h-3 w-3 shrink-0" />
                            <span className="flex-1">Showing last known profiles. Add actions are off until this list refreshes.</span>
                            <Button variant="ghost" size="sm" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => reload()}>Retry</Button>
                        </div>
                    )}

                    {profiles.length === 0 && (
                        <EmptyState
                            icon={<User className="h-5 w-5" />}
                            title="No profiles yet"
                            description="Create your first Nuvio profile below."
                        />
                    )}

                    {profiles.map(p => {
                        const state = rowState(p)
                        const claim = state === 'claimed' ? claimedOnRow(p) : undefined
                        return (
                        <div
                            key={p.id}
                            className={cn(
                                'flex items-center gap-3 rounded-2xl border border-border/40 bg-card shadow-sm px-3.5 py-2.5 transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border/70 hover:bg-card/95 hover:shadow-md',
                                editId === p.id && 'flex-wrap'
                            )}
                        >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-[11px] font-bold text-muted-foreground">
                                {p.profile_index}
                            </span>
                            {editId === p.id ? (
                                <>
                                    <Input
                                        value={editName}
                                        onChange={e => setEditName(e.target.value)}
                                        className="h-7 flex-1 text-xs"
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); doRename(p) } if (e.key === 'Escape') setEditId(null) }}
                                        autoFocus
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
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                                    {state === 'active-here' && (
                                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/25 bg-primary/12 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                                            <Check className="h-3 w-3" />
                                            Active
                                        </span>
                                    )}
                                    {state === 'claimed' && claim && (
                                        <button
                                            type="button"
                                            onClick={() => openClaimedAccount(claim.accountId)}
                                            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/40 bg-muted/40 py-0.5 pl-0.5 pr-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border/70 hover:text-foreground"
                                            title={`Open ${claim.accountName}`}
                                        >
                                            <AccountAvatar
                                                size="sm"
                                                showStatus={false}
                                                account={{
                                                    name: claim.accountName,
                                                    email: claim.accountEmail,
                                                    emoji: claim.emoji,
                                                    avatar: claim.avatar,
                                                    status: claim.status ?? 'active',
                                                }}
                                            />
                                            Account: {claim.accountName}
                                        </button>
                                    )}
                                    {state === 'unclaimed' && (
                                        <button
                                            type="button"
                                            disabled={addDisabled}
                                            onClick={() => setQuickAddEntries([{
                                                profileIndex: p.profile_index,
                                                name: p.name,
                                                avatarColorHex: p.avatar_color_hex,
                                            }])}
                                            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/40 bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border/70 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                                        >
                                            Add as account
                                        </button>
                                    )}
                                    <Button variant="ghost" size="icon" className="h-7 w-7 flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground" onClick={() => { setEditId(p.id); setEditName(p.name) }} disabled={actionsDisabled} aria-label="Rename">
                                        <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 flex items-center justify-center shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setConfirm(p)} disabled={actionsDisabled} aria-label="Delete">
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </>
                            )}
                        </div>
                        )
                    })}

                    {unclaimedProfiles.length >= 2 && (
                        <div className="flex justify-end pt-1">
                            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={doQuickAddAll} disabled={addDisabled}>
                                <Plus className="h-3.5 w-3.5" />
                                Add all unclaimed ({unclaimedProfiles.length})
                            </Button>
                        </div>
                    )}

                    {confirm && (
                        <div className="rounded-2xl border border-destructive/30 bg-destructive/8 p-4 space-y-3 shadow-sm">
                            <p className="text-sm font-medium text-destructive">Delete <strong>{confirm.name}</strong>?</p>
                            <p className="text-xs text-muted-foreground">This removes the profile and all its data on Nuvio (addons, plugins, collections, library and watch history) and can't be undone.</p>
                            {isTargetProfile(confirm) && (
                                <p className="rounded-xl bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-warning">
                                    {confirm.name} is this account's {target.isDefault ? 'default push profile (no explicit target is set, so Nuvio pushes land on the primary profile)' : 'active sync target'}. Switch the sync target to another profile above first, then delete.
                                </p>
                            )}
                            <div className="flex gap-2">
                                <Button size="sm" variant="subtle" className="h-8 flex-1 text-xs" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
                                <Button size="sm" variant="destructive" className="h-8 flex-1 text-xs" onClick={doDelete} disabled={actionsDisabled || isTargetProfile(confirm)}>Delete profile</Button>
                            </div>
                        </div>
                    )}

                    {canCreate && (
                        <div className="flex gap-2 pt-2 border-t border-border/40 mt-2">
                            <Input
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                placeholder={`New profile name (slot ${nextIdx})`}
                                className="h-8 flex-1 text-xs"
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); doCreate() } }}
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
                    email={connection.credentials?.email || undefined}
                    entries={quickAddEntries}
                    onClose={() => { setQuickAddEntries(null); reload() }}
                />
            )}
        </div>
    )
}

// Separate from ProfilesSection: lets the user choose which profile this
// account's addons push to. Shares the tab's profile list, so a create or
// delete in the manager lands here on the same render instead of leaving a
// stale target behind.

function NuvioProfilePicker({ accountId, connection, activeProfileId, profiles, loading, error, reload }: {
    accountId: string
    connection: Connection
    activeProfileId?: string | null
    profiles: NuvioProfileRow[]
    loading: boolean
    error: string | null
    reload: () => Promise<void>
}) {
    const [switching, setSwitching] = useState(false)
    const [pending, setPending] = useState<NuvioTargetProfile | null>(null)

    // Mirror the writer: mapping > profileIndex > profileId, digits resolve as
    // an index and anything else as a UUID. An empty stored target means the
    // driver's primary-profile default is the effective target.
    const currentId = useMemo(
        () => storedNuvioTargetId({ credentials: connection.credentials, profileMapping: connection.profileMapping, activeProfileId }),
        [connection.credentials, connection.profileMapping, activeProfileId],
    )
    const target = useMemo(
        () => resolveNuvioSyncTarget(
            profiles.map(p => ({ id: p.id, index: p.profile_index, name: p.name })),
            currentId,
        ),
        [profiles, currentId],
    )
    // A stale or still-loading list cannot back a target switch.
    const switchDisabled = switching || loading || !!error

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
            toast({ title: `Switched to ${p.name}` })
            syncConnections(accountId).catch((err) => {
                toast({ title: 'Profile switched, but sync did not finish', description: err instanceof Error ? err.message : 'Addons may not have pushed to the new profile yet.', variant: 'destructive' })
            })
        } catch (err) {
            toast({ title: 'Could not switch profile', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' })
        } finally {
            setSwitching(false)
            setPending(null)
        }
    }, [accountId, connection.id, connection.credentials, connection.profileMapping, activeProfileId, switchDisabled])

    if (loading && profiles.length === 0) {
        return (
            <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading profiles…
            </div>
        )
    }

    if (error && profiles.length === 0) {
        return (
            <div className="space-y-2">
                <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">{error}</div>
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void reload()}>
                    <RefreshCw className="h-3 w-3" />
                    Retry
                </Button>
            </div>
        )
    }

    if (profiles.length === 0) {
        return <p className="py-2 text-xs text-muted-foreground">No profiles found. Create one below.</p>
    }

    return (
        <div className="space-y-1.5">
            {error && (
                <div className="rounded-xl bg-warning/10 border border-warning/20 px-3 py-2 text-[11px] text-muted-foreground flex items-center gap-2">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1">Showing last known profiles. Switching is off until the list refreshes.</span>
                    <Button variant="ghost" size="sm" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => void reload()}>Retry</Button>
                </div>
            )}
            {target.danglingId && (
                <div className="rounded-xl bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-warning flex items-start gap-2">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                        Sync target profile {target.danglingId} no longer exists on Nuvio. Pick a new target below; pushes to the missing profile are refused until you switch.
                    </span>
                </div>
            )}
            {target.isDefault && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                    No explicit target is stored yet, so pushes go to the primary profile. Choosing a target below records it.
                </p>
            )}
            {profiles.map(p => {
                const active = !!target.active && target.active.id === p.id && target.active.index === p.profile_index
                return (
                    <button
                        key={p.id || p.profile_index}
                        type="button"
                        disabled={switchDisabled}
                        onClick={() => { if (!active) setPending({ id: p.id, index: p.profile_index, name: p.name }) }}
                        className={cn(
                            'flex w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left text-sm transition-[background-color,border-color,box-shadow,transform] duration-200',
                            active
                                ? 'border-primary/30 bg-primary/10 text-foreground shadow-sm cursor-default'
                                : 'border-border/40 bg-card text-foreground shadow-sm hover:-translate-y-0.5 hover:border-border/70 hover:bg-card/95 hover:shadow-md',
                            switchDisabled && 'pointer-events-none opacity-60'
                        )}
                    >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-[11px] font-bold text-muted-foreground">
                            {p.profile_index}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                        {active && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/12 px-1.5 py-0.5 text-[11px] font-medium text-primary shrink-0">
                                <Check className="h-3 w-3" />
                                {target.isDefault ? 'Active (default)' : 'Active'}
                            </span>
                        )}
                    </button>
                )
            })}
            {pending && (
                <div className="rounded-2xl border border-warning/30 bg-warning/8 p-4 space-y-3 shadow-sm">
                    <p className="text-sm font-medium text-warning">Switch sync target to <strong>{pending.name}</strong>?</p>
                    <p className="text-xs text-muted-foreground">This replaces that profile's current addons on Nuvio and can't be undone.</p>
                    <div className="flex gap-2">
                        <Button size="sm" variant="subtle" className="h-8 flex-1 text-xs" onClick={() => setPending(null)} disabled={switching}>Cancel</Button>
                        <Button size="sm" className="h-8 flex-1 text-xs" onClick={() => doSwitch(pending)} disabled={switchDisabled}>
                            {switching ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Switching…</> : 'Switch & sync'}
                        </Button>
                    </div>
                </div>
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
        <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
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
    // One profile list feeds the picker and the manager, so a create or delete
    // through either updates both and a deleted target can never linger. The
    // read is gated on the tab's own eligibility: an expired or incapable
    // connection must not issue profile reads at all.
    const identity = nuvioReadIdentity(accountId, connection, false)
    const load = useCallback(() => readNuvioProfiles(accountId, connection), [accountId, connection])
    const { data, loading, error, reload } = useNuvioResource<NuvioProfileRow[]>(load, identity, canSwitchProfile)
    const profiles = data || []

    if (!canSwitchProfile) {
        return (
            <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
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
        <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
            <div className="space-y-6">
                <div className="space-y-3 rounded-xl border border-border/30 bg-muted/15 p-3.5">
                    <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-muted/40 text-muted-foreground">
                            <Crosshair className="h-3.5 w-3.5" />
                        </span>
                        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Sync target</p>
                    </div>
                    <p className="text-xs text-muted-foreground -mt-1">Choose which profile this account's addons push to.</p>
                    <NuvioProfilePicker
                        accountId={accountId}
                        connection={connection}
                        activeProfileId={activeProfileId}
                        profiles={profiles}
                        loading={loading}
                        error={error}
                        reload={reload}
                    />
                </div>
                <div className={cn('space-y-3 rounded-xl border border-border/30 bg-muted/15 p-3.5', canSwitchProfile && 'pt-3.5')}>
                    <ProfilesSection
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
            </div>
        </div>
    )
}

export function NuvioLibraryTab({ accountId, connection }: { accountId: string; connection: Connection }) {
    return (
        <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
            <LibrarySection accountId={accountId} connection={connection} />
        </div>
    )
}

export function NuvioCollectionsTab({ accountId, connection }: { accountId: string; connection: Connection }) {
    return (
        <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
            <CollectionsSection accountId={accountId} connection={connection} />
        </div>
    )
}

export function NuvioBackupTab({ accountId, connection }: { accountId: string; connection: Connection }) {
    return (
        <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm space-y-3">
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
