import { Button } from "@/components/ui/button"
import { StatusChip } from "@/components/ui/status-chip"
import { ToolbarShell } from "@/components/ui/toolbar-shell"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAccountStore } from "@/store/accountStore"
import { useFailoverStore } from "@/store/failoverStore"
import type { FailoverRule } from "@/store/failoverStore"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Activity, Trash2, Plus, History, Pencil, Webhook, Check, Copy, Download, FlaskConical, XCircle, Loader2, Play, Pause, MoreVertical, Shield } from "lucide-react"
import { useState, useMemo, useCallback, useRef } from "react"
import {
    DndContext,
    closestCenter,
    MouseSensor,
    TouchSensor,
    KeyboardSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core'
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { identifyAddon } from "@/lib/addon-identifier"
import { toast } from "@/hooks/use-toast"
import { checkAddonHealth } from "@/lib/addon-health"
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog"
import { Tooltip } from "@/components/ui/tooltip"
import { RuleConfidenceLayer } from "@/components/accounts/RuleConfidenceLayer"
import { FailoverHistory } from "@/components/accounts/FailoverHistory"
import { SortableChainTier, SortableRuleWrapper } from "@/components/accounts/SortableFailoverTiers"
import { WebhooksPanel, testWebhook } from "@/components/accounts/WebhooksPanel"
import { RuleDialog } from "@/components/accounts/RuleDialog"
import type { CustomCheckEntry } from "@/components/accounts/RuleDialog"
import { normalizeAddonUrl } from "@/lib/utils"
import { apiFetch } from "@/lib/http-client"

export type FailoverView = 'rules' | 'history' | 'webhooks'

interface FailoverManagerProps {
    accountId: string
    activeView?: FailoverView
    onActiveViewChange?: (view: FailoverView) => void
    showViewTabs?: boolean
}

export function FailoverManager({
    accountId,
    activeView,
    onActiveViewChange,
    showViewTabs = true,
}: FailoverManagerProps) {
    const accounts = useAccountStore((state) => state.accounts)
    const account = accounts.find((a) => a.id === accountId)
    const rules = useFailoverStore(s => s.rules)
    const addRule = useFailoverStore(s => s.addRule)
    const updateRule = useFailoverStore(s => s.updateRule)
    const removeRule = useFailoverStore(s => s.removeRule)
    const reorderRules = useFailoverStore(s => s.reorderRules)
    const lastWorkerRun = useFailoverStore(s => s.lastWorkerRun)
    const lastCycle = useFailoverStore(s => s.lastCycle)
    const toggleAllRulesForAccount = useFailoverStore(s => s.toggleAllRulesForAccount)
    const isAutopilotLive = !!lastWorkerRun && (Date.now() - new Date(lastWorkerRun).getTime()) < 120_000

    const [simulatingRuleId, setSimulatingRuleId] = useState<string | null>(null)
    const [simulationResults, setSimulationResults] = useState<Record<string, { healthy: boolean; checking: boolean; error?: string }>>({})
    const [simulatedCustomChecks, setSimulatedCustomChecks] = useState<CustomCheckEntry[]>([])
    const [customCheckResults, setCustomCheckResults] = useState<Record<string, { healthy: boolean; checking: boolean; error?: string; code?: number }>>({})
    const [isRuleDialogOpen, setIsRuleDialogOpen] = useState(false)
    const [editingRule, setEditingRule] = useState<FailoverRule | null>(null)
    const [ruleToDelete, setRuleToDelete] = useState<string | null>(null)
    const [localActiveFailoverTab, setLocalActiveFailoverTab] = useState<FailoverView>("rules")
    const activeFailoverTab = activeView ?? localActiveFailoverTab
    const handleFailoverTabChange = useCallback((value: string) => {
        const next = value as FailoverView
        if (activeView === undefined) {
            setLocalActiveFailoverTab(next)
        }
        onActiveViewChange?.(next)
    }, [activeView, onActiveViewChange])

    const openRuleEditor = (rule: FailoverRule) => {
        setEditingRule(rule)
        handleFailoverTabChange("rules")
        setIsRuleDialogOpen(true)
    }

    const otherAccountsWithRules = useMemo(() => {
        return accounts
            .filter(a => a.id !== accountId)
            .map(a => ({
                ...a,
                ruleCount: rules.filter(r => r.accountId === a.id).length
            }))
            .filter(a => a.ruleCount > 0)
    }, [accounts, accountId, rules])

    // Build a cross-account addon lookup ONLY for name resolution of imported/copied rules.
    // This should NOT be used for the selection dropdown.
    const allAddonsForLabeling = useMemo(() => {
        const localAddons = accounts.find(a => a.id === accountId)?.addons || []
        const merged = [...localAddons]
        for (const acc of accounts) {
            if (acc.id === accountId) continue
            for (const addon of acc.addons) {
                if (!merged.some(a => a.transportUrl === addon.transportUrl)) {
                    merged.push(addon)
                }
            }
        }
        return merged
    }, [accounts, accountId])

    const handleDuplicateRule = async (rule: typeof rules[0]) => {
        await addRule(accountId, [...rule.priorityChain], rule.name, rule.cooldown_ms, rule.webhookUrl, rule.notifyEnabled, rule.messageTemplate, rule.customCheckUrls?.map(c => ({ ...c })) || [])
        toast({ title: 'Rule Duplicated', description: 'A copy of the priority chain has been created.' })
    }

    const handleCopyRulesFrom = async (sourceAccountId: string) => {
        const sourceRules = rules.filter(r => r.accountId === sourceAccountId)
        if (sourceRules.length === 0) return

        let imported = 0
        for (const rule of sourceRules) {
            await addRule(
                accountId,
                [...rule.priorityChain],
                rule.name,
                rule.cooldown_ms,
                rule.webhookUrl,
                rule.notifyEnabled,
                rule.messageTemplate,
                rule.customCheckUrls?.map(c => ({ ...c })) || []
            )
            imported++
        }

        const sourceName = accounts.find(a => a.id === sourceAccountId)?.name || 'Unknown'
        toast({
            title: 'Rules Imported',
            description: `Copied ${imported} rule${imported !== 1 ? 's' : ''} from ${sourceName}.`
        })
    }

    const getApplicableCustomChecks = (chain: string[], customCheckUrls?: CustomCheckEntry[]) => {
        const normalizedChainUrls = chain.map(u => normalizeAddonUrl(u).toLowerCase())
        return (customCheckUrls || []).filter(c =>
            c.appliesTo.length === 0 ||
            c.appliesTo.some(au => normalizedChainUrls.includes(normalizeAddonUrl(au).toLowerCase()))
        )
    }

    const handleSimulateRule = async (ruleId: string, chain: string[], customCheckUrls?: CustomCheckEntry[]) => {
        setSimulatingRuleId(ruleId)
        setSimulationResults({})
        setCustomCheckResults({})
        const applicableChecks = getApplicableCustomChecks(chain, customCheckUrls)
        setSimulatedCustomChecks(applicableChecks)

        for (const url of chain) {
            setSimulationResults(prev => ({
                ...prev,
                [url]: { healthy: false, checking: true }
            }))

            try {
                const health = await checkAddonHealth(url)
                setSimulationResults(prev => ({
                    ...prev,
                    [url]: { healthy: health.isOnline, checking: false, error: health.error }
                }))
            } catch (err) {
                setSimulationResults(prev => ({
                    ...prev,
                    [url]: { healthy: false, checking: false, error: 'Check failed' }
                }))
            }
        }

        for (const url of [...new Set(applicableChecks.map(c => c.url))]) {
            setCustomCheckResults(prev => ({
                ...prev,
                [url]: { healthy: false, checking: true }
            }))

            try {
                const { useSyncStore } = await import('@/store/syncStore')
                const { serverUrl } = useSyncStore.getState()
                const result = await apiFetch<{ ok?: boolean; status?: number; error?: string }>('/autopilot/test-url', {
                    method: 'POST',
                    baseUrl: (serverUrl || '').startsWith('http') ? serverUrl : undefined,
                    body: { url },
                })
                if (!result.ok) {
                    setCustomCheckResults(prev => ({
                        ...prev,
                        [url]: { healthy: false, checking: false, error: result.error || `Server error (${result.status})` }
                    }))
                    continue
                }
                const data = result.data
                setCustomCheckResults(prev => ({
                    ...prev,
                    [url]: { healthy: !!data?.ok, checking: false, error: data?.error, code: data?.status }
                }))
            } catch (err) {
                setCustomCheckResults(prev => ({
                    ...prev,
                    [url]: { healthy: false, checking: false, error: 'Request failed' }
                }))
            }
        }
    }

    const getTierClassName = (isActiveInRule: boolean, isTier1: boolean) => {
        if (!isActiveInRule) return 'bg-muted/30 border border-border/40'
        if (isTier1) return 'bg-primary/[0.07] border border-primary/25'
        return 'bg-warning/[0.07] border border-warning/25'
    }

    const dragSensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 3 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    )

    const dragDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleChainDragEnd = useCallback((ruleId: string, currentChain: string[]) => (event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        if (useFailoverStore.getState().isChecking) return
        const oldIndex = currentChain.indexOf(active.id as string)
        const newIndex = currentChain.indexOf(over.id as string)
        if (oldIndex === -1 || newIndex === -1) return
        const newChain = arrayMove(currentChain, oldIndex, newIndex)

        useFailoverStore.setState({
            rules: useFailoverStore.getState().rules.map(r =>
                r.id === ruleId ? { ...r, priorityChain: newChain, activeUrl: newChain[0] } : r
            )
        })

        if (dragDebounceRef.current) clearTimeout(dragDebounceRef.current)
        dragDebounceRef.current = setTimeout(() => {
            updateRule(ruleId, { priorityChain: newChain, activeUrl: newChain[0] })
        }, 800)
    }, [updateRule])


    const handleRuleReorder = useCallback((event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        const currentRules = useFailoverStore.getState().rules.filter(r => r.accountId === accountId)
        const oldIndex = currentRules.findIndex(r => r.id === active.id)
        const newIndex = currentRules.findIndex(r => r.id === over.id)
        if (oldIndex === -1 || newIndex === -1) return
        const reorderedIds = arrayMove(currentRules, oldIndex, newIndex).map(r => r.id)
        reorderRules(accountId, reorderedIds)
    }, [accountId, reorderRules])

    if (!account) return null

    const accountRules = rules.filter(r => r.accountId === accountId)
    const enabledRuleCount = accountRules.filter(rule => rule.isActive).length
    const localAddons = account.addons

    // Use allAddonsForLabeling for name resolution in rule display,
    // but localAddons for the selection dropdown to prevent cross-account leaks.
    const addons = allAddonsForLabeling
    const addonByNormalizedUrl = new Map(
        addons.map(addon => [normalizeAddonUrl(addon.transportUrl), addon] as const)
    )
    const getAddonForUrl = (url?: string) => {
        if (!url) return undefined
        return addonByNormalizedUrl.get(normalizeAddonUrl(url))
    }
    const getAddonNameForUrl = (url?: string) => {
        if (!url) return 'Unknown addon'
        const addon = getAddonForUrl(url)
        return addon?.metadata?.customName || identifyAddon(url, addon?.manifest).name
    }
    const activeFailoverMeta = {
        rules: {
            icon: Activity,
            title: 'Active Rules',
            description: 'Autopilot keeps the highest-priority addon active at all times.',
        },
        history: {
            icon: History,
            title: 'Autopilot History',
            description: 'Review health checks, recovery decisions, and failover switches.',
        },
        webhooks: {
            icon: Webhook,
            title: 'Webhook Routing',
            description: 'Configure global and per-rule notifications for Autopilot events.',
        },
    }[activeFailoverTab]
    const ActiveFailoverIcon = activeFailoverMeta.icon

    return (
        <div className="space-y-6">
            <Tabs value={activeFailoverTab} onValueChange={handleFailoverTabChange} className="space-y-6">
                {showViewTabs && (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <h3 className="text-lg font-semibold flex items-center gap-2">
                                <ActiveFailoverIcon className="w-5 h-5" />
                                {activeFailoverMeta.title}
                            </h3>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {activeFailoverMeta.description}
                            </p>
                        </div>
                        <TabsList className="shrink-0">
                            <TabsTrigger
                                value="rules"
                                className="gap-2"
                            >
                                <Activity className="w-4 h-4" />
                                Rules
                            </TabsTrigger>
                            <TabsTrigger
                                value="history"
                                className="gap-2"
                            >
                                <History className="w-4 h-4" />
                                History
                            </TabsTrigger>
                            <TabsTrigger
                                value="webhooks"
                                className="gap-2"
                            >
                                <Webhook className="w-4 h-4" />
                                Webhooks
                            </TabsTrigger>
                        </TabsList>
                    </div>
                )}

                <TabsContent value="webhooks" className="space-y-6">
                    <WebhooksPanel
                        accountId={accountId}
                        accountName={account.name}
                        accountRules={accountRules}
                        onEditRule={openRuleEditor}
                    />
                </TabsContent>

                <TabsContent value="rules" className="space-y-6">

                    <RuleDialog
                        open={isRuleDialogOpen}
                        onOpenChange={(nextOpen) => { setIsRuleDialogOpen(nextOpen); if (!nextOpen) setEditingRule(null) }}
                        editingRule={editingRule}
                        accountId={accountId}
                        accountName={account.name}
                        localAddons={localAddons}
                        addons={addons}
                        getAddonForUrl={getAddonForUrl}
                        getAddonNameForUrl={getAddonNameForUrl}
                        dragSensors={dragSensors}
                    />

                    <div className="space-y-4">
                        {!showViewTabs && (
                            <div className="flex flex-wrap items-center gap-3">
                                <h3 className="text-lg font-semibold flex items-center gap-2">
                                    <Activity className="w-5 h-5" />
                                    Active Rules
                                </h3>
                                <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
                                    Autopilot keeps the highest-priority addon active at all times.
                                </p>
                            </div>
                        )}

                        {accountRules.length === 0 ? (
                            <div className="rounded-2xl border border-border/40 bg-card p-5 shadow-sm">
                                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-stretch">
                                    <div className="flex flex-col justify-between gap-6">
                                        <div className="space-y-4">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <StatusChip icon={<Shield />} size="md" className="rounded-lg bg-muted/30">
                                                    No rules
                                                </StatusChip>
                                                {lastWorkerRun && (
                                                    <StatusChip size="md" className="rounded-lg bg-muted/30">
                                                        <span className={`h-1.5 w-1.5 rounded-full ${isAutopilotLive ? 'bg-success' : 'bg-warning'}`} />
                                                        {isAutopilotLive ? 'Live' : 'Standby'}
                                                    </StatusChip>
                                                )}
                                            </div>
                                            <div className="max-w-xl space-y-2">
                                                <h4 className="text-xl font-semibold tracking-tight">Create an Autopilot chain</h4>
                                                <p className="text-sm leading-6 text-muted-foreground">
                                                    Pick a primary addon, add fallbacks in priority order, and Autopilot keeps one active when your preferred source goes offline.
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                size="sm"
                                                onClick={() => {
                                                    setEditingRule(null)
                                                    setIsRuleDialogOpen(true)
                                                }}
                                                className="gap-1.5 h-8 text-xs font-medium"
                                            >
                                                <Plus className="h-3.5 w-3.5" />
                                                New Rule
                                            </Button>
                                            {otherAccountsWithRules.length > 0 && (
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs font-medium">
                                                            <Download className="h-3.5 w-3.5" />
                                                            Copy Rules From…
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="start">
                                                        {otherAccountsWithRules.map(a => (
                                                            <DropdownMenuItem key={a.id} onClick={() => handleCopyRulesFrom(a.id)}>
                                                                <div className="flex items-center gap-2">
                                                                    {a.emoji && <span className="shrink-0">{a.emoji}</span>}
                                                                    <span>{a.name} ({a.ruleCount} rule{a.ruleCount !== 1 ? 's' : ''})</span>
                                                                </div>
                                                            </DropdownMenuItem>
                                                        ))}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            )}
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-dashed border-border/50 bg-muted/10 p-4">
                                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Flow</p>
                                        <div className="mt-4 space-y-3">
                                            {['Primary addon stays active', 'Fallbacks wait in priority order', 'Recovery switches back automatically'].map((step, index) => (
                                                <div key={step} className="flex items-center gap-3 text-sm text-muted-foreground">
                                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-card text-xs font-semibold text-foreground">
                                                        {index + 1}
                                                    </span>
                                                    <span>{step}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <>
                            <ToolbarShell>
                                <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px]">
                                    <StatusChip icon={<Shield />} size="md" className="rounded-lg bg-muted/30">
                                        {accountRules.length === 0 ? 'No rules' : `${enabledRuleCount}/${accountRules.length} enabled`}
                                    </StatusChip>
                                    {lastWorkerRun && (
                                        <StatusChip size="md" className="rounded-lg bg-muted/30">
                                            <span className={`h-1.5 w-1.5 rounded-full ${isAutopilotLive ? 'bg-success' : 'bg-warning'}`} />
                                            {isAutopilotLive ? 'Live' : 'Standby'}
                                        </StatusChip>
                                    )}
                                    {lastCycle?.budgetHit && (
                                        <StatusChip
                                            size="md"
                                            variant="primary"
                                            className="rounded-lg"
                                        >
                                            Budgeted scan
                                        </StatusChip>
                                    )}
                                </div>

                                <div className="flex flex-wrap gap-1.5 sm:ml-auto items-center">
                                    {otherAccountsWithRules.length > 0 && (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs font-medium">
                                                    <Download className="h-3.5 w-3.5" />
                                                    <span className="hidden sm:inline">Copy Rules From…</span>
                                                    <span className="sm:hidden">Copy</span>
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="start">
                                                {otherAccountsWithRules.map(a => (
                                                    <DropdownMenuItem key={a.id} onClick={() => handleCopyRulesFrom(a.id)}>
                                                        <div className="flex items-center gap-2">
                                                            {a.emoji && <span className="shrink-0">{a.emoji}</span>}
                                                            <span>{a.name} ({a.ruleCount} rule{a.ruleCount !== 1 ? 's' : ''})</span>
                                                        </div>
                                                    </DropdownMenuItem>
                                                ))}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    )}
                                    {accountRules.length > 0 && (
                                        <>
                                            <Tooltip content="Resume all autopilot rules for this account">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="gap-1.5 h-8 text-xs font-medium"
                                                    onClick={() => toggleAllRulesForAccount(accountId, true)}
                                                >
                                                    <Play className="h-3.5 w-3.5" /> Resume
                                                </Button>
                                            </Tooltip>
                                            <Tooltip content="Pause all autopilot rules for this account">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="gap-1.5 h-8 text-xs font-medium"
                                                    onClick={() => toggleAllRulesForAccount(accountId, false)}
                                                >
                                                    <Pause className="h-3.5 w-3.5" /> Pause
                                                </Button>
                                            </Tooltip>
                                        </>
                                    )}
                                    <Button
                                        size="sm"
                                        onClick={() => {
                                            setEditingRule(null)
                                            setIsRuleDialogOpen(true)
                                        }}
                                        className="gap-1.5 h-8 text-xs font-medium"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        New Rule
                                    </Button>
                                </div>
                            </ToolbarShell>

                        <DndContext
                            sensors={dragSensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleRuleReorder}
                            modifiers={[restrictToVerticalAxis]}
                        >
                            <SortableContext
                                items={accountRules.map(r => r.id)}
                                strategy={verticalListSortingStrategy}
                            >
                                <div className="grid gap-4">
                                    {accountRules.map(rule => {
                                        if (!rule || !rule.priorityChain) return null;
                                        const activeUrl = rule.activeUrl || rule.priorityChain[0]

                                        const activeAddonName = getAddonNameForUrl(activeUrl)
                                        const primaryAddonName = getAddonNameForUrl(rule.priorityChain[0])
                                        return (
                                            <SortableRuleWrapper key={rule.id} id={rule.id}>
                                                <div className="bg-card border border-border/40 rounded-2xl p-5 pl-8 flex flex-col gap-5 shadow-sm min-w-0">
                                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                                <Tooltip content={rule.name || `RULE ${rule.id.slice(0, 8)}`}>
                                                    <div className="font-mono text-xs font-semibold text-foreground/60 uppercase bg-muted/50 border border-border/40 px-2.5 py-1 rounded-lg truncate min-w-0">
                                                        {rule.name || `RULE ${rule.id.slice(0, 8)}`}
                                                    </div>
                                                </Tooltip>
                                                {rule.cooldown_ms && (
                                                    <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-warning opacity-60">
                                                        <Activity className="w-3 h-3" />
                                                        {Math.round(rule.cooldown_ms / 60000)}m
                                                    </div>
                                                )}
                                                {rule.notifyEnabled === false ? (
                                                    <StatusChip icon={<XCircle />} variant="muted">
                                                        Silent
                                                    </StatusChip>
                                                ) : rule.webhookUrl ? (
                                                    <span className="inline-flex items-center gap-1.5 shrink-0">
                                                        <StatusChip icon={<Webhook />} variant="primary">
                                                            Custom
                                                        </StatusChip>
                                                        <Button
                                                            size="sm"
                                                              variant="outline"
                                                              className="hidden h-6 px-2 text-xs font-medium shadow-none sm:inline-flex"
                                                             onClick={(e) => { e.stopPropagation(); testWebhook(rule.webhookUrl, accountId, toast, account.name) }}
                                                        >
                                                            Test Webhook
                                                        </Button>
                                                    </span>
                                                ) : (
                                                    <StatusChip icon={<Webhook />} variant="muted">
                                                        Global
                                                    </StatusChip>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                <div className="flex items-center gap-2 mr-1">
                                                    <span className={`text-xs uppercase font-semibold ${rule.isActive ? 'text-primary' : 'text-foreground/60'}`}>
                                                        {rule.isActive ? 'On' : 'Off'}
                                                    </span>
                                                    <Switch
                                                        checked={rule.isActive}
                                                        onCheckedChange={(c) => updateRule(rule.id, {
                                                            isActive: c,
                                                            isAutomatic: c
                                                        })}
                                                    />
                                                </div>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-foreground/10 text-foreground/60" aria-label="More options">
                                                            <MoreVertical className="w-4 h-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="w-48">
                                                        <DropdownMenuItem className="gap-2" onClick={() => handleSimulateRule(rule.id, rule.priorityChain, rule.customCheckUrls)}>
                                                            <FlaskConical className="w-4 h-4" />
                                                            Simulate Check
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem className="gap-2" onClick={() => openRuleEditor(rule)}>
                                                            <Pencil className="w-4 h-4" />
                                                            Edit Chain
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem className="gap-2" onClick={() => handleDuplicateRule(rule)}>
                                                            <Copy className="w-4 h-4" />
                                                            Duplicate
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onClick={() => setRuleToDelete(rule.id)}>
                                                            <Trash2 className="w-4 h-4" />
                                                            Delete Rule
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </div>

                                        <DndContext
                                            sensors={dragSensors}
                                            collisionDetection={closestCenter}
                                            onDragEnd={handleChainDragEnd(rule.id, rule.priorityChain)}
                                            modifiers={[restrictToVerticalAxis]}
                                        >
                                            <SortableContext
                                                items={rule.priorityChain}
                                                strategy={verticalListSortingStrategy}
                                            >
                                                <div className="flex flex-col relative w-full px-2">
                                                    {rule.priorityChain.map((url, idx) => {
                                                        const addon = getAddonForUrl(url)
                                                        const isActiveInRule = normalizeAddonUrl(url) === normalizeAddonUrl(activeUrl || '')
                                                        const isTier1 = idx === 0
                                                        const isFailedOver = isActiveInRule && !isTier1
                                                        const name = addon?.metadata?.customName || identifyAddon(url, addon?.manifest).name
                                                        const logo = addon?.metadata?.customLogo || addon?.manifest.logo
                                                        return (
                                                            <SortableChainTier
                                                                key={url}
                                                                id={url}
                                                                url={url}
                                                                idx={idx}
                                                                chainLength={rule.priorityChain.length}
                                                                isActiveInRule={isActiveInRule}
                                                                isTier1={isTier1}
                                                                isFailedOver={isFailedOver}
                                                                addonName={name}
                                                                addonLogo={logo}
                                                                getTierClassName={getTierClassName}
                                                            />
                                                        )
                                                    })}
                                                </div>
                                            </SortableContext>
                                        </DndContext>

                                        <RuleConfidenceLayer
                                            rule={rule}
                                            isAutopilotLive={isAutopilotLive}
                                            lastCycle={lastCycle}
                                            activeAddonName={activeAddonName}
                                            primaryAddonName={primaryAddonName}
                                        />

                                        {simulatingRuleId === rule.id && (
                                            <div className="mx-2 p-4 rounded-xl bg-primary/5 border-primary/25 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2 text-primary">
                                                        <FlaskConical className="w-4 h-4" />
                                                        <span className="text-xs font-medium uppercase">Autopilot Simulation</span>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-6 px-2 text-xs font-semibold text-foreground/60 hover:text-foreground"
                                                        onClick={() => setSimulatingRuleId(null)}
                                                    >
                                                        CLOSE
                                                    </Button>
                                                </div>

                                                <div className="space-y-2">
                                                    {rule.priorityChain.map((url, idx) => {
                                                        const result = simulationResults[url]
                                                        const addon = addons.find(a => a.transportUrl === url)
                                                        return (
                                                            <div key={idx} className="flex items-center justify-between text-xs">
                                                                <div className="flex items-center gap-2 text-foreground/70">
                                                                    <span className="font-mono text-xs opacity-30">T{idx + 1}</span>
                                                                    <span className="truncate max-w-[150px]">{addon?.metadata?.customName || identifyAddon(url, addon?.manifest).name}</span>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    {result?.checking ? (
                                                                        <Loader2 className="w-3 h-3 text-primary animate-spin" />
                                                                    ) : result?.healthy ? (
                                                                        <Check className="w-3 h-3 text-success" />
                                                                    ) : result ? (
                                                                        <div className="flex items-center gap-1.5">
                                                                            {!result.healthy && result.error && (
                                                                                <Tooltip content={result.error}>
                                                                                    <span className="text-xs text-foreground/60 truncate max-w-[120px]">
                                                                                        {result.error}
                                                                                    </span>
                                                                                </Tooltip>
                                                                            )}
                                                                            <XCircle className="w-3 h-3 text-destructive" />
                                                                        </div>
                                                                    ) : (
                                                                        <div className="w-3 h-3 rounded-full border border-border/40" />
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>

                                                {simulatedCustomChecks.length > 0 && (
                                                    <div className="space-y-2 pt-2 border-t border-primary/10">
                                                        {[...new Set(simulatedCustomChecks.map(c => c.url))].map(url => {
                                                            const result = customCheckResults[url]
                                                            return (
                                                                <div key={`custom-${url}`} className="flex items-center justify-between text-xs">
                                                                    <div className="flex items-center gap-2 text-foreground/70">
                                                                        <Shield className="w-3 h-3 opacity-40" />
                                                                        <Tooltip content={url}>
                                                                            <span className="truncate max-w-[220px] font-mono">{url}</span>
                                                                        </Tooltip>
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        {result?.checking ? (
                                                                            <Loader2 className="w-3 h-3 text-primary animate-spin" />
                                                                        ) : result?.healthy ? (
                                                                            <span className="flex items-center gap-1">
                                                                                <Check className="w-3 h-3 text-success" />
                                                                                {result.code ? <span className="font-mono text-[10px] text-success/70">{result.code}</span> : null}
                                                                            </span>
                                                                        ) : result ? (
                                                                            <div className="flex items-center gap-1.5">
                                                                                {!result.healthy && result.error && (
                                                                                    <Tooltip content={result.error}>
                                                                                        <span className="text-xs text-foreground/60 truncate max-w-[120px]">
                                                                                            {result.error}
                                                                                        </span>
                                                                                    </Tooltip>
                                                                                )}
                                                                                {result.code ? <span className="text-xs font-mono text-foreground/60">{result.code}</span> : null}
                                                                                <XCircle className="w-3 h-3 text-destructive" />
                                                                            </div>
                                                                        ) : (
                                                                            <div className="w-3 h-3 rounded-full border border-border/40" />
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                )}

                                                {!rule.priorityChain.some(url => simulationResults[url]?.checking) && !simulatedCustomChecks.some(c => customCheckResults[c.url]?.checking) && Object.keys(simulationResults).length > 0 && (
                                                    <div className="pt-2 border-t border-primary/10">
                                                        <p className="text-xs text-foreground/90 leading-relaxed">
                                                            <span className="font-bold text-primary mr-1">CONCLUSION:</span>
                                                            {(() => {
                                                                const primaryUrl = rule.priorityChain[0]
                                                                const normalizedChainUrls = rule.priorityChain.map(u => normalizeAddonUrl(u).toLowerCase())
                                                                const failedCustomUrls = [...new Set(simulatedCustomChecks
                                                                    .filter(c => {
                                                                        const r = customCheckResults[c.url]
                                                                        return !!r && !r.checking && !r.healthy
                                                                    })
                                                                    .map(c => c.url))]
                                                                const isSunkByCustom = (idx: number) => simulatedCustomChecks.some(c => {
                                                                    const r = customCheckResults[c.url]
                                                                    if (!r || r.checking || r.healthy) return false
                                                                    return c.appliesTo.length === 0 || c.appliesTo.some(au => normalizeAddonUrl(au).toLowerCase() === normalizedChainUrls[idx])
                                                                })
                                                                const isEffectivelyHealthy = (idx: number) => Boolean(simulationResults[rule.priorityChain[idx]]?.healthy) && !isSunkByCustom(idx)
                                                                const addonName = (url: string) => {
                                                                    const addon = addons.find(a => a.transportUrl === url)
                                                                    return addon?.metadata?.customName || identifyAddon(url, addon?.manifest).name
                                                                }

                                                                if (isEffectivelyHealthy(0)) {
                                                                    return `${addonName(primaryUrl)} is healthy - no failover needed.`
                                                                }

                                                                if (simulationResults[primaryUrl]?.healthy && failedCustomUrls.length > 0) {
                                                                    const fallbackIdx = rule.priorityChain.findIndex((_, idx) => idx > 0 && isEffectivelyHealthy(idx))
                                                                    const fallbackPart = fallbackIdx !== -1
                                                                        ? ` Would failover to ${addonName(rule.priorityChain[fallbackIdx])}.`
                                                                        : ' No healthy fallback - rule would stay in its current state.'
                                                                    return `${addonName(primaryUrl)} is reachable, but custom check${failedCustomUrls.length !== 1 ? 's' : ''} failed (${failedCustomUrls.join(', ')}) - Autopilot would treat it as unhealthy.${fallbackPart}`
                                                                }

                                                                const healthyFallbackIdx = rule.priorityChain.findIndex((_, idx) => idx > 0 && isEffectivelyHealthy(idx))
                                                                if (healthyFallbackIdx !== -1) {
                                                                    return `Would failover from ${addonName(primaryUrl)} to ${addonName(rule.priorityChain[healthyFallbackIdx])} (first healthy fallback).`
                                                                }

                                                                if (failedCustomUrls.length > 0 && rule.priorityChain.some((url, idx) => idx > 0 && simulationResults[url]?.healthy)) {
                                                                    return `No addon passes all health checks - custom check${failedCustomUrls.length !== 1 ? 's' : ''} failed (${failedCustomUrls.join(', ')}). Rule would stay in its current state.`
                                                                }

                                                                return "All addons in the chain are currently unreachable. Rule would stay in its current state."
                                                            })()}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                                </div>
                                            </SortableRuleWrapper>
                                        )
                                    })}
                                </div>
                            </SortableContext>
                        </DndContext>
                            </>
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="history">
                    <FailoverHistory addons={addons} accountId={accountId} />
                </TabsContent>
            </Tabs>

            <ConfirmationDialog
                open={!!ruleToDelete}
                onOpenChange={(open) => !open && setRuleToDelete(null)}
                title="Delete Rule?"
                description="Are you sure you want to delete this autopilot rule? This cannot be undone."
                confirmText="Delete"
                isDestructive={true}
                onConfirm={() => { if (ruleToDelete) { removeRule(ruleToDelete); setRuleToDelete(null) } }}
            />
        </div >
    )
}
