import { Activity, AlertTriangle, ArrowRight, Check, Pause, Shield, XCircle, type LucideIcon } from 'lucide-react'
import { StatusChip } from '@/components/ui/status-chip'
import { formatRelative, useRelativeTime } from '@/hooks/use-relative-time'
import { normalizeAddonUrl } from '@/lib/utils'
import type { AutopilotCycleStats, AutopilotStabilizationEntry, FailoverRule } from '@/store/failoverStore'

type ConfidenceVariant = 'muted' | 'primary' | 'success' | 'warning' | 'destructive'

interface RuleConfidenceLayerProps {
    rule: FailoverRule
    isAutopilotLive: boolean
    lastCycle?: AutopilotCycleStats
    activeAddonName: string
    primaryAddonName: string
}

interface ConfidenceState {
    label: string
    variant: ConfidenceVariant
    icon: LucideIcon
    detail: string
    proof?: string
}

function readCheckedAt(rule: FailoverRule) {
    if (!rule.lastCheck) return null
    const checkedAt = rule.lastCheck instanceof Date ? rule.lastCheck : new Date(rule.lastCheck)
    return Number.isFinite(checkedAt.getTime()) ? checkedAt : null
}

function readStabilizationEntry(rule: FailoverRule, url?: string): AutopilotStabilizationEntry {
    if (!url || !rule.stabilization) return {}
    const normalizedUrl = normalizeAddonUrl(url)
    const candidates = [url, url.toLowerCase(), normalizeAddonUrl(url), normalizedUrl]
    for (const key of candidates) {
        const entry = rule.stabilization[key]
        if (entry !== undefined) return normalizeStabilizationEntry(entry)
    }
    for (const [key, entry] of Object.entries(rule.stabilization)) {
        if (normalizeAddonUrl(key) === normalizedUrl) {
            return normalizeStabilizationEntry(entry)
        }
    }
    return {}
}

function normalizeStabilizationEntry(entry: number | AutopilotStabilizationEntry): AutopilotStabilizationEntry {
    if (typeof entry === 'number') {
        return {
            failures: entry < 0 ? Math.abs(entry) : 0,
            successes: entry > 0 ? entry : 0,
            latencyMs: null,
        }
    }
    const failures = Number(entry.failures)
    const successes = Number(entry.successes)
    const latencyMs = Number(entry.latencyMs)
    return {
        failures: Number.isFinite(failures) ? failures : 0,
        successes: Number.isFinite(successes) ? successes : 0,
        latencyMs: typeof entry.latencyMs === 'number' && Number.isFinite(latencyMs) ? latencyMs : null,
    }
}

function getConfidenceState(
    rule: FailoverRule,
    isAutopilotLive: boolean,
    lastCycle: AutopilotCycleStats | undefined,
    activeAddonName: string,
    primaryAddonName: string
): ConfidenceState {
    const primaryUrl = rule.priorityChain[0]
    const activeUrl = rule.activeUrl || primaryUrl
    const primaryNorm = normalizeAddonUrl(primaryUrl || '')
    const activeNorm = normalizeAddonUrl(activeUrl || '')
    const chainNorms = new Set(rule.priorityChain.map(url => normalizeAddonUrl(url)))
    const checkedAt = readCheckedAt(rule)
    const ageMs = checkedAt ? Date.now() - checkedAt.getTime() : null
    const staleMs = lastCycle?.budgetHit ? 60 * 60 * 1000 : 15 * 60 * 1000
    const primaryEntry = readStabilizationEntry(rule, primaryUrl)
    const activeEntry = readStabilizationEntry(rule, activeUrl)
    const primaryFailures = primaryEntry.failures || 0
    const activeFailures = activeEntry.failures || 0
    const isFailedOver = !!activeNorm && !!primaryNorm && activeNorm !== primaryNorm

    if (!rule.isActive) {
        return {
            label: 'Paused',
            variant: 'muted',
            icon: Pause,
            detail: 'Rule is paused; Autopilot will not enforce changes.',
        }
    }

    if (rule.isAutomatic === false) {
        return {
            label: 'Manual',
            variant: 'primary',
            icon: Shield,
            detail: 'Manual mode is active; the current addon is preserved.',
            proof: `Active: ${activeAddonName}`,
        }
    }

    if (!isAutopilotLive) {
        return {
            label: 'Standby',
            variant: 'warning',
            icon: Activity,
            detail: 'Worker heartbeat is stale; waiting for fresh confirmation.',
            proof: checkedAt ? `Last confirmed check was ${formatRelative(checkedAt) || 'just now'}.` : 'No server check has been recorded yet.',
        }
    }

    if (!checkedAt) {
        return {
            label: 'Pending',
            variant: 'primary',
            icon: Activity,
            detail: 'Waiting for the first server-side health check.',
            proof: lastCycle ? `${lastCycle.scanned} rules were scanned in the latest cycle.` : 'No worker cycle has reported yet.',
        }
    }

    if (activeNorm && !chainNorms.has(activeNorm)) {
        return {
            label: 'Needs attention',
            variant: 'destructive',
            icon: XCircle,
            detail: 'Active addon is outside this priority chain.',
            proof: `Active: ${activeAddonName}`,
        }
    }

    if (ageMs !== null && ageMs > staleMs) {
        return {
            label: 'Stale',
            variant: 'warning',
            icon: AlertTriangle,
            detail: 'Last check is older than expected for this worker cadence.',
            proof: `Last check was ${formatRelative(checkedAt) || 'just now'}.`,
        }
    }

    if (lastCycle?.budgetHit && ageMs !== null && ageMs > 120_000) {
        return {
            label: 'Queued',
            variant: 'primary',
            icon: Activity,
            detail: 'Large-instance scan budget is active; this rule may wait for the cursor.',
            proof: `${lastCycle.scanned} rules were scanned in ${Math.round(lastCycle.durationMs / 1000)}s.`,
        }
    }

    if (primaryFailures >= 2 && !isFailedOver) {
        return {
            label: 'Needs attention',
            variant: 'destructive',
            icon: AlertTriangle,
            detail: 'Primary has repeated failures but is still marked active.',
            proof: `${primaryAddonName} has ${primaryFailures} consecutive misses.`,
        }
    }

    if (activeFailures >= 2) {
        return {
            label: 'Needs attention',
            variant: 'destructive',
            icon: AlertTriangle,
            detail: 'Active addon has repeated failures and no healthier fallback is active.',
            proof: `${activeAddonName} has ${activeFailures} consecutive misses.`,
        }
    }

    if (isFailedOver) {
        return {
            label: 'Backup active',
            variant: 'warning',
            icon: ArrowRight,
            detail: 'Fallback is active to protect playback.',
            proof: primaryFailures > 0
                ? `${primaryAddonName} missed ${primaryFailures} checks. Active addon: ${activeAddonName}.`
                : `Active: ${activeAddonName}`,
        }
    }

    return {
        label: 'No action needed',
        variant: 'success',
        icon: Check,
        detail: 'Primary addon is active; no change is needed.',
    }
}

export function RuleConfidenceLayer({ rule, isAutopilotLive, lastCycle, activeAddonName, primaryAddonName }: RuleConfidenceLayerProps) {
    const formatRelativeLabel = useRelativeTime()
    const checkedAt = readCheckedAt(rule)
    const activeUrl = rule.activeUrl || rule.priorityChain[0]
    const activeEntry = readStabilizationEntry(rule, activeUrl)
    const confidence = getConfidenceState(rule, isAutopilotLive, lastCycle, activeAddonName, primaryAddonName)
    const Icon = confidence.icon
    const lastCheckLabel = checkedAt ? `Last checked ${formatRelativeLabel(checkedAt) || 'just now'}` : 'Check pending'
    const latencyLabel = typeof activeEntry.latencyMs === 'number' ? `Latency ${Math.round(activeEntry.latencyMs)}ms` : null

    return (
        <div className="mx-2 rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <StatusChip variant={confidence.variant} size="sm">
                        <Icon />
                        {confidence.label}
                    </StatusChip>
                    <span className="min-w-0 truncate text-sm text-foreground/90">
                        {confidence.detail}
                    </span>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <StatusChip variant="muted" size="sm">
                        {lastCheckLabel}
                    </StatusChip>
                    {latencyLabel && (
                        <StatusChip variant="muted" size="sm">
                            {latencyLabel}
                        </StatusChip>
                    )}
                    {lastCycle?.budgetHit && (
                        <StatusChip variant="primary" size="sm">
                            {lastCycle.scanned} scanned
                        </StatusChip>
                    )}
                </div>
            </div>
            {confidence.proof && <p className="mt-1 text-xs text-muted-foreground/60">{confidence.proof}</p>}
        </div>
    )
}
