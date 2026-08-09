import { useState, useCallback, useEffect, useMemo, useRef, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyButton } from '@/components/ui/copy-button'
import { StatusChip } from '@/components/ui/status-chip'
import { Tooltip } from '@/components/ui/tooltip'
import { ToolbarShell } from '@/components/ui/toolbar-shell'
import { AddonIcon } from '@/components/ui/addon-icon'
import { EmptyState } from '@/components/common/EmptyState'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useAccountStore, getAccountEmail } from '@/store/accountStore'
import {
    isAIOMetadataAddon,
    parseAIOMetadataUrl,
    getAIOMetadataConfigureUrl,
    fetchAIOMetadataConfig,
    fetchAIOMetadataStatus,
    checkAIOMetadataTrusted,
    getStoredAIOMetadataPassword,
    saveAIOMetadataPassword,
    getConfigSections,
    getConfigStats,
    getSectionSummary,
    type AIOMetadataAddonInfo,
} from '@/lib/aiometadata-utils'
import { AIOMetadataSyncTab, type TargetOption, type MissingTargetAccount } from '@/components/addons/aiometadata/AIOMetadataSyncTab'
import { AIOMetadataActionsTab } from '@/components/addons/aiometadata/AIOMetadataActionsTab'
import {
    ArrowLeft, Loader2, AlertTriangle, ExternalLink, Eye, EyeOff, Lock, Shield,
    ArrowRightLeft, RefreshCw, Wifi, Database, Image, KeyRound, LayoutGrid, Users,
} from 'lucide-react'

type Section = 'overview' | 'config' | 'users' | 'sync'

export function AIOMetadataPage() {
    const { accountId, uuid } = useParams<{ accountId: string; uuid: string }>()
    const navigate = useNavigate()
    const accounts = useAccountStore(s => s.accounts)

    const account = useMemo(() => accounts.find(a => a.id === accountId), [accounts, accountId])
    const addon = useMemo(() => {
        if (!account) return null
        return account.addons.find(a => {
            if (!isAIOMetadataAddon(a)) return false
            const p = parseAIOMetadataUrl(a.transportUrl)
            return p?.uuid === uuid
        })
    }, [account, uuid])

    const parsed = useMemo(() => addon ? parseAIOMetadataUrl(addon.transportUrl) : null, [addon])
    const baseUrl = parsed?.baseUrl ?? ''
    const shouldRedirect = !addon || !account || !uuid

    const [connected, setConnected] = useState(false)
    const [password, setPassword] = useState('')
    const [addonPassword, setAddonPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [rememberPassword, setRememberPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [activeSection, setActiveSection] = useState<Section>('overview')
    const [sourceConfig, setSourceConfig] = useState<Record<string, unknown> | null>(null)
    const [status, setStatus] = useState<AIOMetadataAddonInfo | null>(null)
    const [reachable, setReachable] = useState(true)
    const [trusted, setTrusted] = useState<boolean | null>(null)

    const passwordRef = useRef<HTMLInputElement>(null)

    const targetOptions: TargetOption[] = useMemo(() => accounts.flatMap(acc =>
        (acc.addons || [])
            .filter(a => {
                if (!isAIOMetadataAddon(a)) return false
                const p = parseAIOMetadataUrl(a.transportUrl)
                return p && !(p.baseUrl === baseUrl && p.uuid === uuid)
            })
            .map(a => {
                const p = parseAIOMetadataUrl(a.transportUrl)
                if (!p) return null
                return {
                    accountId: acc.id,
                    accountName: acc.name || getAccountEmail(acc) || acc.id,
                    addonName: a.metadata?.customName || a.manifest.name || 'AIOMetadata',
                    transportUrl: a.transportUrl,
                    baseUrl: p.baseUrl,
                    uuid: p.uuid,
                    logo: a.metadata?.customLogo || a.manifest.logo,
                }
            })
    ).filter(Boolean) as TargetOption[], [accounts, uuid, baseUrl])

    const missingAccounts: MissingTargetAccount[] = useMemo(() => accounts
        .filter(acc => acc.id !== accountId && !(acc.addons || []).some(isAIOMetadataAddon))
        .map(acc => ({ accountId: acc.id, accountName: acc.name || getAccountEmail(acc) || acc.id })), [accounts, accountId])

    useEffect(() => {
        if (!addon) return
        setConnected(false)
        setError('')
        setSourceConfig(null)
        setActiveSection('overview')
        setStatus(null)
        setReachable(true)
        setTrusted(null)
        fetchAIOMetadataStatus(baseUrl).then(s => {
            if (s) setStatus(s); else setReachable(false)
        }).catch(() => setReachable(false))
        if (uuid) checkAIOMetadataTrusted(baseUrl, uuid).then(setTrusted).catch(() => {})
        const stored = getStoredAIOMetadataPassword(baseUrl, uuid || '')
        if (stored) { setPassword(stored); setRememberPassword(true) }
        else { setPassword(''); setRememberPassword(false) }
    }, [addon, baseUrl, uuid])

    useEffect(() => {
        if (!connected) setTimeout(() => passwordRef.current?.focus(), 100)
    }, [connected])

    const needsAddonPassword = trusted !== true && status?.requiresAddonPassword === true

    const handleConnect = useCallback(async () => {
        if (!password.trim() || !uuid) { setError('Password is required'); return }
        setLoading(true)
        setError('')
        try {
            const config = await fetchAIOMetadataConfig(baseUrl, uuid, password, addonPassword || undefined)
            setSourceConfig(config)
            if (rememberPassword) {
                try { await saveAIOMetadataPassword(baseUrl, uuid, password) } catch { /* non-critical */ }
            }
            setConnected(true)
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to connect')
        } finally {
            setLoading(false)
        }
    }, [baseUrl, uuid, password, addonPassword, rememberPassword])

    const handleRefresh = useCallback(async () => {
        if (!password || !uuid) return
        setLoading(true)
        try {
            setSourceConfig(await fetchAIOMetadataConfig(baseUrl, uuid, password, addonPassword || undefined))
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to refresh')
        } finally {
            setLoading(false)
        }
    }, [baseUrl, uuid, password, addonPassword])

    useEffect(() => {
        if (shouldRedirect) navigate(accountId ? `/account/${accountId}` : '/', { replace: true })
    }, [accountId, navigate, shouldRedirect])

    if (shouldRedirect) return null

    const addonName = addon.manifest.name || 'AIOMetadata'
    const accountLabel = account.name || getAccountEmail(account) || accountId || 'Unknown account'
    const configureUrl = getAIOMetadataConfigureUrl(addon.transportUrl)

    return (
        <div className="w-full mx-auto py-6 px-4 md:px-8 lg:px-12 xl:px-16 space-y-4 max-w-[1800px]">
            <ToolbarShell className="w-fit max-w-full p-2" contentClassName="gap-2">
                <Button variant="ghost" size="sm" className="mt-0.5 h-8 shrink-0 gap-1.5 rounded-xl border border-border/40 bg-card px-2.5 text-xs font-medium text-muted-foreground shadow-sm hover:bg-muted/50 hover:text-foreground"
                    onClick={() => navigate(`/account/${accountId}`)}>
                    <ArrowLeft className="h-4 w-4" /> Back
                </Button>
            </ToolbarShell>

            {!connected ? (
                <CredentialsGate
                    password={password} setPassword={setPassword}
                    addonPassword={addonPassword} setAddonPassword={setAddonPassword}
                    needsAddonPassword={needsAddonPassword}
                    showPassword={showPassword} setShowPassword={setShowPassword}
                    rememberPassword={rememberPassword} setRememberPassword={setRememberPassword}
                    loading={loading} error={error} passwordRef={passwordRef}
                    onConnect={handleConnect} configureUrl={configureUrl}
                />
            ) : (
                <div className="flex flex-col md:flex-row gap-6 min-h-[calc(100vh-14rem)]">
                    <div className="w-full md:w-56 lg:w-64 shrink-0 flex flex-col gap-3">
                        <div className="hidden bg-card border border-border/40 rounded-2xl p-3 shadow-sm space-y-1 md:block">
                            <div className="flex items-center justify-between px-2 py-1.5 mb-1 shrink-0">
                                <Tooltip content="Metadata setup overview and quick stats" side="right">
                                    <h2 className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground cursor-help">Summary</h2>
                                </Tooltip>
                            </div>
                            <DesktopSidebar activeSection={activeSection} onChange={setActiveSection} group="core" />
                        </div>

                        <div className="hidden bg-card border border-border/40 rounded-2xl p-3 shadow-sm space-y-1 md:block">
                            <div className="flex items-center justify-between px-2 py-1.5 mb-1 shrink-0">
                                <Tooltip content="Configure metadata orchestration" side="right">
                                    <h2 className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground cursor-help">Orchestration</h2>
                                </Tooltip>
                            </div>
                            <DesktopSidebar activeSection={activeSection} onChange={setActiveSection} group="advanced" />
                        </div>

                        <div className="md:hidden px-4 pb-4">
                            <MobileSectionBar activeSection={activeSection} onChange={setActiveSection} />
                        </div>
                    </div>

                    <div className="flex-1 min-w-0 bg-card border border-border/40 rounded-2xl overflow-hidden shadow-sm flex flex-col">
                        <div className="p-4 md:p-6 border-b border-border/40 bg-muted/5 shrink-0">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                    <AddonIcon name={addonName} logo={addon.metadata?.customLogo || addon.manifest.logo} alt={addonName} className="h-10 w-10" textClassName="text-sm" />
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h1 className="text-lg font-bold tracking-tight truncate">{addonName}</h1>
                                            <Tooltip content={reachable ? 'Instance is reachable and responding' : 'Instance could not be reached'} side="bottom">
                                                <StatusChip variant={reachable ? 'success' : 'destructive'} icon={<Wifi className="w-3 h-3" />} className="rounded-lg">
                                                    {reachable ? 'Connected' : 'Unreachable'}
                                                </StatusChip>
                                            </Tooltip>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5 text-xs text-muted-foreground">
                                            <span className="font-mono truncate">{baseUrl}</span>
                                            {status?.version && <span className="shrink-0">v{status.version}</span>}
                                        </div>
                                    </div>
                                </div>
                                <Button variant="ghost" className="gap-2 text-muted-foreground h-9" onClick={handleRefresh} disabled={loading} size="sm">
                                    <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> Refresh
                                </Button>
                            </div>
                        </div>

                        <div className="p-4 md:p-8 flex-1 overflow-y-auto scrollbar-hide">
                            {sourceConfig ? (
                                <SectionContent
                                    activeSection={activeSection}
                                    sourceConfig={sourceConfig}
                                    baseUrl={baseUrl}
                                    uuid={uuid}
                                    transportUrl={addon.transportUrl}
                                    configureUrl={configureUrl}
                                    accountName={accountLabel}
                                    status={status}
                                    targetOptions={targetOptions}
                                    missingAccounts={missingAccounts}
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

const SIDEBAR_ITEMS: { id: Section; label: string; icon: React.ReactNode; group: 'config' | 'actions' }[] = [
    { id: 'overview', label: 'Overview', icon: <Eye className="w-4 h-4" />, group: 'config' },
    { id: 'config', label: 'Configuration', icon: <Database className="w-4 h-4" />, group: 'config' },
    { id: 'users', label: 'Users', icon: <Users className="w-4 h-4" />, group: 'actions' },
    { id: 'sync', label: 'Sync', icon: <ArrowRightLeft className="w-4 h-4" />, group: 'actions' },
]

function DesktopSidebar({ activeSection, onChange, group }: { activeSection: Section; onChange: (s: Section) => void; group: 'core' | 'advanced' }) {
    const items = group === 'core' ? SIDEBAR_ITEMS.slice(0, 2) : SIDEBAR_ITEMS.slice(2)
    return (
        <nav className="flex flex-col gap-0.5">
            {items.map(item => {
                const isActive = activeSection === item.id
                return (
                    <button key={item.id} type="button" onClick={() => onChange(item.id)}
                        className={cn('relative flex items-center gap-2.5 px-2.5 py-2 rounded-xl border text-sm font-medium transition-[transform,opacity,box-shadow] text-left w-full',
                            isActive ? 'border-border/40 bg-background text-foreground shadow-sm' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50')}>
                        <div className={cn('relative z-10 w-5 h-5 flex items-center justify-center shrink-0 transition-colors', isActive ? 'text-foreground' : 'text-muted-foreground/60')}>
                            {item.icon}
                        </div>
                        <span className="relative z-10 flex-1 truncate">{item.label}</span>
                    </button>
                )
            })}
        </nav>
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
                            <button type="button" onClick={() => onChange(item.id)}
                                className={cn('flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-[transform,opacity,box-shadow]',
                                    isActive ? 'border-border/40 bg-background text-foreground shadow-sm' : 'border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground')}>
                                <div className={cn('w-5 h-5 rounded flex items-center justify-center shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground/60')}>
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

function CredentialsGate({
    password, setPassword, addonPassword, setAddonPassword, needsAddonPassword,
    showPassword, setShowPassword, rememberPassword, setRememberPassword,
    loading, error, passwordRef, onConnect, configureUrl,
}: {
    password: string; setPassword: (v: string) => void
    addonPassword: string; setAddonPassword: (v: string) => void
    needsAddonPassword: boolean
    showPassword: boolean; setShowPassword: (v: boolean) => void
    rememberPassword: boolean; setRememberPassword: (v: boolean) => void
    loading: boolean; error: string
    passwordRef: React.RefObject<HTMLInputElement | null>
    onConnect: () => void; configureUrl: string | null
}) {
    return (
        <div className="max-w-md mx-auto my-12">
            <Card className="border border-border/40 shadow-sm bg-card relative overflow-hidden">
                <CardHeader className="text-center relative z-10">
                    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-muted/35 text-muted-foreground ring-1 ring-border/40">
                        <Lock className="w-5 h-5" />
                    </div>
                    <CardTitle className="text-xl">Authentication Required</CardTitle>
                    <CardDescription>Enter the AIOMetadata config password to manage this user.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 relative z-10">
                    <div className="space-y-2">
                        <Label htmlFor="password" className="text-xs font-medium text-muted-foreground uppercase">Config Password</Label>
                        <div className="relative">
                            <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input id="password" ref={passwordRef} type={showPassword ? 'text' : 'password'} placeholder="Config password"
                                value={password} onChange={e => setPassword(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && onConnect()} disabled={loading} className="pl-9 pr-10 h-11" />
                            <Button type="button" variant="ghost" size="sm" tabIndex={-1}
                                className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:text-foreground"
                                onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </Button>
                        </div>
                    </div>
                    {needsAddonPassword && (
                        <div className="space-y-2">
                            <Label htmlFor="addon-password" className="text-xs font-medium text-muted-foreground uppercase">Addon Password</Label>
                            <Input id="addon-password" type="password" placeholder="Instance addon password"
                                value={addonPassword} onChange={e => setAddonPassword(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && onConnect()} disabled={loading} className="h-11" />
                            <p className="text-xs text-muted-foreground">This instance requires its addon password for new users. After the first connect this user becomes trusted.</p>
                        </div>
                    )}
                    <div className="flex items-center gap-2">
                        <Checkbox id="remember" checked={rememberPassword} onCheckedChange={c => setRememberPassword(!!c)} />
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
                                <ExternalLink className="w-4 h-4" /> Open in AIOMetadata
                            </a>
                        </Button>
                    )}
                </CardFooter>
            </Card>
        </div>
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

function StatCard({ value, label }: { value: number; label: string }) {
    return (
        <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
            <p className="text-xl font-semibold">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
        </div>
    )
}

function SectionContent({
    activeSection, sourceConfig, baseUrl, uuid, transportUrl, configureUrl, accountName, status, targetOptions, missingAccounts,
}: {
    activeSection: Section
    sourceConfig: Record<string, unknown>
    baseUrl: string
    uuid: string
    transportUrl: string
    configureUrl: string | null
    accountName: string
    status: AIOMetadataAddonInfo | null
    targetOptions: TargetOption[]
    missingAccounts: MissingTargetAccount[]
}) {
    const stats = useMemo(() => getConfigStats(sourceConfig), [sourceConfig])
    const sections = useMemo(() => getConfigSections(sourceConfig), [sourceConfig])
    const objectSections = useMemo(() => sections.filter(s => s.category === 'section'), [sections])
    const toggleSections = useMemo(() => sections.filter(s => s.category === 'toggle'), [sections])
    const keySections = useMemo(() => sections.filter(s => s.category === 'key'), [sections])

    if (activeSection === 'overview') {
        return (
            <div className="space-y-6">
                <SectionHeader title="Overview" description="Metadata setup summary for this user" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatCard value={stats.providers} label="Provider Maps" />
                    <StatCard value={stats.catalogs} label="Catalogs" />
                    <StatCard value={stats.apiKeys} label="API Keys" />
                    <StatCard value={stats.toggles} label="Features On" />
                </div>

                <div className="p-5 rounded-2xl border border-border/40 bg-card/50 shadow-sm space-y-3">
                    <h3 className="text-sm font-semibold">Instance Details</h3>
                    <div className="grid gap-3 text-sm">
                        <Detail label="URL"><span className="font-mono text-xs truncate max-w-[60%]">{baseUrl}</span></Detail>
                        <Detail label="UUID">
                            <div className="flex items-center gap-1.5">
                                <code className="text-xs font-mono">{uuid}</code>
                                <CopyButton value={uuid} variant="ghost" className="h-6 w-6 flex items-center justify-center" iconSize={12} />
                            </div>
                        </Detail>
                        <Detail label="Account"><span className="font-medium">{accountName}</span></Detail>
                        <Detail label="Version"><span className="font-mono text-xs">{status?.version ? `v${status.version}` : 'Unknown'}</span></Detail>
                    </div>
                </div>

                <div className="p-4 rounded-2xl border border-border/40 bg-card/50 shadow-sm space-y-2">
                    <h3 className="text-sm font-semibold">Install URL</h3>
                    <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs font-mono bg-muted/30 px-3 py-2 rounded-lg truncate">{transportUrl}</code>
                        <CopyButton value={transportUrl} variant="outline" className="h-9 w-9 shrink-0" iconSize={14} />
                    </div>
                </div>

                {configureUrl && (
                    <div className="rounded-2xl border border-border/40 bg-muted/25 p-4 space-y-2">
                        <p className="text-sm text-muted-foreground">For full catalog and provider editing, use the AIOMetadata visual editor.</p>
                        <Button variant="outline" size="sm" className="gap-2" asChild>
                            <a href={configureUrl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="w-3.5 h-3.5" /> Configure in AIOMetadata
                            </a>
                        </Button>
                    </div>
                )}
            </div>
        )
    }

    if (activeSection === 'config') {
        return (
            <div className="space-y-6">
                <SectionHeader title="Configuration" description="Read-only summary; edit details in AIOMetadata, then sync across accounts" />

                {objectSections.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {objectSections.map(section => (
                            <div key={section.key} className="p-4 rounded-2xl border border-border/40 bg-card shadow-sm flex items-center gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/30 text-muted-foreground">
                                    <SectionIcon icon={section.icon} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold truncate">{section.label}</p>
                                    <p className="text-xs text-muted-foreground truncate">{getSectionSummary(section.key, section.data)}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {toggleSections.length > 0 && (
                    <div className="space-y-2">
                        <h3 className="text-sm font-semibold">Features</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {toggleSections.map(section => (
                                <div key={section.key} className="flex items-center justify-between px-3 py-2 rounded-lg border border-border/30 bg-muted/10">
                                    <span className="text-xs font-medium">{section.label}</span>
                                    <span className={cn('text-xs font-semibold', section.data ? 'text-success' : 'text-muted-foreground')}>
                                        {section.data ? 'On' : 'Off'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {keySections.length > 0 && (
                    <div className="space-y-2">
                        <h3 className="text-sm font-semibold">Settings</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {keySections.map(section => (
                                <div key={section.key} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border/30 bg-muted/10">
                                    <span className="text-xs font-medium shrink-0">{section.label}</span>
                                    <span className="text-xs text-muted-foreground truncate">{getSectionSummary(section.key, section.data)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {sections.length === 0 && (
                    <EmptyState icon={<Database className="h-6 w-6" />} title="No configuration found" description="This user has no settings yet. Configure it in AIOMetadata first." />
                )}
            </div>
        )
    }

    if (activeSection === 'users') {
        return (
            <div className="space-y-4">
                <SectionHeader title="Users" description="Create new AIOMetadata users from this setup and install them on your accounts." />
                <AIOMetadataActionsTab
                    sourceConfig={sourceConfig}
                    baseUrl={baseUrl}
                    targetOptions={targetOptions}
                    requiresAddonPassword={status?.requiresAddonPassword === true}
                />
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <SectionHeader title="Sync" description="Copy this metadata setup to other accounts, or deploy it to accounts without AIOMetadata." />
            <AIOMetadataSyncTab
                sourceConfig={sourceConfig}
                targetOptions={targetOptions}
                sourceName={typeof sourceConfig.addonName === 'string' && sourceConfig.addonName ? sourceConfig.addonName : 'AIOMetadata setup'}
                sourceAccountName={accountName}
                sourceBaseUrl={baseUrl}
                sourceUuid={uuid}
                requiresAddonPassword={status?.requiresAddonPassword === true}
                missingAccounts={missingAccounts}
            />
        </div>
    )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{label}</span>
            {children}
        </div>
    )
}

function SectionIcon({ icon }: { icon: string }) {
    switch (icon) {
        case 'Database': return <Database className="w-4 h-4" />
        case 'Image': return <Image className="w-4 h-4" />
        case 'KeyRound': return <KeyRound className="w-4 h-4" />
        case 'LayoutGrid': return <LayoutGrid className="w-4 h-4" />
        default: return <Database className="w-4 h-4" />
    }
}
