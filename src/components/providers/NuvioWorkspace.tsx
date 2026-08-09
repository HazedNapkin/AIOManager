import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Loader2, Pencil, Check, X, Trash2, Plus, BookOpen, Layers, User } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { fetchConnectionToken } from '@/api/connection'
import { nuvioDriverFor } from '@/lib/drivers/factory'

const errMsg = (e: unknown, fallback = 'Try again.') => (e instanceof Error ? e.message : fallback)

function useNuvioResource<T>(load: () => Promise<T>) {
    const [data, setData] = useState<T | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const cancelled = useRef(false)

    const reload = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const result = await load()
            if (!cancelled.current) setData(result)
        } catch (err) {
            if (!cancelled.current) setError(err instanceof Error ? err.message : 'Could not load. Try re-authenticating this connection.')
        } finally {
            if (!cancelled.current) setLoading(false)
        }
    }, [load])

    useEffect(() => {
        cancelled.current = false
        reload()
        return () => { cancelled.current = true }
    }, [reload])
    return { data, loading, error, reload }
}

function TabToolbar({ label, count, loading, onReload }: {
    label?: string
    count?: number
    loading: boolean
    onReload: () => void
}) {
    return (
        <div className="flex items-center gap-2 mb-4">
            {label && (
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground flex-1">{label}</p>
            )}
            {!label && <span className="flex-1" />}
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

function LibrarySection({ accountId, connection }: { accountId: string; connection: Connection }) {
    const load = useCallback(() => readNuvioLibrary(accountId, connection), [accountId, connection])
    const { data, loading, error, reload } = useNuvioResource<NuvioLibraryItem[]>(load)
    const items = data || []

    return (
        <div>
            <TabToolbar label="Library" count={data ? items.length : undefined} loading={loading} onReload={reload} />
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
    const load = useCallback(() => readNuvioCollections(accountId, connection), [accountId, connection])
    const { data, loading, error, reload } = useNuvioResource<NuvioCollection[]>(load)
    const collections = data || []

    return (
        <div>
            <TabToolbar label="Collections" count={data ? collections.length : undefined} loading={loading} onReload={reload} />
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

function ProfilesSection({ accountId, connection }: { accountId: string; connection: Connection }) {
    const load = useCallback(() => readNuvioProfiles(accountId, connection), [accountId, connection])
    const { data, loading, error, reload } = useNuvioResource<NuvioProfileRow[]>(load)
    const profiles = data || []
    const [busy, setBusy] = useState(false)
    const [editId, setEditId] = useState<string | null>(null)
    const [editName, setEditName] = useState('')
    const [newName, setNewName] = useState('')
    const [confirm, setConfirm] = useState<NuvioProfileRow | null>(null)

    const used = new Set(profiles.map(p => p.profile_index))
    let nextIdx = 1
    while (used.has(nextIdx) && nextIdx <= 4) nextIdx++
    const canCreate = nextIdx <= 4

    const doRename = async (p: NuvioProfileRow) => {
        const name = editName.trim()
        if (!name || name === p.name) { setEditId(null); return }
        setBusy(true)
        try { await renameNuvioProfile(accountId, connection, p.id, name); setEditId(null); await reload(); toast({ title: 'Profile renamed' }) }
        catch (e) { toast({ title: 'Rename failed', description: errMsg(e), variant: 'destructive' }) }
        finally { setBusy(false) }
    }
    const doCreate = async () => {
        const name = newName.trim()
        if (!name || !canCreate) return
        setBusy(true)
        try { await createNuvioProfile(accountId, connection, { profileIndex: nextIdx, name }); setNewName(''); await reload(); toast({ title: 'Profile created' }) }
        catch (e) { toast({ title: 'Create failed', description: errMsg(e), variant: 'destructive' }) }
        finally { setBusy(false) }
    }
    const doDelete = async () => {
        if (!confirm) return
        setBusy(true)
        try { await deleteNuvioProfile(accountId, connection, confirm.profile_index); setConfirm(null); await reload(); toast({ title: 'Profile deleted' }) }
        catch (e) { toast({ title: 'Delete failed', description: errMsg(e), variant: 'destructive' }) }
        finally { setBusy(false) }
    }

    return (
        <div>
            <TabToolbar label="Manage profiles" count={data ? profiles.length : undefined} loading={loading} onReload={reload} />
            {error ? <TabError message={error} onRetry={reload} /> : loading ? <TabLoading /> : (
                <div className="space-y-1.5">
                    {profiles.length === 0 && (
                        <EmptyState
                            icon={<User className="h-5 w-5" />}
                            title="No profiles yet"
                            description="Create your first Nuvio profile below."
                        />
                    )}

                    {profiles.map(p => (
                        <div
                            key={p.id}
                            className="flex items-center gap-3 rounded-2xl border border-border/40 bg-card shadow-sm px-3.5 py-2.5 transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border/70 hover:bg-card/95 hover:shadow-md"
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
                                    <Button variant="ghost" size="icon" className="h-7 w-7 flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground" onClick={() => { setEditId(p.id); setEditName(p.name) }} disabled={busy} aria-label="Rename">
                                        <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 flex items-center justify-center shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setConfirm(p)} disabled={busy} aria-label="Delete">
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </>
                            )}
                        </div>
                    ))}

                    {confirm && (
                        <div className="rounded-2xl border border-destructive/30 bg-destructive/8 p-4 space-y-3 shadow-sm">
                            <p className="text-sm font-medium text-destructive">Delete <strong>{confirm.name}</strong>?</p>
                            <p className="text-xs text-muted-foreground">This removes the profile and all its data on Nuvio (addons, plugins, collections, library and watch history) and can't be undone.</p>
                            <div className="flex gap-2">
                                <Button size="sm" variant="subtle" className="h-8 flex-1 text-xs" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
                                <Button size="sm" variant="destructive" className="h-8 flex-1 text-xs" onClick={doDelete} disabled={busy}>Delete profile</Button>
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
                            <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5 text-xs" onClick={doCreate} disabled={busy || !newName.trim()}>
                                <Plus className="h-3.5 w-3.5" /> Add
                            </Button>
                        </div>
                    )}
                    {!canCreate && (
                        <p className="pt-2 text-[11px] text-muted-foreground border-t border-border/40 mt-2">Nuvio allows up to 4 profiles per account.</p>
                    )}
                </div>
            )}
        </div>
    )
}

// Separate from ProfilesSection: lets the user choose which profile this
// account's addons push to. Loads on mount since it's always visible.

interface NuvioProfile { id: string; index: number; name: string }

function NuvioProfilePicker({ accountId, connection }: { accountId: string; connection: Connection }) {
    const [profiles, setProfiles] = useState<NuvioProfile[]>([])
    const [loading, setLoading] = useState(true)
    const [switching, setSwitching] = useState(false)
    const [pending, setPending] = useState<NuvioProfile | null>(null)

    const nuvioSessionDriver = useMemo(() => nuvioDriverFor(connection), [connection.id, connection.credentials?.baseUrl, connection.credentials?.publishableKey])

    const currentId = connection.credentials?.profileId || ''
    const matches = (p: NuvioProfile) => p.id === currentId || String(p.index) === String(currentId)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        fetchConnectionToken(accountId, connection.id, 'nuvio')
            .then(token => nuvioSessionDriver.pullProfiles(token.accessToken))
            .then(rows => {
                if (!cancelled) setProfiles(rows.map(r => ({
                    id: String(r.id ?? ''),
                    index: Number(r.profile_index ?? r.profileIndex ?? 0),
                    name: String(r.name ?? 'Profile'),
                })))
            })
            .catch(err => {
                if (!cancelled) toast({ title: 'Could not load Nuvio profiles', description: err instanceof Error ? err.message : 'Try re-authenticating.', variant: 'destructive' })
            })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [accountId, connection.id, nuvioSessionDriver])

    const doSwitch = useCallback(async (p: NuvioProfile) => {
        const profileKey = p.index > 0 ? String(p.index) : p.id
        if (!profileKey) { toast({ title: 'Profile has no usable id', variant: 'destructive' }); return }
        setSwitching(true)
        try {
            const { setConnectionProfile } = await import('@/api/connection')
            await setConnectionProfile(connection.id, profileKey)
            const { updateConnection, syncConnections } = (await import('@/store/connectionStore')).useConnectionStore.getState()
            updateConnection(accountId, connection.id, { credentials: { ...connection.credentials, profileId: profileKey } })
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
    }, [accountId, connection.id, connection.credentials])

    if (loading) {
        return (
            <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading profiles…
            </div>
        )
    }

    if (profiles.length === 0) {
        return <p className="py-2 text-xs text-muted-foreground">No profiles found.</p>
    }

    return (
        <div className="space-y-1.5">
            {profiles.map(p => {
                const active = matches(p)
                return (
                    <button
                        key={p.id || p.index}
                        type="button"
                        disabled={switching}
                        onClick={() => { if (!active) setPending(p) }}
                        className={cn(
                            'flex w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left text-sm transition-[background-color,border-color,box-shadow,transform] duration-200',
                            active
                                ? 'border-primary/30 bg-primary/10 text-foreground shadow-sm cursor-default'
                                : 'border-border/40 bg-card text-foreground shadow-sm hover:-translate-y-0.5 hover:border-border/70 hover:bg-card/95 hover:shadow-md',
                            switching && 'pointer-events-none opacity-60'
                        )}
                    >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-[11px] font-bold text-muted-foreground">
                            {p.index}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                        {active && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/12 px-1.5 py-0.5 text-[11px] font-medium text-primary shrink-0">
                                <Check className="h-3 w-3" />
                                Active
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
                        <Button size="sm" className="h-8 flex-1 text-xs" onClick={() => doSwitch(pending)} disabled={switching}>
                            {switching ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Switching…</> : 'Switch & sync'}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}

export function NuvioConnectionWorkspace({
    accountId,
    connection,
    status,
}: {
    accountId: string
    connection: Connection
    status?: ConnectionStatus
}) {
    const canSwitchProfile = status !== 'expired' && connection.capabilities.includes('profiles')
    const [tab, setTab] = useState('plugins')

    return (
        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
            <TabsList>
                <TabsTrigger value="plugins">Plugins</TabsTrigger>
                <TabsTrigger value="profiles">Profiles</TabsTrigger>
                <TabsTrigger value="library">Library</TabsTrigger>
                <TabsTrigger value="collections">Collections</TabsTrigger>
            </TabsList>


            <TabsContent value="plugins">
                <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
                    <NuvioPluginsPanel accountId={accountId} connection={connection} />
                </div>
            </TabsContent>


            <TabsContent value="profiles">
                <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
                    <div className="space-y-6">
                        {canSwitchProfile && (
                            <div className="space-y-3">
                                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Sync target</p>
                                <p className="text-xs text-muted-foreground -mt-1.5">Choose which profile this account's addons push to.</p>
                                <NuvioProfilePicker accountId={accountId} connection={connection} />
                            </div>
                        )}
                        <div className={cn('space-y-3', canSwitchProfile && 'border-t border-border/40 pt-6')}>
                            <ProfilesSection accountId={accountId} connection={connection} />
                        </div>
                    </div>
                </div>
            </TabsContent>


            <TabsContent value="library">
                <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
                    <LibrarySection accountId={accountId} connection={connection} />
                </div>
            </TabsContent>


            <TabsContent value="collections">
                <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
                    <CollectionsSection accountId={accountId} connection={connection} />
                </div>
            </TabsContent>
        </Tabs>
    )
}
