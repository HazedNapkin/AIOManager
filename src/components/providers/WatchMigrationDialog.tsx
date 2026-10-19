import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Download, Loader2, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatusChip } from '@/components/ui/status-chip'
import { EmptyState } from '@/components/common/EmptyState'
import { useAccountStore } from '@/store/accountStore'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { decrypt } from '@/lib/crypto'
import { maskEmailLevel, maskNameLevel, maskProfileLevel } from '@/lib/utils'
import { createJellyfinWatchDestination } from '@/lib/watch-state/jellyfin'
import { createWatchMigrationSource, migrationSourceLabel, watchMigrationSources } from '@/lib/watch-state/sources'
import { executeWatchMigration, migrationReport, planWatchMigration } from '@/lib/watch-state/migration'
import { formatWatchPosition } from '@/lib/watch-state/records'
import type { MigrationResult, MigrationRow, WatchMigrationPlan, WatchStateDestination, WatchStateRecord, WatchStateSource } from '@/lib/watch-state/types'
import { refreshJellyfinMedia } from './useJellyfinMedia'
import type { Account } from '@/types/account'
import type { Connection } from '@/types/connection'

interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    accountId: string
    connection: Connection
}

interface MigrationSession {
    key: CryptoKey
    source: WatchStateSource
    destination: WatchStateDestination
    sourceAccountId: string
    sourceId: string
    sourceStamp: string
    destinationStamp: string
}

function connectionStamp(account: Account | undefined, connectionId: string): string {
    if (!account) return ''
    const connection = watchMigrationSources(account).find(item => item.id === connectionId)
    if (!connection?.enabled) return ''
    return JSON.stringify([account.id, connection.id, connection.platform, connection.connectionType, connection.credentials, connection.mediaServer, connection.profileMapping, account.authKey])
}

function stateLabel(record: Pick<WatchStateRecord, 'watched' | 'positionMs'> & Partial<Pick<WatchStateRecord, 'playedAt' | 'playCount'>>): string {
    const values = []
    if (record.watched === true) values.push('Watched')
    else if (record.watched === false) values.push('Unwatched')
    if (record.positionMs !== undefined && record.positionMs > 0) values.push(`Resume ${formatWatchPosition(record.positionMs)}`)
    if (record.playedAt !== undefined && record.playedAt !== null) values.push(`Last played ${new Date(record.playedAt).toLocaleString()}`)
    if (record.playCount !== undefined && record.playCount > 0) values.push(`${record.playCount.toLocaleString()} ${record.playCount === 1 ? 'play' : 'plays'}`)
    return values.join(' · ') || 'No saved value'
}

function statusLabel(status: MigrationRow['status'] | MigrationResult['status']): string {
    if (status === 'ready') return 'Ready'
    if (status === 'applied') return 'Verified'
    if (status === 'unchanged') return 'Already saved'
    if (status === 'conflict') return 'Kept'
    if (status === 'failed') return 'Check before retry'
    if (status === 'unsupported') return 'Unsupported'
    return 'Skipped'
}

function migrationErrorMessage(error: unknown, fallback: string): string {
    const messages = [
        'The destination library could not be read completely, so matches cannot be verified safely. Try the preview again.',
        'The destination sign-in expired. Reconnect and preview again.',
        'The destination changed. Preview again before importing.',
        'The source user or profile changed. Preview again before importing.',
        'The write could not be verified. Preview again before continuing.',
    ]
    return error instanceof Error && messages.includes(error.message) ? error.message : fallback
}

export function WatchMigrationDialog({ open, onOpenChange, accountId, connection }: Props) {
    const accounts = useAccountStore(state => state.accounts)
    const encryptionKey = useAuthStore(state => state.encryptionKey)
    const privacy = useUIStore(state => state.isPrivacyModeEnabled)
    const nameLevel = useUIStore(state => state.privacyLevelNames)
    const emailLevel = useUIStore(state => state.privacyLevelEmail)
    const profileLevel = useUIStore(state => state.privacyLevelProfiles)
    const [sourceAccountId, setSourceAccountId] = useState(accountId)
    const [sourceId, setSourceId] = useState('')
    const [watched, setWatched] = useState(true)
    const [resume, setResume] = useState(true)
    const [plan, setPlan] = useState<WatchMigrationPlan | null>(null)
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [results, setResults] = useState<MigrationResult[]>([])
    const [busy, setBusy] = useState<'preview' | 'import' | null>(null)
    const [progress, setProgress] = useState('')
    const [error, setError] = useState('')
    const [search, setSearch] = useState('')
    const [filter, setFilter] = useState('all')
    const [page, setPage] = useState(0)
    const request = useRef<AbortController | null>(null)
    const stopButton = useRef<HTMLButtonElement>(null)
    const session = useRef<MigrationSession | null>(null)
    const sourceAccount = accounts.find(account => account.id === sourceAccountId)
    const sources = useMemo(() => sourceAccount ? watchMigrationSources(sourceAccount).filter(item => item.id !== connection.id || sourceAccount.id !== accountId) : [], [sourceAccount, accountId, connection.id])
    const displayName = (value: string) => value.includes('@') ? maskEmailLevel(value, privacy ? emailLevel : 0) : maskNameLevel(value, privacy ? nameLevel : 0)
    const identifier = (value: string) => maskProfileLevel(value, privacy ? profileLevel : 0)

    useEffect(() => {
        if (busy) stopButton.current?.focus()
    }, [busy])

    useEffect(() => {
        if (!open) return
        const check = () => {
            const current = session.current
            if (!current) return
            const currentAccounts = useAccountStore.getState().accounts
            if (useAuthStore.getState().encryptionKey !== current.key
                || connectionStamp(currentAccounts.find(account => account.id === current.sourceAccountId), current.sourceId) !== current.sourceStamp
                || connectionStamp(currentAccounts.find(account => account.id === accountId), connection.id) !== current.destinationStamp) {
                request.current?.abort()
                session.current = null
                setPlan(null)
                setResults([])
                setSelected(new Set())
                setError('The vault, source or destination changed. Unlock and preview again.')
            }
        }
        const stopHidden = () => { if (document.hidden) request.current?.abort() }
        const stop = () => { request.current?.abort() }
        const accountsUnsubscribe = useAccountStore.subscribe(check)
        const authUnsubscribe = useAuthStore.subscribe(check)
        document.addEventListener('visibilitychange', stopHidden)
        window.addEventListener('pagehide', stop)
        return () => {
            stop()
            session.current = null
            accountsUnsubscribe()
            authUnsubscribe()
            document.removeEventListener('visibilitychange', stopHidden)
            window.removeEventListener('pagehide', stop)
        }
    }, [open, accountId, connection.id])

    const reset = () => {
        request.current?.abort()
        session.current = null
        setPlan(null)
        setResults([])
        setSelected(new Set())
        setProgress('')
        setError('')
        setSearch('')
        setFilter('all')
        setPage(0)
    }

    const preview = async () => {
        if (request.current || !sourceAccount || !sourceId || !encryptionKey) return
        const controller = new AbortController()
        request.current = controller
        session.current = null
        setBusy('preview')
        setError('')
        setProgress('Verifying the source and destination users…')
        const sourceStamp = connectionStamp(sourceAccount, sourceId)
        const destinationAccount = useAccountStore.getState().accounts.find(account => account.id === accountId)
        const destinationStamp = connectionStamp(destinationAccount, connection.id)
        try {
            if (!sourceStamp || !destinationStamp || !connection.enabled) throw new Error('Connection disabled')
            const [source, destination] = await Promise.all([
                createWatchMigrationSource(sourceAccount, encryptionKey, sourceId, controller.signal),
                createJellyfinWatchDestination(connection, value => decrypt(value, encryptionKey), controller.signal),
            ])
            controller.signal.throwIfAborted()
            const current = useAccountStore.getState().accounts
            if (useAuthStore.getState().encryptionKey !== encryptionKey
                || sourceStamp !== connectionStamp(current.find(account => account.id === sourceAccountId), sourceId)
                || destinationStamp !== connectionStamp(current.find(account => account.id === accountId), connection.id)) throw new Error('Connection changed')
            const context = { key: encryptionKey, source, destination, sourceAccountId, sourceId, sourceStamp, destinationStamp }
            session.current = context
            const snapshot = await source.read(controller.signal, setProgress)
            controller.signal.throwIfAborted()
            if (snapshot.scope === destination.scope) {
                session.current = null
                setError('The source and destination are the same remote user. Choose another account or connection.')
                setProgress('')
                return
            }
            const result = await planWatchMigration(snapshot, destination, { watched, resume }, controller.signal, setProgress)
            controller.signal.throwIfAborted()
            if (session.current !== context) throw new Error('Connection changed')
            setPlan(result)
            setResults([])
            setSelected(new Set(result.rows.filter(row => row.status === 'ready').map(row => row.id)))
            setPage(0)
            setProgress('Preview ready. Choose the titles to import.')
        } catch (cause) {
            if (controller.signal.aborted) setProgress('Preview stopped. Preview again when ready.')
            else setError(migrationErrorMessage(cause, 'Could not build the preview. Test both connections, verify the selected user or profile, then try again.'))
            session.current = null
        } finally {
            controller.abort()
            if (request.current === controller) request.current = null
            setBusy(null)
        }
    }

    const run = async () => {
        const current = session.current
        if (!current || !plan || request.current) return
        const controller = new AbortController()
        request.current = controller
        setBusy('import')
        setError('')
        const pending = new Map(results.map(result => [result.rowId, result]))
        let changed = false
        let lastUpdate = 0
        const publish = () => {
            if (changed && session.current === current) setResults([...pending.values()])
            changed = false
            lastUpdate = performance.now()
        }
        try {
            await executeWatchMigration(plan, current.source, current.destination, selected, results, controller.signal, result => {
                pending.set(result.rowId, result)
                changed = true
                if (performance.now() - lastUpdate >= 250 || result.status === 'failed') publish()
            }, setProgress)
            controller.signal.throwIfAborted()
            setProgress('Import finished. Review the verified results and any skipped titles.')
        } catch (cause) {
            setProgress(controller.signal.aborted ? 'Import stopped. Previously verified items are kept. Check unfinished items before retrying.' : '')
            if (!controller.signal.aborted) setError(migrationErrorMessage(cause, 'The import stopped. Test both connections and preview again before continuing.'))
        } finally {
            publish()
            controller.abort()
            refreshJellyfinMedia(accountId, connection.id)
            if (request.current === controller) request.current = null
            setBusy(null)
        }
    }

    const byResult = useMemo(() => new Map(results.map(result => [result.rowId, result])), [results])
    const ready = useMemo(() => plan?.rows.filter(row => row.status === 'ready') || [], [plan])
    const remaining = useMemo(() => ready.filter(row => selected.has(row.id) && !['applied', 'unchanged', 'conflict'].includes(byResult.get(row.id)?.status || '')), [ready, selected, byResult])
    const searchRows = useMemo(() => plan?.rows.map(row => ({ row, title: row.source.title.toLocaleLowerCase() })) || [], [plan])
    const matchingRows = useMemo(() => {
        const query = search.toLocaleLowerCase()
        return searchRows.filter(item => item.title.includes(query)).map(item => item.row)
    }, [searchRows, search])
    const visibleRows = useMemo(() => filter === 'all' ? matchingRows : matchingRows.filter(row => {
        const status = byResult.get(row.id)?.status || row.status
        return status === filter
    }), [matchingRows, byResult, filter])
    const pageCount = Math.max(1, Math.ceil(visibleRows.length / 50))
    const shownPage = Math.min(page, pageCount - 1)
    const verifiedCount = useMemo(() => results.filter(result => result.status === 'applied' || result.status === 'unchanged').length, [results])

    const download = () => {
        if (!plan) return
        const url = URL.createObjectURL(new Blob([JSON.stringify(migrationReport(plan, results), null, 2)], { type: 'application/json' }))
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = 'watch-state-import-report.json'
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1_000)
    }

    return (
        <Dialog open={open} onOpenChange={value => { if (!value) reset(); onOpenChange(value) }}>
            <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-h-[90dvh] sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Import watch state</DialogTitle>
                    <DialogDescription>Copy saved watched flags and resume points into this media connection. Existing destination history is kept.</DialogDescription>
                </DialogHeader>
                <div className="min-h-0 space-y-4 overflow-y-auto px-1 pb-1">
                    <div className="rounded-xl border border-border/40 bg-muted/20 p-3 text-sm space-y-1">
                        <p className="text-xs font-medium uppercase text-muted-foreground">Destination</p>
                        <p className="font-semibold break-words">{displayName(connection.displayName || connection.mediaServer?.productName || 'Jellyfin-compatible server')}</p>
                        <p className="break-words">User: {displayName(plan?.destination.subject || connection.mediaServer?.userName || 'Sign-in required')}</p>
                        <p className="text-xs text-muted-foreground break-all">User ID: {identifier(connection.mediaServer?.userId || 'Unavailable')}</p>
                        <p className="text-xs text-muted-foreground">To use another destination user, add that user as a connection first.</p>
                    </div>
                    {!plan ? <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="migration-source-account">Source account</Label>
                                <Select value={sourceAccountId} onValueChange={value => { setSourceAccountId(value); setSourceId('') }} disabled={!!busy}>
                                    <SelectTrigger id="migration-source-account"><SelectValue placeholder="Choose an account" /></SelectTrigger>
                                    <SelectContent>{accounts.map(account => <SelectItem key={account.id} value={account.id}>{displayName(account.name)}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="migration-source-connection">Source connection</Label>
                                <Select value={sourceId} onValueChange={setSourceId} disabled={!!busy || !sources.length}>
                                    <SelectTrigger id="migration-source-connection"><SelectValue placeholder={sources.length ? 'Choose a connection' : 'No enabled source connections'} /></SelectTrigger>
                                    <SelectContent>{sources.map(source => <SelectItem key={source.id} value={source.id}>{displayName(migrationSourceLabel(source))}{source.mediaServer?.userName ? ` · ${displayName(source.mediaServer.userName)}` : ''}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-4">
                            <div className="flex items-center gap-2"><Checkbox id="migration-watched" checked={watched} onCheckedChange={value => setWatched(value === true)} disabled={!!busy} /><Label htmlFor="migration-watched">Watched titles</Label></div>
                            <div className="flex items-center gap-2"><Checkbox id="migration-resume" checked={resume} onCheckedChange={value => setResume(value === true)} disabled={!!busy} /><Label htmlFor="migration-resume">Resume points</Label></div>
                        </div>
                        <p className="text-sm text-muted-foreground">The preview lists exact matches, existing state and unsupported fields. This copies saved state; platforms may not expose every viewing event or original watch date.</p>
                    </div> : <div className="space-y-4">
                        <div className="rounded-xl border border-border/40 p-3 space-y-2">
                            <p className="text-sm font-semibold break-words">{displayName(plan.source.label)} · {displayName(plan.source.subject)} <ArrowRight className="inline h-4 w-4" aria-hidden="true" /> {displayName(plan.destination.label)} · {displayName(plan.destination.subject)}</p>
                            <p className="text-sm">{plan.source.records.length.toLocaleString()} source records · {ready.length.toLocaleString()} ready · {verifiedCount.toLocaleString()} verified</p>
                            {!plan.source.complete && <p className="text-sm text-warning">Partial source read. Only the records listed here can be imported.</p>}
                            <ul className="space-y-1 text-xs text-muted-foreground">{plan.notes.map(note => <li key={note}>{note}</li>)}</ul>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Input aria-label="Search import titles" placeholder="Search titles…" value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} className="min-w-0 flex-1" />
                            <Select value={filter} onValueChange={value => { setFilter(value); setPage(0) }}>
                                <SelectTrigger aria-label="Filter import status" className="w-44"><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="all">All records</SelectItem>{(['ready', 'unchanged', 'conflict', 'skipped', 'unsupported', 'applied', 'failed'] as const).map(status => <SelectItem key={status} value={status}>{statusLabel(status)}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            <Button size="sm" variant="subtle" disabled={!!busy} onClick={() => setSelected(new Set(ready.map(row => row.id)))}>Select ready</Button>
                            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setSelected(new Set())}>Clear selection</Button>
                            <span className="text-muted-foreground">{remaining.length.toLocaleString()} selected to import</span>
                        </div>
                        {visibleRows.length ? <ul aria-label="Import preview" className="space-y-2">{visibleRows.slice(shownPage * 50, (shownPage + 1) * 50).map(row => {
                            const result = byResult.get(row.id)
                            const status = result?.status || row.status
                            return <li key={row.id} className="rounded-xl border border-border/40 p-3 space-y-2">
                                <div className="flex items-start gap-3">
                                    {row.status === 'ready' && <Checkbox aria-label={`Import ${row.source.title}${row.source.type === 'episode' ? ` season ${row.source.season} episode ${row.source.episode}` : ''}`} checked={selected.has(row.id)} disabled={!!busy || !!result && result.status !== 'failed'} onCheckedChange={value => setSelected(previous => { const next = new Set(previous); if (value === true) next.add(row.id); else next.delete(row.id); return next })} />}
                                    <p className="min-w-0 flex-1 break-words text-sm font-semibold">{row.source.title}{row.source.type === 'episode' ? ` · S${row.source.season} E${row.source.episode}` : ''}</p>
                                    <StatusChip size="sm" variant={status === 'applied' ? 'success' : status === 'failed' ? 'destructive' : 'muted'}>{statusLabel(status)}</StatusChip>
                                </div>
                                <p className="text-xs text-muted-foreground">Source: {stateLabel(row.source)}{row.target ? ` · Destination: ${stateLabel(row.target)}` : ''}</p>
                                {row.status === 'ready' && row.patch && !result && <p className="text-xs text-muted-foreground">Will add: {stateLabel(row.patch)}</p>}
                                {result?.verified && <p className="text-xs text-muted-foreground">Verified destination: {stateLabel(result.verified)}</p>}
                                <p className="text-sm">{result?.message || row.reason}</p>
                                {row.target && <p className="break-all font-mono text-xs text-muted-foreground">Destination item: {row.target.id}</p>}
                                {row.notes.map(note => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
                            </li>
                        })}</ul> : <EmptyState title="No matching records" description="Choose another filter or source to review more saved state." />}
                        {pageCount > 1 && <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><Button size="sm" variant="outline" disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>Previous</Button><span>Page {shownPage + 1} of {pageCount}</span><Button size="sm" variant="outline" disabled={shownPage + 1 === pageCount} onClick={() => setPage(shownPage + 1)}>Next</Button></div>}
                        <p className="text-xs text-muted-foreground">Each write is checked again before saving and verified afterward. This destination may forward changes to its configured trackers. Closing, locking the vault or leaving the tab stops this run. Preview again after reloading; already saved items are skipped.</p>
                    </div>}
                    <div aria-live="polite" className="text-sm text-muted-foreground">{busy && <Loader2 className="inline h-4 w-4 animate-spin" aria-hidden="true" />} {progress}</div>
                    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                </div>
                <DialogFooter className="flex-wrap gap-2">
                    {busy ? <Button ref={stopButton} variant="outline" onClick={() => request.current?.abort()}><Square className="h-4 w-4" />Stop</Button> : <Button variant="ghost" onClick={() => { reset(); onOpenChange(false) }}>Close</Button>}
                    {plan && !busy && <Button variant="outline" onClick={reset}>Change source / preview again</Button>}
                    {plan && <Button variant="outline" onClick={download} disabled={!!busy}><Download className="h-4 w-4" />Export report</Button>}
                    {!plan ? <Button onClick={() => void preview()} disabled={!!busy || !sourceId || !encryptionKey || !connection.enabled || !watched && !resume}>Preview import</Button> : <Button onClick={() => void run()} disabled={!!busy || !remaining.length || !session.current}>{results.length ? 'Retry remaining' : 'Import'} {remaining.length.toLocaleString()} {remaining.length === 1 ? 'title' : 'titles'}</Button>}
                </DialogFooter>
                {plan && <p className="text-xs text-muted-foreground">Exported reports contain title and user names.</p>}
            </DialogContent>
        </Dialog>
    )
}
