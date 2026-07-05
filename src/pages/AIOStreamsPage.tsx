import { useState, useCallback, useEffect, useMemo, useRef, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { CopyButton } from '@/components/ui/copy-button'
import { StatusChip } from '@/components/ui/status-chip'
import { ToolbarShell } from '@/components/ui/toolbar-shell'
import { AddonIcon } from '@/components/ui/addon-icon'
import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
    CardFooter,
} from '@/components/ui/card'
import { useAccountStore, getAccountEmail } from '@/store/accountStore'
import {
    isAIOStreamsAddon,
    parseAIOStreamsUrl,
    fetchAIOStreamsUser,
    getAIOStreamsConfigureUrl,
    getStoredAIOStreamsPassword,
    saveAIOStreamsPassword,
    migrateAIOStreamsVaultNames,
    fetchAIOStreamsStatus,
    getConfigSections,
    getSectionSummary,
    getConfigStats,
} from '@/lib/aiostreams-utils'
import { AIOStreamsSyncTab, TargetOption, MissingTargetAccount } from '@/components/addons/aiostreams/AIOStreamsSyncTab'
import { AIOStreamsActionsTab } from '@/components/addons/aiostreams/AIOStreamsActionsTab'
import { cn } from '@/lib/utils'
import {
    ArrowLeft, Loader2, AlertTriangle, ExternalLink,
    Eye, ArrowRightLeft, EyeOff, Lock, Shield,
    Wifi, RefreshCw,
    Tv, Users,
    Link2, Server, Layers,
} from 'lucide-react'

type Section = 'overview' | 'addons-services' | 'users' | 'sync'

const SIDEBAR_ITEMS: { id: Section; label: string; icon: React.ReactNode; group: 'config' | 'actions' }[] = [
    { id: 'overview', label: 'Overview', icon: <Eye className="w-4 h-4" />, group: 'config' },
    { id: 'addons-services', label: 'Addons & Services', icon: <Tv className="w-4 h-4" />, group: 'config' },
    { id: 'users', label: 'Users', icon: <Users className="w-4 h-4" />, group: 'actions' },
    { id: 'sync', label: 'Sync', icon: <ArrowRightLeft className="w-4 h-4" />, group: 'actions' },
]

export function AIOStreamsPage() {
    const { accountId, uuid } = useParams<{ accountId: string; uuid: string }>()
    const navigate = useNavigate()
    const accounts = useAccountStore(s => s.accounts)

    const account = useMemo(() => accounts.find(a => a.id === accountId), [accounts, accountId])
    const addon = useMemo(() => {
        if (!account) return null
        return account.addons.find(a => {
            if (!isAIOStreamsAddon(a)) return false
            const p = parseAIOStreamsUrl(a.transportUrl)
            return p?.uuid === uuid
        })
    }, [account, uuid])

    const parsed = useMemo(() => addon ? parseAIOStreamsUrl(addon.transportUrl) : null, [addon])
    const baseUrl = parsed?.baseUrl ?? ''
    const shouldRedirect = !addon || !account || !uuid

    const [connected, setConnected] = useState(false)
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [rememberPassword, setRememberPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [activeSection, setActiveSection] = useState<Section>('overview')
    const [sourceConfig, setSourceConfig] = useState<Record<string, unknown> | null>(null)
    const [instanceStatus, setInstanceStatus] = useState<Record<string, unknown> | null>(null)
    const [instanceReachable, setInstanceReachable] = useState(true)

    const passwordRef = useRef<HTMLInputElement>(null)

    const targetOptions: TargetOption[] = useMemo(() => accounts.flatMap(acc =>
        (acc.addons || [])
            .filter(a => {
                if (!isAIOStreamsAddon(a)) return false
                const p = parseAIOStreamsUrl(a.transportUrl)
                return p && !(p.baseUrl === baseUrl && p.uuid === uuid)
            })
            .map(a => {
                const p = parseAIOStreamsUrl(a.transportUrl)
                if (!p) return null
                return {
                    accountId: acc.id,
                    accountName: acc.name || getAccountEmail(acc) || acc.id,
                    addonName: a.metadata?.customName || a.manifest.name || 'AIOStreams',
                    transportUrl: a.transportUrl,
                    baseUrl: p.baseUrl,
                    uuid: p.uuid,
                    logo: a.metadata?.customLogo || a.manifest.logo,
                }
            })
    ).filter(Boolean) as TargetOption[], [accounts, uuid, baseUrl])

    const missingAIOStreamsAccounts: MissingTargetAccount[] = useMemo(() => accounts
        .filter(acc => acc.id !== accountId && !(acc.addons || []).some(isAIOStreamsAddon))
        .map(acc => ({
            accountId: acc.id,
            accountName: acc.name || getAccountEmail(acc) || acc.id,
        })), [accounts, accountId])

    const sameUserAccounts = useMemo(() => accounts
        .filter(acc => acc.id !== accountId && acc.addons.some(a => {
            if (!isAIOStreamsAddon(a)) return false
            const p = parseAIOStreamsUrl(a.transportUrl)
            return p?.baseUrl === baseUrl && p.uuid === uuid
        }))
        .map(acc => ({
            id: acc.id,
            name: acc.name,
            email: getAccountEmail(acc),
            emoji: acc.emoji,
        })), [accounts, accountId, baseUrl, uuid])

    const linkedAccounts = useMemo(() => accounts.filter(acc =>
        acc.id !== accountId && acc.addons.some(a => {
            if (!isAIOStreamsAddon(a)) return false
            const p = parseAIOStreamsUrl(a.transportUrl)
            return p?.baseUrl === baseUrl && p.uuid !== uuid
        })
    ), [accounts, accountId, baseUrl, uuid])

    useEffect(() => {
        if (!addon) {
            navigate(`/account/${accountId}`)
            return
        }

        migrateAIOStreamsVaultNames().catch(() => {})
        setConnected(false)
        setError('')
        setSourceConfig(null)
        setActiveSection('overview')
        setInstanceStatus(null)
        setInstanceReachable(true)
        fetchAIOStreamsStatus(baseUrl).then(s => {
            if (s) setInstanceStatus(s)
            else setInstanceReachable(false)
        }).catch(() => setInstanceReachable(false))
        const stored = getStoredAIOStreamsPassword(baseUrl, uuid || '')
        if (stored) {
            setPassword(stored)
            setRememberPassword(true)
        } else {
            setPassword('')
            setRememberPassword(false)
        }
    }, [addon, baseUrl, uuid, accountId, navigate])

    useEffect(() => {
        if (!connected) {
            setTimeout(() => passwordRef.current?.focus(), 100)
        }
    }, [connected])

    const handleConnect = useCallback(async () => {
        if (!password.trim() || !uuid) { setError('Password is required'); return }
        setLoading(true)
        setError('')
        try {
            const data = await fetchAIOStreamsUser(baseUrl, uuid, password)
            const config = data.userData as Record<string, unknown>
            setSourceConfig(config)
            if (rememberPassword) {
                try { await saveAIOStreamsPassword(baseUrl, uuid, password) } catch { /* non-critical */ }
            }
            setConnected(true)
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to connect')
        } finally {
            setLoading(false)
        }
    }, [baseUrl, uuid, password, rememberPassword])

    const handleRefresh = useCallback(async () => {
        if (!password || !uuid) return
        setLoading(true)
        try {
            const data = await fetchAIOStreamsUser(baseUrl, uuid, password)
            const config = data.userData as Record<string, unknown>
            setSourceConfig(config)
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to refresh')
        } finally {
            setLoading(false)
        }
    }, [baseUrl, uuid, password])

    useEffect(() => {
        if (shouldRedirect) {
            navigate(accountId ? `/account/${accountId}` : '/', { replace: true })
        }
    }, [accountId, navigate, shouldRedirect])

    if (shouldRedirect) {
        return null
    }

    const addonName = addon.manifest.name || 'AIOStreams'
    const accountLabel = account.name || getAccountEmail(account) || accountId || 'Unknown account'
    const configureUrl = getAIOStreamsConfigureUrl(addon.transportUrl)
    const encryptedPassword = (sourceConfig as Record<string, unknown>)?.encryptedPassword as string | undefined
    const installUrl = encryptedPassword
        ? `${baseUrl}/stremio/${uuid}/${encryptedPassword}/manifest.json`
        : null

    const changeSection = (s: Section) => setActiveSection(s)

    return (
        <div className="w-full mx-auto py-6 px-4 md:px-8 lg:px-12 xl:px-16 space-y-4 max-w-[1800px]">
            <ToolbarShell className="w-fit max-w-full p-2" contentClassName="gap-2">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-2 px-2.5 text-muted-foreground hover:text-foreground"
                    onClick={() => navigate(`/account/${accountId}`)}
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                </Button>
            </ToolbarShell>

            {!connected ? (
                <CredentialsGate
                    password={password}
                    setPassword={setPassword}
                    showPassword={showPassword}
                    setShowPassword={setShowPassword}
                    rememberPassword={rememberPassword}
                    setRememberPassword={setRememberPassword}
                    loading={loading}
                    error={error}
                    passwordRef={passwordRef}
                    onConnect={handleConnect}
                    configureUrl={configureUrl}
                />
            ) : (
                <div className="flex flex-col md:flex-row gap-6 min-h-[calc(100vh-14rem)]">
                    <div className="w-full md:w-56 lg:w-64 shrink-0 flex flex-col gap-3">
                        <div className="hidden bg-card border border-border/40 rounded-2xl p-3 shadow-sm space-y-1 md:block">
                            <div className="flex items-center justify-between px-2 py-1.5 mb-1 shrink-0">
                                <h2 className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">Summary</h2>
                            </div>
                            <DesktopSidebar activeSection={activeSection} onChange={changeSection} group="core" />
                        </div>
                        
                        <div className="hidden bg-card border border-border/40 rounded-2xl p-3 shadow-sm space-y-1 md:block">
                            <div className="flex items-center justify-between px-2 py-1.5 mb-1 shrink-0">
                                <h2 className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">Orchestration</h2>
                            </div>
                            <DesktopSidebar activeSection={activeSection} onChange={changeSection} group="advanced" />
                        </div>

                        <div className="md:hidden px-4 pb-4">
                            <MobileSectionBar activeSection={activeSection} onChange={changeSection} />
                        </div>
                    </div>

                    <div className="flex-1 min-w-0 bg-card border border-border/40 rounded-2xl overflow-hidden shadow-sm flex flex-col">
                        <div className="p-4 md:p-6 border-b border-border/40 bg-muted/5 shrink-0">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                    <AddonIcon
                                        name={addonName}
                                        logo={addon.metadata?.customLogo || addon.manifest.logo}
                                        alt={addonName}
                                        className="h-10 w-10"
                                        textClassName="text-sm"
                                    />
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h1 className="text-lg font-bold tracking-tight truncate">{addonName}</h1>
                                            <StatusChip variant={instanceReachable ? 'success' : 'destructive'} icon={<Wifi className="w-3 h-3" />} className="rounded-lg">
                                                {instanceReachable ? 'Connected' : 'Unreachable'}
                                            </StatusChip>
                                            <StatusChip variant="muted" icon={<Users className="w-3 h-3" />} className="rounded-lg max-w-[14rem] sm:max-w-[18rem]">
                                                <span className="truncate">
                                                    {account.emoji ? `${account.emoji} ` : ''}{accountLabel}
                                                </span>
                                            </StatusChip>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5 text-xs text-muted-foreground">
                                            <span className="font-mono truncate">{baseUrl}</span>
                                            {instanceStatus && typeof instanceStatus.tag === 'string' && (
                                                <span className="shrink-0">v{instanceStatus.tag}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <Button
                                        variant="ghost"
                                        className="gap-2 text-muted-foreground h-9"
                                        onClick={handleRefresh}
                                        disabled={loading}
                                        size="sm"
                                    >
                                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                                        Refresh
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="p-4 md:p-8 flex-1 overflow-y-auto scrollbar-hide">
                            {sourceConfig ? (
                                <SectionContent
                                    activeSection={activeSection}
                                    sourceConfig={sourceConfig}
                                    baseUrl={baseUrl}
                                    configureUrl={configureUrl}
                                    uuid={uuid}
                                    targetOptions={targetOptions}
                                    accountName={account.name || getAccountEmail(account) || accountId || ''}
                                    linkedAccounts={linkedAccounts.map(acc => ({
                                        id: acc.id,
                                        name: acc.name,
                                        email: getAccountEmail(acc),
                                        emoji: acc.emoji,
                                    }))}
                                    sameUserAccounts={sameUserAccounts}
                                    instanceStatus={instanceStatus}
                                    installUrl={installUrl}
                                    accountId={accountId!}
                                    transportUrl={addon?.transportUrl ?? ''}
                                    missingAccounts={missingAIOStreamsAccounts}
                                    onClose={() => navigate(`/account/${accountId}`)}
                                />
                            ) : (
                                <div className="space-y-4">
                                    <Skeleton className="h-32 w-full rounded-xl" />
                                    <Skeleton className="h-64 w-full rounded-xl" />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

function CredentialsGate({ password, setPassword, showPassword, setShowPassword, rememberPassword, setRememberPassword, loading, error, passwordRef, onConnect, configureUrl }: {
    password: string
    setPassword: (v: string) => void
    showPassword: boolean
    setShowPassword: (v: boolean) => void
    rememberPassword: boolean
    setRememberPassword: (v: boolean) => void
    loading: boolean
    error: string
    passwordRef: React.RefObject<HTMLInputElement | null>
    onConnect: () => void
    configureUrl: string | null
}) {
    return (
        <div className="max-w-md mx-auto my-12">
            <Card className="border border-border/40 shadow-sm bg-card relative overflow-hidden">
                <CardHeader className="text-center relative z-10">
                    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-muted/35 text-muted-foreground ring-1 ring-border/40">
                        <Lock className="w-5 h-5" />
                    </div>
                    <CardTitle className="text-xl">Authentication Required</CardTitle>
                    <CardDescription>
                        Enter the AIOStreams instance password to manage this user.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 relative z-10">
                    <div className="space-y-2">
                        <Label htmlFor="password" className="text-xs font-medium text-muted-foreground uppercase">Password</Label>
                        <div className="relative">
                            <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                                id="password"
                                ref={passwordRef}
                                type={showPassword ? 'text' : 'password'}
                                placeholder="Instance password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && onConnect()}
                                disabled={loading}
                                className="pl-9 pr-10 h-11"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:text-foreground"
                                onClick={() => setShowPassword(!showPassword)}
                                tabIndex={-1}
                                aria-label={showPassword ? "Hide password" : "Show password"}
                            >
                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </Button>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Checkbox id="remember" checked={rememberPassword} onCheckedChange={(c) => setRememberPassword(!!c)} />
                        <Label htmlFor="remember" className="text-sm font-normal cursor-pointer">Remember password locally</Label>
                    </div>
                    {error && (
                        <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 p-3 rounded-lg border border-destructive/20" role="alert">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <p>{error}</p>
                        </div>
                    )}
                </CardContent>
                <CardFooter className="relative z-10 flex flex-col gap-2">
                    <Button onClick={onConnect} disabled={loading || !password.trim()} className="w-full shine-sweep gap-2" size="xl">
                        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                        {loading ? 'Connecting...' : 'Connect'}
                    </Button>
                    {configureUrl && (
                        <Button variant="outline" size="lg" className="w-full gap-2" asChild>
                            <a href={configureUrl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="w-4 h-4" />
                                Open in AIOStreams
                            </a>
                        </Button>
                    )}
                </CardFooter>
            </Card>
        </div>
    )
}

function MobileSectionBar({ activeSection, onChange }: { activeSection: Section; onChange: (s: Section) => void }) {
    return (
        <div className="md:hidden -mx-4 px-4 pb-1">
            <div className="flex flex-wrap gap-1.5 rounded-2xl border border-border/40 bg-card p-1.5 shadow-sm">
                {SIDEBAR_ITEMS.map((item, i) => {
                    const isActive = activeSection === item.id
                    return (
                        <Fragment key={item.id}>
                            {i === 2 && <div className="w-full h-0" />}
                            <button
                                type="button"
                                onClick={() => onChange(item.id)}
                                className={cn(
                                    'flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-[color,background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    isActive
                                        ? 'border-border/40 bg-background text-foreground shadow-sm'
                                        : 'border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                                )}
                            >
                                <div className={cn(
                                    "w-5 h-5 rounded flex items-center justify-center shrink-0",
                                    isActive ? "text-foreground" : "text-muted-foreground/60"
                                )}>
                                    {item.icon}
                                </div>
                                {item.label}
                            </button>
                        </Fragment>
                    )
                })}
            </div>
        </div>
    )
}

function DesktopSidebar({ activeSection, onChange, group }: { activeSection: Section; onChange: (s: Section) => void; group: 'core' | 'advanced' }) {
    const items = group === 'core' ? SIDEBAR_ITEMS.slice(0, 2) : SIDEBAR_ITEMS.slice(2)
    return (
        <nav className="flex flex-col gap-0.5">
            {items.map((item) => {
                const isActive = activeSection === item.id
                return (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => onChange(item.id)}
                        className={cn(
                            'relative flex items-center gap-2.5 px-2.5 py-2 rounded-xl border text-sm font-medium transition-[color,background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-left w-full',
                            isActive
                                ? 'border-border/40 bg-background text-foreground shadow-sm'
                                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
                        )}
                    >
                        <div className={cn(
                            "relative z-10 w-5 h-5 flex items-center justify-center shrink-0 transition-colors",
                            isActive ? "text-foreground" : "text-muted-foreground/60"
                        )}>
                            {item.icon}
                        </div>
                        <span className="relative z-10 flex-1 truncate">{item.label}</span>
                    </button>
                )
            })}
        </nav>
    )
}

function SectionHeader({ title, description }: { title: string; description: string }) {
    return (
        <div className="mb-4">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        </div>
    )
}

function SectionContent({
    activeSection,
    sourceConfig,
    baseUrl,
    configureUrl,
    uuid,
    targetOptions,
    accountName,
    linkedAccounts,
    sameUserAccounts,
    instanceStatus,
    installUrl,
    accountId,
    transportUrl,
    missingAccounts,
    onClose,
}: {
    activeSection: Section
    sourceConfig: Record<string, unknown>
    baseUrl: string
    configureUrl: string | null
    uuid: string
    targetOptions: TargetOption[]
    accountName: string
    linkedAccounts: { id: string; name?: string; email?: string; emoji?: string }[]
    sameUserAccounts: { id: string; name?: string; email?: string; emoji?: string }[]
    instanceStatus: Record<string, unknown> | null
    installUrl: string | null
    accountId: string
    transportUrl: string
    missingAccounts: MissingTargetAccount[]
    onClose: () => void
}) {
    const stats = useMemo(() => getConfigStats(sourceConfig), [sourceConfig])
    const sections = useMemo(() => getConfigSections(sourceConfig), [sourceConfig])

    const configSize = useMemo(() => {
        const json = JSON.stringify(sourceConfig)
        const bytes = new Blob([json]).size
        if (bytes < 1024) return `${bytes} B`
        return `${(bytes / 1024).toFixed(1)} KB`
    }, [sourceConfig])

    const formatterSummary = useMemo(() => {
        const f = sourceConfig.formatter as { id?: string } | undefined
        if (!f?.id) return null
        return f.id.charAt(0).toUpperCase() + f.id.slice(1)
    }, [sourceConfig])

    const services = useMemo(() => {
        const raw = sourceConfig.services
        if (!Array.isArray(raw)) return []
        return raw as Record<string, unknown>[]
    }, [sourceConfig])

    const addons = useMemo(() => {
        const raw = sourceConfig.presets
        if (!Array.isArray(raw)) return []
        return raw as Record<string, unknown>[]
    }, [sourceConfig])
    const filterSections = useMemo(() => sections.filter(s => s.category === 'filter'), [sections])
    const toggleSections = useMemo(() => sections.filter(s => s.category === 'toggle'), [sections])
    const sortSection = useMemo(() => sections.find(s => s.key === 'sortCriteria'), [sections])

    switch (activeSection) {
        case 'overview':
            return (
                <div className="space-y-6">
                    <SectionHeader title="Overview" description="Instance summary and quick actions" />

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard value={stats.sections} label="Sections" />
                        <StatCard value={stats.filters} label="Filters" />
                        <StatCard value={stats.toggles} label="Toggles" />
                        <StatCard value={stats.keys} label="API Keys" />
                    </div>

                    <div className="p-5 rounded-2xl border border-border/40 bg-card/50 shadow-sm space-y-3">
                        <h3 className="text-sm font-semibold">Instance Details</h3>
                        <div className="grid gap-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">URL</span>
                                <span className="font-mono text-xs truncate max-w-[60%]">{baseUrl}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground">UUID</span>
                                <div className="flex items-center gap-1.5">
                                    <code className="text-xs font-mono">{uuid}</code>
                                    <CopyButton value={uuid} variant="ghost" className="h-6 w-6 flex items-center justify-center" iconSize={12} />
                                </div>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Account</span>
                                <span className="font-medium">{accountName}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Version</span>
                                <span className="font-mono text-xs">{instanceStatus && typeof instanceStatus.tag === 'string' ? `v${instanceStatus.tag}` : 'Unknown'}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Config Size</span>
                                <span className="font-mono text-xs">{configSize}</span>
                            </div>
                            {formatterSummary && (
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Formatter</span>
                                    <span className="font-medium">{formatterSummary}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {toggleSections.length > 0 && (
                        <div className="space-y-2">
                            <h3 className="text-sm font-semibold">Quick Settings</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {toggleSections.map(section => (
                                    <div key={section.key} className="flex items-center justify-between px-3 py-2 rounded-lg border border-border/30 bg-muted/10">
                                        <span className="text-xs font-medium">{section.label}</span>
                                        <span className={cn(
                                            "text-xs font-semibold",
                                            section.data ? "text-success" : "text-muted-foreground"
                                        )}>
                                            {section.data ? "On" : "Off"}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {(filterSections.length > 0 || sortSection) && (
                        <div className="p-4 rounded-2xl border border-border/40 bg-card/50 shadow-sm space-y-2">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold">Filters & Sorting</h3>
                                <span className="text-xs text-muted-foreground">{filterSections.length} filter rule{filterSections.length !== 1 ? 's' : ''}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {sortSection ? `Sorting: ${getSectionSummary(sortSection.key, sortSection.data)}` : 'No sorting configured'}
                            </p>
                            {configureUrl && (
                                <Button variant="outline" size="sm" className="gap-2 mt-1" asChild>
                                    <a href={configureUrl} target="_blank" rel="noopener noreferrer">
                                        <ExternalLink className="w-3.5 w-3.5" /> Configure in AIOStreams
                                    </a>
                                </Button>
                            )}
                        </div>
                    )}

                    {installUrl && (
                        <div className="p-4 rounded-2xl border border-border/40 bg-card/50 shadow-sm space-y-2">
                            <h3 className="text-sm font-semibold">Install URL</h3>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 text-xs font-mono bg-muted/30 px-3 py-2 rounded-lg truncate">{installUrl}</code>
                                <CopyButton value={installUrl} variant="outline" className="h-9 w-9 shrink-0" iconSize={14} />
                            </div>
                        </div>
                    )}

                    {sameUserAccounts.length > 0 && (
                        <div className="p-4 rounded-2xl border border-info/20 bg-info/5 shadow-sm space-y-2">
                            <h3 className="text-sm font-semibold">Same User Also Installed</h3>
                            <p className="text-xs text-muted-foreground">
                                These accounts already use this exact AIOStreams user, so they are shown here instead of as sync targets.
                            </p>
                            <div className="flex flex-wrap gap-2 mt-2">
                                {sameUserAccounts.map(acc => (
                                    <span key={acc.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-background/60 border border-info/20">
                                        <Users className="w-3 h-3 text-info" />
                                        {acc.emoji ? `${acc.emoji} ` : ''}{acc.name || acc.email || acc.id}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {linkedAccounts.length > 0 && (
                        <div className="p-4 rounded-2xl border border-border/40 bg-card/50 shadow-sm space-y-2">
                            <h3 className="text-sm font-semibold">Other Users On This Instance</h3>
                            <p className="text-xs text-muted-foreground">Other accounts using different AIOStreams users on this same instance</p>
                            <div className="flex flex-wrap gap-2 mt-2">
                                {linkedAccounts.map(acc => (
                                    <span key={acc.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted/30 border border-border/30">
                                        <Link2 className="w-3 h-3 text-muted-foreground" />
                                        {acc.emoji ? `${acc.emoji} ` : ''}{acc.name || acc.email || acc.id}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {configureUrl && (
                        <div className="rounded-2xl border border-border/40 bg-muted/25 p-4 space-y-2">
                            <p className="text-sm text-muted-foreground">For detailed configuration, use AIOStreams' visual editor.</p>
                            <Button variant="outline" size="sm" className="gap-2" asChild>
                                <a href={configureUrl} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="w-3.5 w-3.5" />
                                    Configure in AIOStreams
                                </a>
                            </Button>
                        </div>
                    )}

                </div>
            )

        case 'addons-services':
            return (
                <div className="space-y-6">
                    <SectionHeader title="Addons & Services" description="Read-only summary; edit details in AIOStreams" />

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">Services</h3>
                            <span className="text-xs text-muted-foreground">{services.length} configured</span>
                        </div>
                        {services.length === 0 ? (
                            <EmptyState
                                icon={<Server className="h-6 w-6" />}
                                title="No services configured"
                                description="Connect a debrid service (Real-Debrid, AllDebrid, Premiumize, TorBox, etc.) so AIOStreams can pull cached, high-speed streams."
                            />
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {services.map((svc, idx) => {
                                    const svcId = String(svc.id || svc.type || `service-${idx}`)
                                    const isEnabled = svc.enabled !== false
                                    const credentials = svc.credentials && typeof svc.credentials === 'object' && !Array.isArray(svc.credentials)
                                        ? svc.credentials as Record<string, unknown>
                                        : {}
                                    const credentialCount = Object.values(credentials).filter(v => v != null && String(v).trim()).length

                                    return (
                                        <div key={idx} className={cn(
                                            "p-4 rounded-2xl border shadow-sm flex items-center gap-3",
                                            isEnabled ? "border-border/40 bg-card" : "border-border/30 bg-muted/10"
                                        )}>
                                            <div className={cn(
                                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                                                isEnabled ? "bg-success/10 text-success" : "bg-muted/30 text-muted-foreground"
                                            )}>
                                                <Tv className="w-4 h-4" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-semibold truncate">{formatName(svcId)}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {isEnabled ? 'Enabled' : 'Disabled'} · {credentialCount} credential{credentialCount !== 1 ? 's' : ''}
                                                </p>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    <div className="space-y-4 border-t border-border/30 pt-6">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">Addons</h3>
                            <span className="text-xs text-muted-foreground">{addons.length} configured</span>
                        </div>
                        {addons.length === 0 ? (
                            <EmptyState
                                icon={<Layers className="h-6 w-6" />}
                                title="No addons configured"
                                description="Add streaming addons (Torrentio, MediaFusion, etc.) to this AIOStreams instance so it has sources to query."
                            />
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {addons.map((ad, idx) => {
                                    const name = String(ad.name || ad.type || ad.id || `Addon ${idx + 1}`)
                                    const isEnabled = ad.enabled !== false
                                    const logo = ad.logo as string | undefined
                                    return (
                                        <div key={idx} className={cn(
                                            "p-4 rounded-2xl border shadow-sm flex items-center gap-3",
                                            isEnabled ? "border-border/40 bg-card" : "border-border/30 bg-muted/10"
                                        )}>
                                            <AddonIcon
                                                name={name}
                                                logo={logo}
                                                className="h-8 w-8"
                                                textClassName="text-xs"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-semibold truncate">{name}</p>
                                                <p className="text-xs text-muted-foreground font-mono truncate">{String(ad.id || '')}</p>
                                            </div>
                                            <span className={cn(
                                                "rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
                                                isEnabled ? "bg-success/10 text-success" : "bg-muted/35 text-muted-foreground"
                                            )}>
                                                {isEnabled ? 'On' : 'Off'}
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {configureUrl && (
                        <div className="p-4 rounded-xl border border-primary/25 bg-primary/5 space-y-2 mt-4">
                            <p className="text-sm text-muted-foreground">Add, remove, reorder, or edit credentials in the official AIOStreams UI.</p>
                            <Button variant="outline" size="sm" className="gap-2" asChild>
                                <a href={configureUrl} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="w-3.5 w-3.5" /> Configure in AIOStreams
                                </a>
                            </Button>
                        </div>
                    )}
                </div>
            )

        case 'users':
            return (
                <div className="space-y-4">
                    <SectionHeader title="Users" description="Advanced AIOStreams user creation and deletion tools" />
                    <AIOStreamsActionsTab
                        sourceConfig={sourceConfig}
                        baseUrl={baseUrl}
                        uuid={uuid}
                        targetOptions={targetOptions}
                        accountId={accountId}
                        transportUrl={transportUrl}
                        onClose={onClose}
                    />
                </div>
            )

        case 'sync':
            return (
                <div className="space-y-4">
                    <SectionHeader title="Sync Set" description="Copy this setup to existing or new targets; everything moves unless you choose groups." />
                    <AIOStreamsSyncTab
                        sourceConfig={sourceConfig}
                        targetOptions={targetOptions}
                        sourceName={typeof sourceConfig.addonName === 'string' ? sourceConfig.addonName : 'AIOStreams setup'}
                        sourceAccountName={accountName}
                        sourceBaseUrl={baseUrl}
                        sourceUuid={uuid}
                        missingAccountCount={missingAccounts.length}
                        missingAccounts={missingAccounts}
                        sameUserAccounts={sameUserAccounts.map(acc => ({
                            accountId: acc.id,
                            accountName: `${acc.emoji ? `${acc.emoji} ` : ''}${acc.name || acc.email || acc.id}`,
                        }))}
                    />
                </div>
            )
    }
}

function StatCard({ value, label }: { value: number; label: string }) {
    return (
        <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
            <p className="text-xl font-semibold">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
        </div>
    )
}

function formatName(s: string): string {
    return s
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .replace(/^./, c => c.toUpperCase())
        .trim()
}
