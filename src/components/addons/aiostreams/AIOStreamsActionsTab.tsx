import { useState, useCallback, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { CopyButton } from '@/components/ui/copy-button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useAccountStore } from '@/store/accountStore'
import {
    createAIOStreamsUser,
    deleteAIOStreamsUser,
    saveAIOStreamsPassword,
    removeAIOStreamsPassword,
    fetchAIOStreamsStatus,
    isAIOStreamsAddon,
    parseAIOStreamsUrl,
    sanitizeAIOStreamsConfigForCreate,
} from '@/lib/aiostreams-utils'
import { cn } from '@/lib/utils'
import {
    Plus, Trash2, Loader2, Check, AlertTriangle,
    UserPlus, Eye, EyeOff, Users,
} from 'lucide-react'
import { mapConcurrent } from '@/lib/concurrency'
import { useNavigate } from 'react-router-dom'

interface AIOStreamsActionsTabProps {
    sourceConfig: Record<string, unknown>
    baseUrl: string
    uuid: string
    targetOptions: { baseUrl: string }[]
    accountId: string
    transportUrl: string
    onClose: () => void
}

interface BatchResult {
    accountId: string
    accountName: string
    success: boolean
    uuid?: string
    installUrl?: string
    error?: string
}

const AIOSTREAMS_BATCH_CONCURRENCY = 4

export function AIOStreamsActionsTab({ sourceConfig, baseUrl, uuid, targetOptions, accountId, transportUrl, onClose }: AIOStreamsActionsTabProps) {
    const { toast } = useToast()
    const navigate = useNavigate()
    const accounts = useAccountStore(s => s.accounts)
    const installAddonToAccount = useAccountStore(s => s.installAddonToAccount)

    const accountById = useMemo(() => new Map(accounts.map(account => [account.id, account])), [accounts])

    const instanceUrls = useMemo(() => {
        const urls = new Set<string>()
        urls.add(baseUrl)
        targetOptions.forEach(t => urls.add(t.baseUrl))
        return Array.from(urls)
    }, [baseUrl, targetOptions])

    const [createBaseUrl, setCreateBaseUrl] = useState(baseUrl)
    const [customUrl, setCustomUrl] = useState('')
    const [useCustomUrl, setUseCustomUrl] = useState(false)
    const [createPassword, setCreatePassword] = useState('')
    const [showCreatePassword, setShowCreatePassword] = useState(false)
    const [prefillConfig, setPrefillConfig] = useState(true)
    const [creating, setCreating] = useState(false)
    const [createResult, setCreateResult] = useState<{ uuid: string; encryptedPassword: string } | null>(null)
    const [createError, setCreateError] = useState('')

    const [deletePassword, setDeletePassword] = useState('')
    const [showDeletePassword, setShowDeletePassword] = useState(false)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [deleting, setDeleting] = useState(false)

    const [addingToAccount, setAddingToAccount] = useState<string | null>(null)
    const [addedAccountIds, setAddedAccountIds] = useState<Set<string>>(new Set())
    const sourceLocationRef = useRef(`${window.location.pathname}${window.location.search}${window.location.hash}`)

    const [batchMode, setBatchMode] = useState(false)
    const [batchSelectedAccounts, setBatchSelectedAccounts] = useState<Set<string>>(new Set())
    const [batchPassword, setBatchPassword] = useState('')
    const [showBatchPassword, setShowBatchPassword] = useState(false)
    const [batchCreating, setBatchCreating] = useState(false)
    const [batchResults, setBatchResults] = useState<BatchResult[]>([])
    const [batchPrefill, setBatchPrefill] = useState(true)

    const activeBaseUrl = useCustomUrl ? customUrl : createBaseUrl

    const handleCreate = useCallback(async () => {
        if (creating || !activeBaseUrl || !createPassword.trim()) return
        setCreating(true)
        setCreateError('')
        setCreateResult(null)
        setAddedAccountIds(new Set())
        try {
            const password = createPassword.trim()
            try { await fetchAIOStreamsStatus(activeBaseUrl) } catch { throw new Error('Instance unreachable') }
            const config = prefillConfig ? sanitizeAIOStreamsConfigForCreate(sourceConfig) : {}
            const result = await createAIOStreamsUser(activeBaseUrl, password, config)
            setCreateResult(result)
            try {
                await saveAIOStreamsPassword(activeBaseUrl, result.uuid, password)
            } catch { /* non-critical */ }
            toast({ title: 'User created', description: `UUID: ${result.uuid.slice(0, 8)}…` })
        } catch (e: unknown) {
            setCreateError(e instanceof Error ? e.message : 'Failed to create user')
        } finally {
            setCreating(false)
        }
    }, [creating, activeBaseUrl, createPassword, prefillConfig, sourceConfig, toast])

    const handleDelete = useCallback(async () => {
        if (deleting || !deletePassword.trim()) return
        setDeleting(true)
        try {
            await deleteAIOStreamsUser(baseUrl, uuid, deletePassword)
            try { await removeAIOStreamsPassword(baseUrl, uuid) } catch { /* non-critical */ }
            try { await useAccountStore.getState().removeAddonFromAccount(accountId, transportUrl) } catch { /* non-critical */ }
            toast({ title: 'User deleted', description: 'The AIOStreams user, vault entry, and addon have been removed.' })
            onClose()
        } catch (e: unknown) {
            toast({
                title: 'Delete failed',
                description: e instanceof Error ? e.message : 'Unknown error',
                variant: 'destructive',
            })
        } finally {
            setDeleting(false)
            setShowDeleteConfirm(false)
        }
    }, [deleting, baseUrl, uuid, deletePassword, accountId, transportUrl, toast, onClose])

    const handleAddToAccount = useCallback(async (accountId: string) => {
        if (!createResult) return
        setAddingToAccount(accountId)
        const sourceLocation = sourceLocationRef.current
        try {
            const addonUrl = `${activeBaseUrl}/stremio/${createResult.uuid}/${createResult.encryptedPassword}/manifest.json`
            await installAddonToAccount(accountId, addonUrl)
            if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== sourceLocation) {
                navigate(sourceLocation, { replace: true })
            }
            setAddedAccountIds(prev => new Set(prev).add(accountId))
            const acc = accountById.get(accountId)
            toast({ title: 'Addon installed', description: `Added to ${acc?.name || acc?.email || accountId}` })
        } catch (e: unknown) {
            toast({
                title: 'Install failed',
                description: e instanceof Error ? e.message : 'Unknown error',
                variant: 'destructive',
            })
        } finally {
            setAddingToAccount(null)
        }
    }, [createResult, activeBaseUrl, installAddonToAccount, accountById, toast, navigate])

    const handleBatchCreate = useCallback(async () => {
        if (batchCreating || !activeBaseUrl || !batchPassword.trim() || batchSelectedAccounts.size === 0) return
        setBatchCreating(true)
        setBatchResults([])

        try {
            await fetchAIOStreamsStatus(activeBaseUrl)
        } catch {
            setBatchCreating(false)
            toast({ title: 'Instance unreachable', description: `Could not connect to ${activeBaseUrl}`, variant: 'destructive' })
            return
        }

        const skipped: BatchResult[] = []
        const toCreate: string[] = []

        for (const accountId of batchSelectedAccounts) {
            const acc = accountById.get(accountId)
            const accountName = acc?.name || acc?.email || accountId
            const alreadyHas = (acc?.addons || []).some(a => {
                if (!isAIOStreamsAddon(a)) return false
                const p = parseAIOStreamsUrl(a.transportUrl)
                return p?.baseUrl === activeBaseUrl
            })
            if (alreadyHas) {
                skipped.push({ accountId, accountName, success: false, error: 'Already has addon from this instance' })
            } else {
                toCreate.push(accountId)
            }
        }

        const results: BatchResult[] = [...skipped]
        const password = batchPassword.trim()
        const sourceLocation = sourceLocationRef.current
        const config = batchPrefill ? sanitizeAIOStreamsConfigForCreate(sourceConfig) : {}

        const createdResults = await mapConcurrent(toCreate, AIOSTREAMS_BATCH_CONCURRENCY, async (accountId) => {
            const acc = accountById.get(accountId)
            const accountName = acc?.name || acc?.email || accountId

            try {
                const result = await createAIOStreamsUser(activeBaseUrl, password, JSON.parse(JSON.stringify(config)))
                try {
                    await saveAIOStreamsPassword(activeBaseUrl, result.uuid, password)
                } catch { /* non-critical */ }

                const addonUrl = `${activeBaseUrl}/stremio/${result.uuid}/${result.encryptedPassword}/manifest.json`
                try {
                    await installAddonToAccount(accountId, addonUrl)
                    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== sourceLocation) {
                        navigate(sourceLocation, { replace: true })
                    }
                } catch (e: unknown) {
                    return {
                        accountId,
                        accountName,
                        success: false,
                        uuid: result.uuid,
                        installUrl: addonUrl,
                        error: `User created, install failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
                    }
                }

                return { accountId, accountName, success: true, uuid: result.uuid }
            } catch (e: unknown) {
                return {
                    accountId,
                    accountName,
                    success: false,
                    error: e instanceof Error ? e.message : 'Unknown error',
                }
            }
        })

        results.push(...createdResults)

        setBatchResults(results)
        setBatchCreating(false)

        const successCount = results.filter(r => r.success).length
        const failCount = results.filter(r => !r.success).length
        const skipCount = skipped.length
        if (failCount === 0 && skipCount === 0) {
            toast({ title: 'Batch create complete', description: `${successCount} user${successCount !== 1 ? 's' : ''} created and installed` })
        } else if (skipCount > 0 && failCount === skipCount) {
            toast({ title: 'Batch create skipped', description: `${skipCount} account${skipCount !== 1 ? 's' : ''} already had this instance`, variant: 'destructive' })
        } else {
            toast({ title: 'Batch create partially complete', description: `${successCount} succeeded, ${failCount} failed`, variant: 'destructive' })
        }
    }, [batchCreating, activeBaseUrl, batchPassword, batchSelectedAccounts, batchPrefill, sourceConfig, accountById, installAddonToAccount, toast, navigate])

    const toggleBatchAccount = (accountId: string) => {
        setBatchSelectedAccounts(prev => {
            const next = new Set(prev)
            if (next.has(accountId)) next.delete(accountId)
            else next.add(accountId)
            return next
        })
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-2">
                <p className="text-xs font-medium text-muted-foreground uppercase">Advanced user tools</p>
                <button
                    type="button"
                    onClick={() => setBatchMode(!batchMode)}
                    className="text-xs text-primary hover:underline ml-auto"
                >
                    {batchMode ? 'Single user' : 'Batch create'}
                </button>
            </div>

            {!batchMode ? (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground uppercase">Instance</label>
                        {useCustomUrl ? (
                            <div className="space-y-1.5">
                                <Input
                                    placeholder="https://your-instance.com"
                                    value={customUrl}
                                    onChange={e => setCustomUrl(e.target.value)}
                                    className="bg-background/50 border-muted h-11 font-mono text-sm"
                                />
                                <button type="button" onClick={() => setUseCustomUrl(false)} className="text-xs text-primary hover:underline">
                                    Known instance
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                <Select value={createBaseUrl} onValueChange={setCreateBaseUrl}>
                                    <SelectTrigger className="h-11 font-mono text-sm">
                                        <SelectValue placeholder="Select instance" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {instanceUrls.map(url => (
                                            <SelectItem key={url} value={url}>
                                                <span className="font-mono text-xs truncate max-w-[250px]">{url}</span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <button type="button" onClick={() => setUseCustomUrl(true)} className="text-xs text-primary hover:underline">
                                    Custom URL…
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground uppercase">Password</label>
                        <div className="relative">
                            <Input
                                type={showCreatePassword ? "text" : "password"}
                                placeholder="Password for the new user"
                                value={createPassword}
                                onChange={e => { setCreatePassword(e.target.value); setCreateError('') }}
                                className="bg-background/50 border-muted h-11 font-mono text-sm pr-9"
                                aria-label="New user password"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => setShowCreatePassword(v => !v)}
                                aria-label={showCreatePassword ? 'Hide password' : 'Show password'}
                            >
                                {showCreatePassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </Button>
                        </div>
                    </div>

                    <label className="flex items-center gap-2.5 cursor-pointer">
                        <Checkbox checked={prefillConfig} onCheckedChange={(c) => setPrefillConfig(c === true)} />
                        <span className="text-xs">Clone current config without runtime fields</span>
                    </label>

                    {createError && (
                        <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-3 py-2">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            {createError}
                        </div>
                    )}

                    <Button
                        onClick={handleCreate}
                        disabled={creating || !activeBaseUrl || !createPassword.trim()}
                        className="w-full gap-2 rounded-xl font-semibold text-xs"
                    >
                        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        {creating ? 'Creating…' : 'Create User'}
                    </Button>

                    {createResult && (
                        <div className="bg-success/5 border border-success/20 rounded-2xl p-4 space-y-3">
                            <div className="flex items-center gap-2">
                                <Check className="w-4 h-4 text-success" />
                                <p className="text-xs font-bold text-success">User created</p>
                            </div>
                            <div className="space-y-2">
                                <div className="space-y-0.5">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">UUID</p>
                                    <div className="flex items-center gap-1.5">
                                        <p className="text-xs font-mono break-all">{createResult.uuid}</p>
                                        <CopyButton value={createResult.uuid} iconSize={12} variant="ghost" />
                                    </div>
                                </div>
                                <div className="space-y-0.5">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Encrypted Password</p>
                                    <div className="flex items-start gap-1.5">
                                        <p className="text-xs font-mono break-all flex-1">{createResult.encryptedPassword}</p>
                                        <CopyButton value={createResult.encryptedPassword} iconSize={12} variant="ghost" />
                                    </div>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Check className="w-3 h-3 text-success" /> Password saved to vault. Treat install URLs as sensitive.
                            </p>
                            <div className="pt-3 border-t border-success/10 space-y-1.5">
                                <p className="text-xs font-medium text-muted-foreground uppercase">Add to Account</p>
                                {accounts.map(acc => {
                                    const isAdded = addedAccountIds.has(acc.id)
                                    const isAdding = addingToAccount === acc.id
                                    return (
                                        <button
                                            key={acc.id}
                                            type="button"
                                            onClick={() => !isAdded && !isAdding && handleAddToAccount(acc.id)}
                                            disabled={isAdding || isAdded}
                                            className={cn(
                                                'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left text-xs transition-colors',
                                                isAdded
                                                    ? 'bg-success/10 border-success/20 text-success'
                                                    : 'border-border/30 hover:bg-muted/20'
                                            )}
                                        >
                                            {isAdded ? <Check className="w-3.5 h-3.5" /> : isAdding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5 text-muted-foreground" />}
                                            <span className="font-semibold truncate">{acc.name || acc.email || acc.id}</span>
                                            {isAdded && <span className="text-xs ml-auto">Added</span>}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground uppercase">Instance</label>
                        {useCustomUrl ? (
                            <div className="space-y-1.5">
                                <Input
                                    placeholder="https://your-instance.com"
                                    value={customUrl}
                                    onChange={e => setCustomUrl(e.target.value)}
                                    className="bg-background/50 border-muted h-11 font-mono text-sm"
                                />
                                <button type="button" onClick={() => setUseCustomUrl(false)} className="text-xs text-primary hover:underline">
                                    Known instance
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                <Select value={createBaseUrl} onValueChange={setCreateBaseUrl}>
                                    <SelectTrigger className="h-11 font-mono text-sm">
                                        <SelectValue placeholder="Select instance" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {instanceUrls.map(url => (
                                            <SelectItem key={url} value={url}>
                                                <span className="font-mono text-xs truncate max-w-[250px]">{url}</span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <button type="button" onClick={() => setUseCustomUrl(true)} className="text-xs text-primary hover:underline">
                                    Custom URL…
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground uppercase">Password for all users</label>
                        <div className="relative">
                            <Input
                                type={showBatchPassword ? "text" : "password"}
                                placeholder="Shared password"
                                value={batchPassword}
                                onChange={e => setBatchPassword(e.target.value)}
                                className="bg-background/50 border-muted h-11 font-mono text-sm pr-9"
                                aria-label="Batch user password"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => setShowBatchPassword(v => !v)}
                                aria-label={showBatchPassword ? 'Hide password' : 'Show password'}
                            >
                                {showBatchPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </Button>
                        </div>
                    </div>

                    <label className="flex items-center gap-2.5 cursor-pointer">
                        <Checkbox checked={batchPrefill} onCheckedChange={(c) => setBatchPrefill(c === true)} />
                        <span className="text-xs">Clone current config without runtime fields</span>
                    </label>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-muted-foreground uppercase">
                                Accounts ({batchSelectedAccounts.size} selected)
                            </label>
                            <button
                                type="button"
                                onClick={() => {
                                    setBatchSelectedAccounts(
                                        batchSelectedAccounts.size === accounts.length
                                            ? new Set()
                                            : new Set(accounts.map(a => a.id))
                                    )
                                }}
                                className="text-xs text-primary hover:underline"
                            >
                                {batchSelectedAccounts.size === accounts.length ? 'Deselect all' : 'Select all'}
                            </button>
                        </div>
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                            {accounts.map(acc => {
                                const selected = batchSelectedAccounts.has(acc.id)
                                return (
                                    <button
                                        key={acc.id}
                                        type="button"
                                        role="checkbox"
                                        aria-checked={selected}
                                        aria-label={`${selected ? 'Deselect' : 'Select'} ${acc.name || acc.email || acc.id}`}
                                        onClick={() => toggleBatchAccount(acc.id)}
                                        className={cn(
                                            'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left text-xs transition-colors',
                                            selected
                                                ? 'border-primary/30 bg-primary/5'
                                                : 'border-border/30 hover:bg-muted/20'
                                        )}
                                    >
                                        <div className={cn(
                                            'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                                            selected ? 'bg-primary border-primary' : 'border-border/40'
                                        )}>
                                            {selected && <Check className="w-2.5 h-2.5 text-primary-foreground" strokeWidth={3} />}
                                        </div>
                                        <span className="font-semibold truncate">{acc.name || acc.email || acc.id}</span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    {batchResults.length > 0 && (
                        <div className="space-y-1.5">
                            <p className="text-xs font-medium text-muted-foreground uppercase">Results</p>
                            {batchResults.map((r, i) => (
                                <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
                                    r.success ? 'bg-success/5 border-success/20' : 'bg-destructive/5 border-destructive/20'
                                }`}>
                                    <span className={r.success ? 'text-success' : 'text-destructive'}>
                                        {r.success ? '✓' : '✗'}
                                    </span>
                                    <span className="font-semibold truncate">{r.accountName}</span>
                                    {r.uuid && (
                                        <span className="text-muted-foreground font-mono truncate">{r.uuid.slice(0, 8)}…</span>
                                    )}
                                    {!r.success && r.error && (
                                        <span className="text-destructive truncate ml-auto">{r.error}</span>
                                    )}
                                    {r.installUrl && (
                                        <CopyButton value={r.installUrl} variant="ghost" aria-label={`Copy install URL for ${r.accountName}`}>
                                            <span className="ml-1 text-[10px] font-medium">Copy URL</span>
                                        </CopyButton>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <Button
                        onClick={handleBatchCreate}
                        disabled={batchCreating || !activeBaseUrl || !batchPassword.trim() || batchSelectedAccounts.size === 0}
                        className="w-full gap-2 rounded-xl font-semibold text-xs"
                    >
                        {batchCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
                        {batchCreating
                            ? `Creating ${batchSelectedAccounts.size} users…`
                            : `Create and install for ${batchSelectedAccounts.size} account${batchSelectedAccounts.size !== 1 ? 's' : ''}`
                        }
                    </Button>
                </div>
            )}

            <div className="border-t border-border/10 pt-6 space-y-4">
                <p className="text-xs font-medium text-destructive/70 uppercase">Danger Zone</p>

                <div className="flex items-start gap-2 text-xs text-destructive/60 bg-destructive/5 border border-destructive/10 rounded-xl px-3 py-2.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <p>Permanently deletes <span className="font-mono font-bold">{uuid.slice(0, 8)}…</span> and all configuration.</p>
                </div>

                <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase">Confirm password</label>
                    <div className="relative">
                        <Input
                            type={showDeletePassword ? "text" : "password"}
                                placeholder="Enter password to confirm"
                                value={deletePassword}
                                onChange={e => setDeletePassword(e.target.value)}
                                className="bg-background/50 border-muted h-11 font-mono text-sm pr-9"
                                aria-label="Confirm password for deletion"
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => setShowDeletePassword(v => !v)}
                                aria-label={showDeletePassword ? 'Hide password' : 'Show password'}
                            >
                                {showDeletePassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                    </div>
                </div>

                <Button
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={!deletePassword.trim()}
                    variant="destructive"
                    className="w-full gap-2 rounded-xl font-semibold text-xs"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete User
                </Button>
            </div>

            <ConfirmationDialog
                open={showDeleteConfirm}
                onOpenChange={setShowDeleteConfirm}
                title="Delete this AIOStreams user?"
                description={
                    <span>
                        Permanently delete <span className="font-mono font-bold">{uuid.slice(0, 8)}…</span> from
                        <span className="font-mono"> {baseUrl}</span>?
                    </span>
                }
                confirmText="Delete permanently"
                isDestructive
                isLoading={deleting}
                onConfirm={handleDelete}
            />
        </div>
    )
}
