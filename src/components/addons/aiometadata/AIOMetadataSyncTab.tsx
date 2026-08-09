import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { CopyButton } from '@/components/ui/copy-button'
import { StatusChip } from '@/components/ui/status-chip'
import { AddonIcon } from '@/components/ui/addon-icon'
import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip'
import { EmptyState } from '@/components/common/EmptyState'
import { SectionPreview } from '@/components/addons/aiostreams/SectionPreview'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { mapConcurrent } from '@/lib/concurrency'
import { useAccountStore } from '@/store/accountStore'
import { useNavigate } from 'react-router-dom'
import {
    fetchAIOMetadataConfig,
    updateAIOMetadataConfig,
    createAIOMetadataUser,
    getStoredAIOMetadataPassword,
    saveAIOMetadataPassword,
    AIOMETADATA_SYNC_GROUPS,
    AIOMETADATA_BRANDING_KEYS,
    AIOMETADATA_SESSION_KEYS,
    AIOMETADATA_TARGET_LOCAL_KEYS,
    getSyncGroupFields,
    hasSyncGroupData,
    getSyncGroupSummary,
    sanitizeAIOMetadataConfigForCreate,
    cloneAIOMetadataConfig,
} from '@/lib/aiometadata-utils'
import {
    Loader2, ArrowRightLeft, Eye, EyeOff, ListChecks, ClipboardCheck,
    CheckCircle2, XCircle, AlertTriangle, RotateCw, Search, UserPlus,
} from 'lucide-react'

export interface TargetOption {
    accountId: string
    accountName: string
    addonName: string
    transportUrl: string
    baseUrl: string
    uuid: string
    logo?: string
}

export interface MissingTargetAccount {
    accountId: string
    accountName: string
}

interface AIOMetadataSyncTabProps {
    sourceConfig: Record<string, unknown>
    targetOptions: TargetOption[]
    sourceName: string
    sourceAccountName: string
    sourceBaseUrl: string
    sourceUuid: string
    requiresAddonPassword?: boolean
    missingAccounts?: MissingTargetAccount[]
}

type SyncMode = 'full' | 'sections'
type Phase = 'select' | 'preview' | 'syncing' | 'results'

interface DiffEntry {
    section: string
    label: string
    sourceSummary: string
    targetSummary: string
    changed: boolean
}

interface TargetPreview {
    target: TargetOption
    entries: DiffEntry[]
    changedSections: string[]
    targetConfig?: Record<string, unknown>
    plannedConfig?: Record<string, unknown>
    error?: string
}

interface SyncResult {
    target: TargetOption
    status: 'changed' | 'skipped' | 'failed'
    error?: string
    rollbackConfig?: Record<string, unknown>
    restored?: boolean
}

interface CreateResult {
    accountId: string
    accountName: string
    status: 'created' | 'failed'
    uuid?: string
    installUrl?: string
    error?: string
}

interface SyncReceipt {
    timestamp: string
    sourceName: string
    sourceAccountName: string
    sourceBaseUrl: string
    scope: string[]
    targetCount: number
    updatedCount: number
    skippedCount: number
    failedCount: number
    preserved: string[]
}

const CONCURRENCY = 2
const PREVIEW_STALE_MS = 5 * 60 * 1000
const BRANDING_KEY = 'branding'

const GROUP_LABEL: Record<string, string> = {
    ...Object.fromEntries(AIOMETADATA_SYNC_GROUPS.map(g => [g.key, g.label])),
    [BRANDING_KEY]: 'Addon name',
}

function stableStringify(value: unknown): string {
    const normalize = (input: unknown): unknown => {
        if (input === undefined) return undefined
        if (input === null || typeof input !== 'object') return input
        if (Array.isArray(input)) return input.map(normalize)
        return Object.keys(input as Record<string, unknown>).sort().reduce<Record<string, unknown>>((acc, key) => {
            const next = normalize((input as Record<string, unknown>)[key])
            if (next !== undefined) acc[key] = next
            return acc
        }, {})
    }
    return JSON.stringify(normalize(value))
}

function changed(a: unknown, b: unknown): boolean {
    return stableStringify(a) !== stableStringify(b)
}

function copyFields(next: Record<string, unknown>, source: Record<string, unknown>, fields: string[]) {
    for (const key of fields) {
        if (source[key] !== undefined) next[key] = cloneAIOMetadataConfig({ v: source[key] }).v
        else delete next[key]
    }
}

function preserveFields(next: Record<string, unknown>, target: Record<string, unknown>, fields: string[]) {
    for (const key of fields) {
        if (target[key] !== undefined) next[key] = target[key]
        else delete next[key]
    }
}

function groupData(config: Record<string, unknown>, key: string): unknown {
    const fields = key === BRANDING_KEY ? AIOMETADATA_BRANDING_KEYS : getSyncGroupFields(key)
    if (fields.length === 1) return config[fields[0]]
    const data: Record<string, unknown> = {}
    for (const field of fields) if (config[field] !== undefined) data[field] = config[field]
    return Object.keys(data).length > 0 ? data : undefined
}

// Every config key surfaced by a group/branding row, plus the keys the sync always preserves.
// Used to detect full-mode changes to keys that have no dedicated row (e.g. timezone).
const SHOWN_FIELDS = [
    ...AIOMETADATA_SYNC_GROUPS.flatMap(g => g.fields),
    ...AIOMETADATA_BRANDING_KEYS,
    ...AIOMETADATA_SESSION_KEYS,
    ...AIOMETADATA_TARGET_LOCAL_KEYS,
]

function withoutKeys(config: Record<string, unknown>, keys: string[]): Record<string, unknown> {
    const next = { ...config }
    for (const key of keys) delete next[key]
    return next
}

function groupSummary(config: Record<string, unknown>, key: string): string {
    if (key === BRANDING_KEY) {
        const name = config.addonName
        return typeof name === 'string' && name ? name : 'Default'
    }
    return getSyncGroupSummary(config, key)
}

function buildPlannedConfig(
    source: Record<string, unknown>,
    target: Record<string, unknown>,
    mode: SyncMode,
    selectedGroups: Set<string>,
    copyBranding: boolean
): Record<string, unknown> {
    const next = mode === 'full' ? cloneAIOMetadataConfig(source) : cloneAIOMetadataConfig(target)
    if (mode === 'sections') {
        for (const key of selectedGroups) copyFields(next, source, getSyncGroupFields(key))
    }
    if (copyBranding) copyFields(next, source, AIOMETADATA_BRANDING_KEYS)
    else preserveFields(next, target, AIOMETADATA_BRANDING_KEYS)
    // The update API replaces the record verbatim, so always keep the target's own
    // session/setup state rather than the source's (or none at all).
    preserveFields(next, target, AIOMETADATA_SESSION_KEYS)
    preserveFields(next, target, AIOMETADATA_TARGET_LOCAL_KEYS)
    return next
}

function buildNewConfig(
    source: Record<string, unknown>,
    mode: SyncMode,
    selectedGroups: Set<string>,
    copyBranding: boolean
): Record<string, unknown> {
    const next: Record<string, unknown> = mode === 'full' ? cloneAIOMetadataConfig(source) : {}
    if (mode === 'sections') {
        for (const key of selectedGroups) copyFields(next, source, getSyncGroupFields(key))
    }
    if (copyBranding) copyFields(next, source, AIOMETADATA_BRANDING_KEYS)
    else for (const key of AIOMETADATA_BRANDING_KEYS) delete next[key]
    return sanitizeAIOMetadataConfigForCreate(next)
}

function getPreservedLabels(mode: SyncMode, copyBranding: boolean): string[] {
    const labels = ['target identity and session state']
    if (mode === 'sections') labels.push('unselected settings groups')
    if (!copyBranding) labels.push('target addon name')
    return labels
}

function formatHost(url: string): string {
    try { return new URL(url).host } catch { return url.replace(/^https?:\/\//, '').replace(/\/$/, '') }
}

function getTargetDomId(target: TargetOption): string {
    return `aiometadata-target-${target.accountId}-${target.uuid}`.replace(/[^a-zA-Z0-9_-]/g, '-')
}

export function AIOMetadataSyncTab({
    sourceConfig,
    targetOptions,
    sourceName,
    sourceAccountName,
    sourceBaseUrl,
    sourceUuid,
    requiresAddonPassword = false,
    missingAccounts = [],
}: AIOMetadataSyncTabProps) {
    const { toast } = useToast()
    const navigate = useNavigate()
    const installAddonToAccount = useAccountStore(s => s.installAddonToAccount)

    const [syncMode, setSyncMode] = useState<SyncMode>('full')
    const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())
    const [copyBranding, setCopyBranding] = useState(false)
    const [selectedTargets, setSelectedTargets] = useState<Map<string, string>>(new Map())
    const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({})
    const [addonPassword, setAddonPassword] = useState('')
    const [targetQuery, setTargetQuery] = useState('')
    const [phase, setPhase] = useState<Phase>('select')
    const [previews, setPreviews] = useState<Map<string, TargetPreview>>(new Map())
    const [previewAt, setPreviewAt] = useState<number | null>(null)
    const [loadingPreview, setLoadingPreview] = useState(false)
    const [progress, setProgress] = useState({ current: 0, total: 0 })
    const [results, setResults] = useState<SyncResult[]>([])
    const [receipt, setReceipt] = useState<SyncReceipt | null>(null)
    const [restoringUrls, setRestoringUrls] = useState<Set<string>>(new Set())
    const syncInFlight = useRef(false)
    const sourceLocation = useRef(`${window.location.pathname}${window.location.search}`)

    const [createIds, setCreateIds] = useState<Set<string>>(new Set())
    const [createPassword, setCreatePassword] = useState('')
    const [showCreatePassword, setShowCreatePassword] = useState(false)
    const [creating, setCreating] = useState(false)
    const [createResults, setCreateResults] = useState<CreateResult[]>([])

    useEffect(() => {
        const valid = new Set(targetOptions.map(t => t.transportUrl))
        setSelectedTargets(prev => {
            const next = new Map(Array.from(prev.entries()).filter(([url]) => valid.has(url)))
            return next.size === prev.size ? prev : next
        })
    }, [targetOptions])

    useEffect(() => {
        const valid = new Set(missingAccounts.map(a => a.accountId))
        setCreateIds(prev => {
            const next = new Set(Array.from(prev).filter(id => valid.has(id)))
            return next.size === prev.size ? prev : next
        })
    }, [missingAccounts])

    const selectableGroupKeys = useMemo(() => AIOMETADATA_SYNC_GROUPS.map(g => g.key), [])
    const editingLocked = phase !== 'select'

    const filteredTargets = useMemo(() => {
        const query = targetQuery.trim().toLowerCase()
        if (!query) return targetOptions
        return targetOptions.filter(t => [t.addonName, t.accountName, t.baseUrl, t.uuid, formatHost(t.baseUrl)].join(' ').toLowerCase().includes(query))
    }, [targetOptions, targetQuery])

    const groupedTargets = useMemo(() => {
        const groups = new Map<string, TargetOption[]>()
        filteredTargets.forEach(t => groups.set(t.baseUrl, [...(groups.get(t.baseUrl) ?? []), t]))
        return Array.from(groups.entries()).map(([baseUrl, targets]) => ({ baseUrl, targets }))
    }, [filteredTargets])

    const savedPasswordCount = useMemo(() => targetOptions.filter(t => getStoredAIOMetadataPassword(t.baseUrl, t.uuid)).length, [targetOptions])

    const allGroupsSelected = selectableGroupKeys.length > 0 && selectableGroupKeys.every(k => selectedGroups.has(k))
    const allVisibleSelected = filteredTargets.length > 0 && filteredTargets.every(t => selectedTargets.has(t.transportUrl))
    const allCreateSelected = missingAccounts.length > 0 && missingAccounts.every(a => createIds.has(a.accountId))
    const allPasswordsFilled = Array.from(selectedTargets.values()).every(p => p.trim().length > 0)
    const selectedMissingPasswordCount = Array.from(selectedTargets.values()).filter(p => !p.trim()).length
    const canSync = selectedTargets.size > 0 && allPasswordsFilled && !editingLocked && (syncMode === 'full' || selectedGroups.size > 0)
    const canCreate = createIds.size > 0 && createPassword.trim().length > 0 && !creating

    const previewItems = Array.from(previews.values())
    const previewChanged = previewItems.filter(p => !p.error && p.changedSections.length > 0).length
    const previewSkipped = previewItems.filter(p => !p.error && p.changedSections.length === 0).length
    const previewErrors = previewItems.filter(p => p.error).length
    const previewChangeTotal = previewItems.reduce((t, p) => t + p.changedSections.length, 0)
    const preservedLabels = useMemo(() => getPreservedLabels(syncMode, copyBranding), [syncMode, copyBranding])
    const receiptText = receipt ? JSON.stringify(receipt, null, 2) : ''
    const syncProgressValue = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

    const previewKeys = useMemo(() => {
        const keys = syncMode === 'sections' ? Array.from(selectedGroups) : selectableGroupKeys
        return copyBranding ? [...keys, BRANDING_KEY] : keys
    }, [syncMode, selectedGroups, selectableGroupKeys, copyBranding])

    const toggleGroup = (key: string) => setSelectedGroups(prev => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key); else next.add(key)
        return next
    })

    const toggleTarget = (target: TargetOption) => setSelectedTargets(prev => {
        const next = new Map(prev)
        if (next.has(target.transportUrl)) next.delete(target.transportUrl)
        else next.set(target.transportUrl, getStoredAIOMetadataPassword(target.baseUrl, target.uuid) || '')
        return next
    })

    const setTargetPassword = (url: string, password: string) => setSelectedTargets(prev => {
        const next = new Map(prev)
        next.set(url, password)
        return next
    })

    const toggleVisibleTargets = () => setSelectedTargets(prev => {
        const next = new Map(prev)
        filteredTargets.forEach(t => {
            if (allVisibleSelected) next.delete(t.transportUrl)
            else next.set(t.transportUrl, getStoredAIOMetadataPassword(t.baseUrl, t.uuid) || '')
        })
        return next
    })

    const toggleCreate = (accountId: string) => setCreateIds(prev => {
        const next = new Set(prev)
        if (next.has(accountId)) next.delete(accountId); else next.add(accountId)
        return next
    })

    const resetToSelect = useCallback(() => {
        setPhase('select')
        setPreviews(new Map())
        setPreviewAt(null)
    }, [])

    const handlePreview = useCallback(async () => {
        if (!canSync) return
        setLoadingPreview(true)
        setPreviews(new Map())
        setPreviewAt(null)
        setReceipt(null)
        const entries = Array.from(selectedTargets.entries())

        const out = await mapConcurrent(entries, CONCURRENCY, async ([url, password]): Promise<TargetPreview | null> => {
            const target = targetOptions.find(t => t.transportUrl === url)
            if (!target) return null
            try {
                const targetConfig = await fetchAIOMetadataConfig(target.baseUrl, target.uuid, password, addonPassword || undefined)
                const planned = buildPlannedConfig(sourceConfig, targetConfig, syncMode, selectedGroups, copyBranding)
                const diffEntries: DiffEntry[] = previewKeys.map(key => ({
                    section: key,
                    label: GROUP_LABEL[key] ?? key,
                    sourceSummary: groupSummary(planned, key),
                    targetSummary: groupSummary(targetConfig, key),
                    changed: changed(groupData(targetConfig, key), groupData(planned, key)),
                }))
                // Full mode copies the whole source config, so surface any change to keys that
                // have no dedicated group row (otherwise the preview under-reports the write).
                if (syncMode === 'full' && changed(withoutKeys(targetConfig, SHOWN_FIELDS), withoutKeys(planned, SHOWN_FIELDS))) {
                    diffEntries.push({ section: 'otherSettings', label: 'Other settings', sourceSummary: 'Will update', targetSummary: 'Different', changed: true })
                }
                return {
                    target,
                    entries: diffEntries,
                    changedSections: diffEntries.filter(e => e.changed).map(e => e.section),
                    targetConfig,
                    plannedConfig: planned,
                }
            } catch (e: unknown) {
                return {
                    target,
                    entries: previewKeys.map(key => ({
                        section: key, label: GROUP_LABEL[key] ?? key,
                        sourceSummary: groupSummary(sourceConfig, key), targetSummary: 'Failed to fetch', changed: true,
                    })),
                    changedSections: previewKeys,
                    error: e instanceof Error ? e.message : 'Failed to fetch',
                }
            }
        })

        setPreviews(new Map(out.filter((p): p is TargetPreview => p !== null).map(p => [p.target.transportUrl, p])))
        setPreviewAt(Date.now())
        setLoadingPreview(false)
        setPhase('preview')
    }, [canSync, selectedTargets, targetOptions, syncMode, selectedGroups, copyBranding, previewKeys, sourceConfig, addonPassword])

    const handleSync = useCallback(async () => {
        if (syncInFlight.current) return
        if (previewErrors > 0) {
            toast({ title: 'Preview needs attention', description: 'Fix targets that failed preview first.', variant: 'destructive' })
            return
        }
        if (previewChanged === 0) {
            toast({ title: 'Nothing to sync', description: 'All selected targets already match.' })
            return
        }
        if (previewAt && Date.now() - previewAt > PREVIEW_STALE_MS) {
            resetToSelect()
            toast({ title: 'Preview expired', description: 'Refresh the preview before syncing.' })
            return
        }
        syncInFlight.current = true
        setPhase('syncing')
        setResults([])
        setProgress({ current: 0, total: selectedTargets.size })
        let completed = 0

        const entries = Array.from(selectedTargets.entries())
        const out = await mapConcurrent(entries, CONCURRENCY, async ([url, password]): Promise<SyncResult | null> => {
            const target = targetOptions.find(t => t.transportUrl === url)
            if (!target) { completed++; setProgress({ current: completed, total: selectedTargets.size }); return null }
            const preview = previews.get(url)
            try {
                if (!preview || preview.error || !preview.plannedConfig || !preview.targetConfig) {
                    return { target, status: 'failed', error: preview?.error || 'Missing preview' }
                }
                if (preview.changedSections.length === 0) return { target, status: 'skipped' }
                await updateAIOMetadataConfig(target.baseUrl, target.uuid, password, preview.plannedConfig, addonPassword || undefined)
                return { target, status: 'changed', rollbackConfig: cloneAIOMetadataConfig(preview.targetConfig) }
            } catch (e: unknown) {
                return { target, status: 'failed', error: e instanceof Error ? e.message : 'Unknown error' }
            } finally {
                completed++
                setProgress({ current: completed, total: selectedTargets.size })
            }
        })

        const final = out.filter((r): r is SyncResult => r !== null)
        setResults(final)
        setPhase('results')
        syncInFlight.current = false

        const changedCount = final.filter(r => r.status === 'changed').length
        const skippedCount = final.filter(r => r.status === 'skipped').length
        const failCount = final.filter(r => r.status === 'failed').length
        setReceipt({
            timestamp: new Date().toISOString(),
            sourceName, sourceAccountName, sourceBaseUrl,
            scope: syncMode === 'full' ? ['Everything'] : Array.from(selectedGroups).map(k => GROUP_LABEL[k] ?? k).concat(copyBranding ? ['Addon name'] : []),
            targetCount: final.length,
            updatedCount: changedCount,
            skippedCount,
            failedCount: failCount,
            preserved: preservedLabels,
        })
        toast({
            title: failCount === 0 ? 'Sync complete' : 'Sync partially complete',
            description: `${changedCount} updated, ${skippedCount} matched, ${failCount} failed`,
            variant: failCount > 0 ? 'destructive' : undefined,
        })
    }, [previewErrors, previewChanged, previewAt, resetToSelect, selectedTargets, targetOptions, previews, addonPassword, syncMode, selectedGroups, copyBranding, sourceName, sourceAccountName, sourceBaseUrl, preservedLabels, toast])

    const handleRestore = useCallback(async (result: SyncResult) => {
        if (!result.rollbackConfig) return
        const url = result.target.transportUrl
        if (restoringUrls.has(url)) return
        const password = selectedTargets.get(url)?.trim() || getStoredAIOMetadataPassword(result.target.baseUrl, result.target.uuid)
        if (!password) {
            toast({ title: 'Restore needs password', description: `Enter the password for ${result.target.accountName} and try again.`, variant: 'destructive' })
            return
        }
        setRestoringUrls(prev => new Set(prev).add(url))
        try {
            await updateAIOMetadataConfig(result.target.baseUrl, result.target.uuid, password, result.rollbackConfig, addonPassword || undefined)
            setResults(prev => prev.map(r => r.target.transportUrl === url ? { ...r, restored: true } : r))
            toast({ title: 'Target restored', description: `${result.target.accountName} was rolled back to its pre-sync config.` })
        } catch (e: unknown) {
            toast({ title: 'Restore failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
        } finally {
            setRestoringUrls(prev => { const next = new Set(prev); next.delete(url); return next })
        }
    }, [restoringUrls, selectedTargets, addonPassword, toast])

    const handleRetryFailed = useCallback(() => {
        const failedUrls = new Set(results.filter(r => r.status === 'failed').map(r => r.target.transportUrl))
        setSelectedTargets(prev => new Map(Array.from(prev.entries()).filter(([url]) => failedUrls.has(url))))
        setResults([])
        setPreviews(new Map())
        setPhase('select')
    }, [results])

    const handleCreate = useCallback(async () => {
        if (!canCreate) return
        setCreating(true)
        setCreateResults([])
        const accountById = new Map(missingAccounts.map(a => [a.accountId, a]))
        const baseConfig = buildNewConfig(sourceConfig, syncMode, selectedGroups, copyBranding)
        const password = createPassword.trim()
        const loc = sourceLocation.current

        const out = await mapConcurrent(Array.from(createIds), CONCURRENCY, async (accountId): Promise<CreateResult> => {
            const accountName = accountById.get(accountId)?.accountName ?? accountId
            try {
                const { uuid, installUrl } = await createAIOMetadataUser(sourceBaseUrl, password, cloneAIOMetadataConfig(baseConfig), addonPassword || undefined)
                try { await saveAIOMetadataPassword(sourceBaseUrl, uuid, password) } catch { /* non-critical */ }
                try {
                    await installAddonToAccount(accountId, installUrl)
                    if (`${window.location.pathname}${window.location.search}` !== loc) navigate(loc, { replace: true })
                } catch (e: unknown) {
                    return { accountId, accountName, status: 'failed', uuid, installUrl, error: `Created user, install failed: ${e instanceof Error ? e.message : 'Unknown error'}` }
                }
                return { accountId, accountName, status: 'created', uuid }
            } catch (e: unknown) {
                return { accountId, accountName, status: 'failed', error: e instanceof Error ? e.message : 'Unknown error' }
            }
        })

        setCreateResults(out)
        setCreating(false)
        const createdCount = out.filter(r => r.status === 'created').length
        const failCount = out.filter(r => r.status === 'failed').length
        toast({
            title: failCount === 0 ? 'Setups deployed' : 'Deploy partially complete',
            description: `${createdCount} created, ${failCount} failed`,
            variant: failCount > 0 ? 'destructive' : undefined,
        })
    }, [canCreate, missingAccounts, sourceConfig, syncMode, selectedGroups, copyBranding, createPassword, createIds, sourceBaseUrl, addonPassword, installAddonToAccount, navigate, toast])

    if (targetOptions.length === 0 && missingAccounts.length === 0) {
        return (
            <EmptyState
                icon={<ArrowRightLeft className="h-6 w-6" />}
                title="No other accounts to sync to"
                description="Install AIOMetadata on another account, or add more accounts, then sync or deploy this setup to them."
            />
        )
    }

    return (
        <div className="mx-auto max-w-5xl space-y-4">
            {/* Scope */}
            <Card className="overflow-hidden border-border/40 bg-card/90 shadow-sm">
                <CardHeader>
                    <CardTitle className="text-xl">Copy from {sourceName}</CardTitle>
                    <CardDescription>{sourceAccountName} · {formatHost(sourceBaseUrl)} · {sourceUuid.slice(0, 8)}…</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Sync scope">
                        <button type="button" role="radio" aria-checked={syncMode === 'full'} disabled={editingLocked}
                            onClick={() => setSyncMode('full')}
                            className={cn('rounded-xl border p-3 text-left transition-colors disabled:opacity-60',
                                syncMode === 'full' ? 'border-primary/35 bg-primary/5' : 'border-border/30 bg-muted/10 hover:bg-muted/20')}>
                            <span className="flex items-center gap-2 text-sm font-semibold"><ClipboardCheck className="h-4 w-4 text-primary" /> Everything</span>
                            <span className="mt-1 block text-xs text-muted-foreground">Copies providers, API keys, catalogs, search, and filters.</span>
                        </button>
                        <button type="button" role="radio" aria-checked={syncMode === 'sections'} disabled={editingLocked}
                            onClick={() => setSyncMode('sections')}
                            className={cn('rounded-xl border p-3 text-left transition-colors disabled:opacity-60',
                                syncMode === 'sections' ? 'border-primary/35 bg-primary/5' : 'border-border/30 bg-muted/10 hover:bg-muted/20')}>
                            <span className="flex items-center gap-2 text-sm font-semibold"><ListChecks className="h-4 w-4 text-primary" /> Choose groups</span>
                            <span className="mt-1 block text-xs text-muted-foreground">Leave a group unchecked to keep the target's version.</span>
                        </button>
                    </div>

                    {syncMode === 'sections' && (
                        <div className="space-y-2 rounded-xl border border-border/30 bg-muted/10 p-3">
                            <div className="flex items-center justify-between">
                                <p className="text-xs font-medium uppercase text-muted-foreground">Settings groups</p>
                                <Button type="button" variant="ghost" size="sm" disabled={editingLocked}
                                    onClick={() => setSelectedGroups(allGroupsSelected ? new Set() : new Set(selectableGroupKeys))}>
                                    {allGroupsSelected ? 'Deselect all' : 'Select all'}
                                </Button>
                            </div>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {AIOMETADATA_SYNC_GROUPS.map(group => {
                                    const active = selectedGroups.has(group.key)
                                    const data = groupData(sourceConfig, group.key)
                                    const hasData = hasSyncGroupData(sourceConfig, group.key)
                                    const id = `amd-group-${group.key}`
                                    return (
                                        <SectionPreview key={group.key} data={data} label={group.label}>
                                            <div className={cn('flex items-start gap-2 rounded-lg border p-2 transition-colors',
                                                active ? 'border-primary/40 bg-primary/5' : 'border-border/30 bg-background/35',
                                                editingLocked && 'opacity-60')}>
                                                <Checkbox id={id} checked={active} disabled={editingLocked} onCheckedChange={() => toggleGroup(group.key)} className="mt-0.5" />
                                                <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                                                    <span className="block text-xs font-semibold">{group.label}</span>
                                                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                                        {hasData ? getSyncGroupSummary(sourceConfig, group.key) : 'Empty in source; selecting clears this group on targets'}
                                                    </span>
                                                </Label>
                                            </div>
                                        </SectionPreview>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    <div className="flex items-center gap-2">
                        <Checkbox id="amd-copy-branding" checked={copyBranding} disabled={editingLocked} onCheckedChange={c => setCopyBranding(!!c)} />
                        <Label htmlFor="amd-copy-branding" className="text-sm font-normal cursor-pointer">Copy addon name to targets (otherwise each target keeps its own)</Label>
                    </div>

                    {requiresAddonPassword && (
                        <div className="space-y-1.5">
                            <Label className="text-xs font-medium uppercase text-muted-foreground">Addon password</Label>
                            <Input type="password" placeholder="Required for untrusted users on this instance"
                                value={addonPassword} disabled={editingLocked}
                                onChange={e => setAddonPassword(e.target.value)} className="h-10" />
                            <p className="text-xs text-muted-foreground">Applied to every target and new setup on this instance.</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Create new targets */}
            {missingAccounts.length > 0 && (
                <Card className="overflow-hidden border-border/40 bg-card/90 shadow-sm">
                    <CardHeader>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2 text-base"><UserPlus className="w-4 h-4" /> Deploy to new accounts</CardTitle>
                                <CardDescription>
                                    {missingAccounts.length === 1
                                        ? `1 account can get a new AIOMetadata setup on ${formatHost(sourceBaseUrl)}.`
                                        : `${missingAccounts.length} accounts can get new setups on ${formatHost(sourceBaseUrl)}.`}
                                </CardDescription>
                            </div>
                            {missingAccounts.length > 1 && (
                                <Button type="button" variant="ghost" size="sm" disabled={creating}
                                    onClick={() => setCreateIds(allCreateSelected ? new Set() : new Set(missingAccounts.map(a => a.accountId)))}>
                                    {allCreateSelected ? 'Clear' : 'Select all'}
                                </Button>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {missingAccounts.map(account => {
                                const active = createIds.has(account.accountId)
                                const result = createResults.find(r => r.accountId === account.accountId)
                                return (
                                    <label key={account.accountId} className={cn('flex items-center gap-2 rounded-lg border p-2 text-xs',
                                        active ? 'border-primary/40 bg-primary/5' : 'border-border/30 bg-background/35')}>
                                        <Checkbox checked={active} disabled={creating} onCheckedChange={() => toggleCreate(account.accountId)} />
                                        <span className="min-w-0 flex-1 truncate font-medium">{account.accountName}</span>
                                        {result && (result.status === 'created'
                                            ? <CheckCircle2 className="w-4 h-4 text-success" />
                                            : <Tooltip content={result.error}>
                                                <TooltipTrigger asChild>
                                                    <span className="text-destructive">Failed</span>
                                                </TooltipTrigger>
                                              </Tooltip>)}
                                    </label>
                                )
                            })}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                            <div className="space-y-1">
                                <Label htmlFor="amd-create-password" className="text-xs font-medium text-muted-foreground">New setup password</Label>
                                <div className="relative">
                                    <Input id="amd-create-password" type={showCreatePassword ? 'text' : 'password'} value={createPassword}
                                        disabled={creating} onChange={e => setCreatePassword(e.target.value)}
                                        placeholder="Password for new users" className="h-10 pr-11 font-mono" />
                                    <Button type="button" variant="ghost" size="icon" tabIndex={-1}
                                        className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        onClick={() => setShowCreatePassword(v => !v)}
                                        aria-label={showCreatePassword ? 'Hide password' : 'Show password'}>
                                        {showCreatePassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                    </Button>
                                </div>
                            </div>
                            <Button type="button" className="self-end gap-2" disabled={!canCreate} onClick={handleCreate}>
                                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                                {createIds.size > 0 ? `Create ${createIds.size} setup${createIds.size !== 1 ? 's' : ''}` : 'Create setups'}
                            </Button>
                        </div>
                        <p className="rounded-xl border border-border/30 bg-background/45 p-2 text-xs text-muted-foreground">
                            New setups use the scope above: Everything clones the full config; Groups builds from only the selected groups.
                        </p>
                        {createResults.length > 0 && (
                            <div className="space-y-1">
                                {createResults.map(result => (
                                    <div key={result.accountId} className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs',
                                        result.status === 'created' ? 'border-success/20 bg-success/5 text-success' : 'border-destructive/20 bg-destructive/5 text-destructive')}>
                                        {result.status === 'created' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                                        <span className="min-w-0 flex-1 truncate font-medium">{result.accountName}</span>
                                        <span className="truncate">{result.status === 'created' ? `Created ${result.uuid?.slice(0, 8)}…` : result.error}</span>
                                        {result.installUrl && (
                                            <CopyButton value={result.installUrl} variant="ghost" aria-label={`Copy install URL for ${result.accountName}`}>
                                                <span className="ml-1 text-xs font-medium">Copy URL</span>
                                            </CopyButton>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Existing targets */}
            {targetOptions.length > 0 && (
                <Card className="overflow-hidden border-border/40 bg-card/90 shadow-sm">
                    <CardHeader className="space-y-3">
                        <div>
                            <CardTitle className="text-base">Existing targets</CardTitle>
                            <CardDescription>
                                {targetOptions.length} other AIOMetadata setup{targetOptions.length !== 1 ? 's' : ''}; updates apply in place
                                {savedPasswordCount > 0 && ` · ${savedPasswordCount} with saved passwords`}
                            </CardDescription>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <div className="relative min-w-0 flex-1">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input value={targetQuery} disabled={editingLocked} onChange={e => setTargetQuery(e.target.value)}
                                    placeholder="Search accounts" className="h-10 pl-9" aria-label="Search targets" />
                            </div>
                            {targetOptions.length > 1 && (
                                <Button type="button" variant="ghost" size="sm" disabled={editingLocked || filteredTargets.length === 0} onClick={toggleVisibleTargets}>
                                    {allVisibleSelected ? 'Clear visible' : 'Select visible'}
                                </Button>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {groupedTargets.length === 0 ? (
                            <EmptyState icon={<Search className="h-6 w-6" />} title="No targets found" description="Try a different search."
                                action={<Button type="button" variant="outline" size="sm" onClick={() => setTargetQuery('')}>Clear search</Button>} className="py-8" />
                        ) : (
                            groupedTargets.map(group => (
                                <div key={group.baseUrl} className="space-y-2">
                                    {groupedTargets.length > 1 && <p className="truncate px-1 text-xs font-medium text-muted-foreground">{formatHost(group.baseUrl)}</p>}
                                    {group.targets.map(target => {
                                        const isSelected = selectedTargets.has(target.transportUrl)
                                        const password = selectedTargets.get(target.transportUrl) ?? ''
                                        const showPwd = showPasswords[target.transportUrl] ?? false
                                        const stored = getStoredAIOMetadataPassword(target.baseUrl, target.uuid)
                                        const preview = previews.get(target.transportUrl)
                                        const targetId = getTargetDomId(target)
                                        return (
                                            <article key={target.transportUrl} className={cn('rounded-2xl border p-3 transition-colors',
                                                isSelected ? 'border-primary/30 bg-primary/[0.04]' : 'border-border/30 bg-muted/[0.08] hover:bg-muted/15')}>
                                                <div className="flex items-center gap-3">
                                                    <Checkbox id={targetId} checked={isSelected} disabled={editingLocked} onCheckedChange={() => toggleTarget(target)} className="shrink-0" />
                                                    <AddonIcon name={target.addonName} logo={target.logo} className="h-10 w-10" textClassName="text-xs" imageClassName="p-1" />
                                                    <Label htmlFor={targetId} className="min-w-0 flex-1 cursor-pointer">
                                                        <span className="block truncate text-sm font-semibold">{target.addonName}</span>
                                                        <span className="block truncate text-xs text-muted-foreground">{target.accountName} · {formatHost(target.baseUrl)}</span>
                                                    </Label>
                                                    {phase !== 'select' && preview && (
                                                        <span className="text-xs text-muted-foreground">
                                                            {preview.error ? 'Error' : preview.changedSections.length > 0 ? `${preview.changedSections.length} changing` : 'Matches'}
                                                        </span>
                                                    )}
                                                    {stored && !isSelected && phase === 'select' && (
                                                        <span className="hidden rounded-full bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground sm:inline">Password saved</span>
                                                    )}
                                                </div>
                                                {isSelected && (
                                                    <div className="mt-3 grid gap-1 pl-7 sm:pl-[3.25rem]">
                                                        <Label htmlFor={`${targetId}-pwd`} className="text-xs font-medium text-muted-foreground">Password</Label>
                                                        <div className="relative">
                                                            <Input id={`${targetId}-pwd`} type={showPwd ? 'text' : 'password'} placeholder="Target config password"
                                                                value={password} disabled={editingLocked} onChange={e => setTargetPassword(target.transportUrl, e.target.value)}
                                                                className="h-10 pr-11 font-mono text-sm" aria-invalid={!password.trim()} />
                                                            <Button type="button" variant="ghost" size="icon" tabIndex={-1}
                                                                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                                                onClick={() => setShowPasswords(v => ({ ...v, [target.transportUrl]: !v[target.transportUrl] }))}
                                                                aria-label={showPwd ? 'Hide password' : 'Show password'}>
                                                                {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                                            </Button>
                                                        </div>
                                                        {stored && <p className="text-xs text-muted-foreground">Saved password filled in.</p>}
                                                    </div>
                                                )}
                                            </article>
                                        )
                                    })}
                                </div>
                            ))
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Preview */}
            {phase === 'preview' && previews.size > 0 && (
                <Card className="overflow-hidden border-border/40 bg-card/90 shadow-sm">
                    <CardHeader className="space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <CardTitle className="text-base">Preview</CardTitle>
                                <CardDescription>{previewChangeTotal} area{previewChangeTotal !== 1 ? 's' : ''} will change across {previews.size} target{previews.size !== 1 ? 's' : ''}.</CardDescription>
                            </div>
                            <Button type="button" variant="ghost" size="sm" onClick={resetToSelect}>Back to edit</Button>
                        </div>
                        {preservedLabels.length > 0 && (
                            <div className="rounded-xl border border-info/20 bg-info/5 px-3 py-2.5">
                                <p className="text-xs text-info">Left unchanged: {preservedLabels.join(', ')}.</p>
                            </div>
                        )}
                        <div className="rounded-2xl border border-border/30 bg-muted/[0.08] px-3 py-2 text-xs text-muted-foreground">
                            {previewChanged} will update · {previewSkipped} already match · {previewErrors} need a password or check
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {previewItems.map(preview => {
                            const changedCount = preview.changedSections.length
                            const variant = preview.error ? 'destructive' : changedCount > 0 ? 'warning' : 'success'
                            const icon = preview.error ? <XCircle className="h-3.5 w-3.5" /> : changedCount > 0 ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />
                            const label = preview.error ? 'Needs password/check' : changedCount > 0 ? `${changedCount} change${changedCount !== 1 ? 's' : ''}` : 'Already matches'
                            return (
                                <details key={preview.target.transportUrl} open={!!preview.error} className="overflow-hidden rounded-2xl border border-border/30 bg-muted/[0.06]">
                                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
                                        <AddonIcon name={preview.target.addonName} logo={preview.target.logo} className="h-8 w-8" textClassName="text-xs" />
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-semibold">{preview.target.addonName}</p>
                                            <p className="truncate text-xs text-muted-foreground">{preview.target.accountName}</p>
                                        </div>
                                        <StatusChip variant={variant} icon={icon}>{label}</StatusChip>
                                    </summary>
                                    {preview.error && <div className="border-t border-destructive/10 bg-destructive/5 px-3 py-2 text-xs text-destructive">{preview.error}</div>}
                                    <div className="divide-y divide-border/10">
                                        {preview.entries.map(entry => (
                                            <div key={entry.section} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-2 text-xs">
                                                <span className="flex min-w-0 items-center gap-2 font-medium">
                                                    {entry.changed ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />}
                                                    <span className="truncate">{entry.label}</span>
                                                </span>
                                                <span className="text-muted-foreground/30">{'->'}</span>
                                                <Tooltip content={`${entry.targetSummary} to ${entry.sourceSummary}`}>
                                                  <TooltipTrigger asChild>
                                                    <span className="truncate text-right text-muted-foreground">
                                                      {entry.targetSummary} to {entry.sourceSummary}
                                                    </span>
                                                  </TooltipTrigger>
                                                </Tooltip>
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            )
                        })}
                    </CardContent>
                </Card>
            )}

            {/* Syncing */}
            {phase === 'syncing' && (
                <Card className="border-primary/20 bg-primary/5">
                    <CardContent className="space-y-3 p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-primary" /><p className="text-sm font-semibold">Syncing targets</p></div>
                            <p className="text-xs text-muted-foreground">{progress.current}/{progress.total}</p>
                        </div>
                        <Progress value={syncProgressValue} aria-label="Sync progress" />
                    </CardContent>
                </Card>
            )}

            {/* Results + receipt */}
            {phase === 'results' && results.length > 0 && (
                <Card className="border-border/40">
                    <CardHeader className="space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <CardTitle className="text-base">Sync receipt</CardTitle>
                                <CardDescription>Keep this summary for troubleshooting or repeat runs.</CardDescription>
                            </div>
                            {receipt && (
                                <CopyButton value={receiptText} variant="outline" aria-label="Copy sync receipt">
                                    <span className="ml-1 text-xs font-medium">Copy receipt</span>
                                </CopyButton>
                            )}
                        </div>
                        {receipt && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <ReceiptStat label="Updated" value={receipt.updatedCount} tone="success" />
                                <ReceiptStat label="Matched" value={receipt.skippedCount} tone="success" />
                                <ReceiptStat label="Failed" value={receipt.failedCount} tone="destructive" />
                            </div>
                        )}
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {results.map(result => (
                            <div key={result.target.transportUrl} className={cn('flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs',
                                result.status === 'failed' ? 'border-destructive/20 bg-destructive/5' : result.status === 'skipped' ? 'border-border/30 bg-muted/10' : 'border-success/20 bg-success/5')}>
                                {result.status === 'failed' ? <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" /> : result.status === 'skipped' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />}
                                <span className="truncate font-semibold">{result.target.accountName}</span>
                                <StatusChip className="ml-auto" variant={result.status === 'failed' ? 'destructive' : result.status === 'skipped' ? 'muted' : 'success'}>
                                    {result.restored ? 'Restored' : result.status === 'skipped' ? 'Already matched' : result.status === 'changed' ? 'Updated' : 'Failed'}
                                </StatusChip>
                                {result.status === 'failed' && result.error && <Tooltip content={result.error}><TooltipTrigger asChild><span className="max-w-[180px] truncate text-destructive">{result.error}</span></TooltipTrigger></Tooltip>}
                                {result.status === 'changed' && result.rollbackConfig && !result.restored && (
                                    <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5"
                                        disabled={restoringUrls.has(result.target.transportUrl)} onClick={() => handleRestore(result)}>
                                        {restoringUrls.has(result.target.transportUrl) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                                        Undo
                                    </Button>
                                )}
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

            {/* Action bar */}
            <Card className="border-border/40 bg-card/80">
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs text-muted-foreground">
                        {selectedTargets.size === 0 && phase === 'select' && 'Choose at least one target, or deploy to new accounts above.'}
                        {selectedTargets.size > 0 && selectedMissingPasswordCount > 0 && `${selectedMissingPasswordCount} selected target${selectedMissingPasswordCount !== 1 ? 's' : ''} still need a password.`}
                        {selectedTargets.size > 0 && selectedMissingPasswordCount === 0 && phase === 'select' && 'Preview creates the draft; sync writes it.'}
                        {phase === 'preview' && previewErrors > 0 && 'Fix preview errors before syncing.'}
                        {phase === 'preview' && previewErrors === 0 && previewChanged === 0 && 'Everything already matches. No sync needed.'}
                        {phase === 'preview' && previewErrors === 0 && previewChanged > 0 && 'This draft is locked. Go back to edit, or run sync.'}
                        {phase === 'results' && 'Sync finished. Retry failures, undo individual updates, or start a new run.'}
                    </div>
                    <div className="flex gap-2">
                        {phase === 'select' && (
                            <Button onClick={handlePreview} disabled={!canSync || loadingPreview} className="min-w-[180px] gap-2">
                                {loadingPreview ? <><Loader2 className="h-4 w-4 animate-spin" />Loading preview…</>
                                    : <><ClipboardCheck className="h-4 w-4" />Preview {selectedTargets.size > 0 ? `${selectedTargets.size} target${selectedTargets.size !== 1 ? 's' : ''}` : 'changes'}</>}
                            </Button>
                        )}
                        {phase === 'preview' && (
                            <>
                                <Button variant="outline" onClick={resetToSelect}>Back</Button>
                                <Button onClick={handleSync} disabled={previewErrors > 0 || previewChanged === 0} className="gap-2">
                                    <ArrowRightLeft className="h-4 w-4" />
                                    {previewErrors > 0 ? 'Fix preview first' : previewChanged === 0 ? 'No changes' : 'Run sync'}
                                </Button>
                            </>
                        )}
                        {phase === 'syncing' && <Button disabled className="gap-2"><Loader2 className="h-4 w-4 animate-spin" />Syncing…</Button>}
                        {phase === 'results' && (
                            <>
                                {results.some(r => r.status === 'failed') && (
                                    <Button variant="outline" className="gap-2" onClick={handleRetryFailed}><RotateCw className="h-4 w-4" />Retry failed</Button>
                                )}
                                <Button onClick={() => { setPhase('select'); setResults([]); setPreviews(new Map()); setPreviewAt(null); setReceipt(null) }} className="gap-2">
                                    <ArrowRightLeft className="h-4 w-4" />New sync
                                </Button>
                            </>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

function ReceiptStat({ label, value, tone }: { label: string; value: number; tone: 'success' | 'destructive' }) {
    const toneClass = tone === 'success' ? 'border-success/20 bg-success/5 text-success' : 'border-destructive/20 bg-destructive/5 text-destructive'
    return (
        <div className={cn('rounded-xl border px-3 py-2 text-center', toneClass)}>
            <p className="text-sm font-semibold">{value}</p>
            <p className="text-xs uppercase tracking-wide opacity-75">{label}</p>
        </div>
    )
}
