import { useState, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { AddonIcon } from '@/components/ui/addon-icon'
import { normalizeManifestUrl } from '@/lib/aiostreams-inject'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    fetchAIOStreamsUser,
    getStoredAIOStreamsPassword,
} from '@/lib/aiostreams-utils'
import type { TargetOption } from './AIOStreamsSyncTab'
import { cn } from '@/lib/utils'
import {
    Loader2, AlertTriangle, Lock, GitCompare,
    CheckCircle2, Power, Eye, EyeOff, ArrowRight,
} from 'lucide-react'

type DiffStatus = 'source-only' | 'target-only' | 'different-state' | 'match'

interface DiffEntry {
    key: string
    name: string
    logo?: string
    status: DiffStatus
    sourceEnabled?: boolean
    targetEnabled?: boolean
}

interface DiffCounts {
    sourceOnly: number
    targetOnly: number
    differentState: number
    match: number
}

interface AIOStreamsDiffTabProps {
    sourceConfig: Record<string, unknown>
    targetOptions: TargetOption[]
    vaultLocked: boolean
    onOpenSync?: () => void
}

function getPresetOptions(preset: unknown): Record<string, unknown> {
    if (!preset || typeof preset !== 'object') return {}
    const p = preset as Record<string, unknown>
    const options = p.options
    if (options && typeof options === 'object' && !Array.isArray(options)) {
        return options as Record<string, unknown>
    }
    return {}
}

function getPresetKey(preset: unknown): string {
    if (!preset || typeof preset !== 'object') return ''
    const p = preset as Record<string, unknown>
    const options = getPresetOptions(preset)
    const manifestUrl = typeof options.manifestUrl === 'string' ? options.manifestUrl : ''
    if (manifestUrl) return `manifest:${normalizeManifestUrl(manifestUrl)}`
    const type = typeof p.type === 'string' ? p.type : ''
    const instanceId = typeof p.instanceId === 'string' ? p.instanceId : ''
    if (instanceId) return `${type}:${instanceId}`
    const optionsId = typeof options.id === 'string' ? options.id : ''
    if (optionsId) return `${type}:opt:${optionsId}`
    const name = typeof options.name === 'string'
        ? options.name
        : (typeof p.name === 'string' ? p.name : '')
    return `${type}:name:${name}`
}

function getPresetName(preset: unknown, idx: number): string {
    if (!preset || typeof preset !== 'object') return `Addon ${idx + 1}`
    const p = preset as Record<string, unknown>
    const options = getPresetOptions(preset)
    const raw = options.name || p.name || p.type || p.id || `Addon ${idx + 1}`
    return String(raw)
}

function getPresetLogo(preset: unknown): string | undefined {
    if (!preset || typeof preset !== 'object') return undefined
    const p = preset as Record<string, unknown>
    const options = getPresetOptions(preset)
    const logo = options.logo ?? p.logo
    return typeof logo === 'string' ? logo : undefined
}

function isPresetEnabled(preset: unknown): boolean {
    if (!preset || typeof preset !== 'object') return true
    const p = preset as Record<string, unknown>
    return p.enabled !== false
}

function extractPresets(config: Record<string, unknown>): unknown[] {
    const presets = config.presets
    return Array.isArray(presets) ? presets : []
}

function computePresetDiff(
    sourcePresets: unknown[],
    targetPresets: unknown[]
): DiffEntry[] {
    const sourceMap = new Map<string, { preset: unknown; idx: number }>()
    sourcePresets.forEach((preset, idx) => {
        const key = getPresetKey(preset)
        if (key && !sourceMap.has(key)) sourceMap.set(key, { preset, idx })
    })

    const targetMap = new Map<string, { preset: unknown; idx: number }>()
    targetPresets.forEach((preset, idx) => {
        const key = getPresetKey(preset)
        if (key && !targetMap.has(key)) targetMap.set(key, { preset, idx })
    })

    const entries: DiffEntry[] = []
    const seen = new Set<string>()

    for (const [key, { preset, idx }] of sourceMap) {
        seen.add(key)
        const name = getPresetName(preset, idx)
        const logo = getPresetLogo(preset)
        const sourceEnabled = isPresetEnabled(preset)
        const targetHit = targetMap.get(key)
        if (!targetHit) {
            entries.push({
                key, name, logo,
                status: 'source-only',
                sourceEnabled,
            })
            continue
        }
        const targetEnabled = isPresetEnabled(targetHit.preset)
        const sameState = sourceEnabled === targetEnabled
        entries.push({
            key, name, logo,
            status: sameState ? 'match' : 'different-state',
            sourceEnabled,
            targetEnabled,
        })
    }

    for (const [key, { preset, idx }] of targetMap) {
        if (seen.has(key)) continue
        const name = getPresetName(preset, idx)
        const logo = getPresetLogo(preset)
        const targetEnabled = isPresetEnabled(preset)
        entries.push({
            key, name, logo,
            status: 'target-only',
            targetEnabled,
        })
    }

    const order: Record<DiffStatus, number> = {
        'source-only': 0,
        'target-only': 1,
        'different-state': 2,
        'match': 3,
    }
    entries.sort((a, b) => {
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status]
        return a.name.localeCompare(b.name)
    })

    return entries
}

function summarizeEntries(entries: DiffEntry[]): DiffCounts {
    const counts: DiffCounts = {
        sourceOnly: 0,
        targetOnly: 0,
        differentState: 0,
        match: 0,
    }
    for (const entry of entries) {
        if (entry.status === 'source-only') counts.sourceOnly++
        else if (entry.status === 'target-only') counts.targetOnly++
        else if (entry.status === 'different-state') counts.differentState++
        else counts.match++
    }
    return counts
}

function formatHost(url: string): string {
    try {
        return new URL(url).host
    } catch {
        return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
    }
}

export function AIOStreamsDiffTab({
    sourceConfig,
    targetOptions,
    vaultLocked,
    onOpenSync,
}: AIOStreamsDiffTabProps) {
    const [selectedTargetKey, setSelectedTargetKey] = useState<string>('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [diffEntries, setDiffEntries] = useState<DiffEntry[] | null>(null)
    const [showMatches, setShowMatches] = useState(false)
    const [comparedTargetKey, setComparedTargetKey] = useState<string>('')

    const sourcePresets = useMemo(() => extractPresets(sourceConfig), [sourceConfig])

    const selectedTarget = useMemo(
        () => targetOptions.find(t => `${t.baseUrl}|${t.uuid}` === selectedTargetKey) || null,
        [targetOptions, selectedTargetKey]
    )

    const handleSelectTarget = useCallback((key: string) => {
        setSelectedTargetKey(key)
        setDiffEntries(null)
        setComparedTargetKey('')
        setError('')
        setPassword('')
        const target = targetOptions.find(t => `${t.baseUrl}|${t.uuid}` === key)
        if (target && !vaultLocked) {
            const stored = getStoredAIOStreamsPassword(target.baseUrl, target.uuid)
            if (stored) setPassword(stored)
        }
    }, [targetOptions, vaultLocked])

    const canCompare = !!selectedTarget && password.trim().length > 0 && !loading

    const handleCompare = useCallback(async () => {
        if (!selectedTarget || !password.trim()) return
        setLoading(true)
        setError('')
        setDiffEntries(null)
        try {
            const targetData = await fetchAIOStreamsUser(
                selectedTarget.baseUrl,
                selectedTarget.uuid,
                password
            )
            const targetConfig = targetData.userData as Record<string, unknown>
            const targetPresets = extractPresets(targetConfig)
            const entries = computePresetDiff(sourcePresets, targetPresets)
            setDiffEntries(entries)
            setComparedTargetKey(selectedTargetKey)
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to fetch target config')
        } finally {
            setLoading(false)
        }
    }, [selectedTarget, password, sourcePresets])

    const counts = useMemo(
        () => diffEntries ? summarizeEntries(diffEntries) : null,
        [diffEntries]
    )

    const visibleEntries = useMemo(() => {
        if (!diffEntries) return []
        if (showMatches) return diffEntries
        return diffEntries.filter(entry => entry.status !== 'match')
    }, [diffEntries, showMatches])

    const hasAnyResults = !!counts && (counts.sourceOnly + counts.targetOnly + counts.differentState + counts.match) > 0
    const hasDifferences = !!counts && (counts.sourceOnly + counts.targetOnly + counts.differentState) > 0

    if (targetOptions.length === 0) {
        return (
            <EmptyState
                icon={<GitCompare className="h-6 w-6" />}
                title="No comparison targets"
                description={`Add another AIOStreams instance on another account to compare presets against this one.`}
            />
        )
    }

    return (
        <div className="space-y-5">
            <div className="p-5 rounded-2xl border border-border/40 bg-card/50 shadow-sm space-y-4">
                <div className="space-y-1.5">
                    <Label htmlFor="diff-target" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Compare against
                    </Label>
                    <Select value={selectedTargetKey} onValueChange={handleSelectTarget}>
                        <SelectTrigger id="diff-target" className="h-11">
                            <SelectValue placeholder="Select an AIOStreams instance" />
                        </SelectTrigger>
                        <SelectContent>
                            {targetOptions.map(target => {
                                const isDefault = !target.addonName || target.addonName === 'AIOStreams'
                                const targetKey = `${target.baseUrl}|${target.uuid}`
                                return (
                                <SelectItem key={targetKey} value={targetKey}>
                                    <span className="flex items-center gap-2">
                                        <span className="truncate font-medium">{target.accountName}</span>
                                        {!isDefault && <span className="text-xs text-muted-foreground">{target.addonName}</span>}
                                        <span className="text-xs text-muted-foreground/70">{formatHost(target.baseUrl)}</span>
                                    </span>
                                </SelectItem>
                                )
                            })}
                        </SelectContent>
                    </Select>
                </div>

                {selectedTarget && (
                    <div className="space-y-1.5">
                        <Label htmlFor="diff-password" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            Target password
                        </Label>
                        <div className="relative">
                            <Input
                                id="diff-password"
                                type={showPassword ? 'text' : 'password'}
                                placeholder="AIOStreams instance password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && canCompare && handleCompare()}
                                disabled={loading}
                                className="h-11 pr-10"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:text-foreground"
                                onClick={() => setShowPassword(v => !v)}
                                tabIndex={-1}
                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                            >
                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </Button>
                        </div>
                        {vaultLocked && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-0.5">
                                <Lock className="w-3 h-3" />
                                Vault is locked. Stored passwords are unavailable, enter the password manually.
                            </p>
                        )}
                    </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                    <Button
                        onClick={handleCompare}
                        disabled={!canCompare}
                        className="gap-2"
                        size="default"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitCompare className="w-4 h-4" />}
                        {loading ? 'Comparing...' : 'Compare presets'}
                    </Button>
                    {comparedTargetKey && comparedTargetKey === selectedTargetKey && !loading && (
                        <span className="text-xs text-muted-foreground">
                            Compared {sourcePresets.length} source presets against target
                        </span>
                    )}
                </div>

                {error && (
                    <div className="flex items-start gap-2 text-destructive text-sm bg-destructive/10 p-3 rounded-lg border border-destructive/20" role="alert">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <p className="min-w-0">{error}</p>
                    </div>
                )}
            </div>

            {loading && (
                <div className="space-y-3">
                    <Skeleton className="h-24 w-full rounded-xl" />
                    <Skeleton className="h-48 w-full rounded-xl" />
                </div>
            )}

            {!loading && counts && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <DiffStatCard
                            value={counts.sourceOnly}
                            label="In source only"
                            tone="info"
                        />
                        <DiffStatCard
                            value={counts.targetOnly}
                            label="In target only"
                            tone="warning"
                        />
                        <DiffStatCard
                            value={counts.differentState}
                            label="Different state"
                            tone="destructive"
                        />
                        <DiffStatCard
                            value={counts.match}
                            label="Match"
                            tone="success"
                        />
                    </div>

                    {!hasAnyResults && (
                        <EmptyState
                            icon={<GitCompare className="h-6 w-6" />}
                            title="No presets to compare"
                            description="Neither instance has addon presets configured."
                        />
                    )}

                    {hasAnyResults && !hasDifferences && (
                        <div className="p-5 rounded-2xl border border-success/25 bg-success/5 shadow-sm flex items-center gap-3">
                            <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
                            <div className="min-w-0">
                                <p className="text-sm font-semibold">Presets match</p>
                                <p className="text-xs text-muted-foreground">Both instances have identical addon presets and enabled states.</p>
                            </div>
                        </div>
                    )}

                    {hasDifferences && visibleEntries.length > 0 && (
                        <div className="space-y-4">
                            {counts.match > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setShowMatches(v => !v)}
                                    className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
                                >
                                    {showMatches ? 'Hide' : 'Show'} {counts.match} matching preset{counts.match !== 1 ? 's' : ''}
                                </button>
                            )}

                            <DiffGroup
                                title="In source only"
                                description="Presets on this instance missing from the target"
                                tone="info"
                                entries={visibleEntries.filter(e => e.status === 'source-only')}
                            />
                            <DiffGroup
                                title="In target only"
                                description="Presets on the target missing from this instance"
                                tone="warning"
                                entries={visibleEntries.filter(e => e.status === 'target-only')}
                            />
                            <DiffGroup
                                title="Different enabled state"
                                description="Same addon exists on both, but enabled differs"
                                tone="destructive"
                                entries={visibleEntries.filter(e => e.status === 'different-state')}
                            />
                            {showMatches && (
                                <DiffGroup
                                    title="Match"
                                    description="Same addon, same enabled state"
                                    tone="success"
                                    entries={visibleEntries.filter(e => e.status === 'match')}
                                />
                            )}
                        </div>
                    )}
                </>
            )}

            {!loading && !counts && !error && (
                <EmptyState
                    icon={<GitCompare className="h-6 w-6" />}
                    title="Select a target to compare"
                    description={`Pick another AIOStreams instance above and enter its password to see which presets differ. This is a read-only comparison.`}
                    action={onOpenSync ? <Button variant="outline" size="sm" className="gap-2" onClick={onOpenSync}><ArrowRight className="h-3.5 w-3.5" /> Open Sync</Button> : undefined}
                />
            )}
        </div>
    )
}

function DiffStatCard({ value, label, tone }: {
    value: number
    label: string
    tone: 'info' | 'warning' | 'destructive' | 'success'
}) {
    const toneClasses: Record<typeof tone, string> = {
        info: 'text-info',
        warning: 'text-warning',
        destructive: 'text-destructive',
        success: 'text-success',
    }
    return (
        <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
            <p className={cn('text-xl font-semibold tabular-nums', toneClasses[tone])}>{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        </div>
    )
}

function DiffGroup({ title, description, tone, entries }: {
    title: string
    description: string
    tone: 'info' | 'warning' | 'destructive' | 'success'
    entries: DiffEntry[]
}) {
    if (entries.length === 0) return null
    const accentClasses: Record<typeof tone, string> = {
        info: 'border-info/20',
        warning: 'border-warning/25',
        destructive: 'border-destructive/25',
        success: 'border-success/25',
    }
    return (
        <div className={cn('rounded-2xl border bg-card/40 shadow-sm overflow-hidden', accentClasses[tone])}>
            <div className="px-4 py-3 border-b border-border/30 bg-muted/5">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-sm font-semibold">{title}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                    </div>
                    <span className="text-xs font-semibold text-muted-foreground tabular-nums shrink-0">
                        {entries.length}
                    </span>
                </div>
            </div>
            <div className="divide-y divide-border/20">
                {entries.map(entry => (
                    <DiffRow key={`${entry.status}:${entry.key}`} entry={entry} />
                ))}
            </div>
        </div>
    )
}

function DiffRow({ entry }: { entry: DiffEntry }) {
    const sideLabel: Record<DiffStatus, string> = {
        'source-only': 'Source',
        'target-only': 'Target',
        'different-state': 'Both',
        'match': 'Both',
    }
    return (
        <div className="flex items-center gap-3 px-4 py-3">
            <AddonIcon
                name={entry.name}
                logo={entry.logo}
                alt={entry.name}
                className="h-8 w-8"
                textClassName="text-xs"
            />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{entry.name}</p>
                <p className="text-xs text-muted-foreground">{sideLabel[entry.status]}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                {entry.status === 'different-state' ? (
                    <>
                        <StateBadge label="Source" enabled={!!entry.sourceEnabled} />
                        <StateBadge label="Target" enabled={!!entry.targetEnabled} />
                    </>
                ) : entry.status === 'source-only' ? (
                    <StateBadge label={entry.sourceEnabled ? 'Enabled' : 'Disabled'} enabled={!!entry.sourceEnabled} />
                ) : entry.status === 'target-only' ? (
                    <StateBadge label={entry.targetEnabled ? 'Enabled' : 'Disabled'} enabled={!!entry.targetEnabled} />
                ) : (
                    <StateBadge label={entry.sourceEnabled ? 'Enabled' : 'Disabled'} enabled={!!entry.sourceEnabled} />
                )}
            </div>
        </div>
    )
}

function StateBadge({ label, enabled }: { label: string; enabled: boolean }) {
    return (
        <span className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide',
            enabled ? 'bg-success/10 text-success' : 'bg-muted/35 text-muted-foreground'
        )}>
            <Power className="w-3 h-3" />
            {label}
        </span>
    )
}
