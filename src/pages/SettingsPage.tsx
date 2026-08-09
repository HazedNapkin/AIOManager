import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { maskNameLevel, maskUrlLevel, maskProfileLevel } from '@/lib/utils'
import { isSyncioExport, parseSyncioExport } from '@/lib/syncio-import'
import { useTheme } from '@/contexts/ThemeContext'
import { useAccountStore } from '@/store/accountStore'
import { useAddonStore } from '@/store/addonStore'
import { useLibraryCache } from '@/store/libraryCache'
import { useUIStore } from '@/store/uiStore'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { SquircleOverlay } from '@/components/ui/squircle-overlay'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
    Trash2,
    Database,
    EyeOff,
    Download,
    Upload,
    Palette,
    Settings2,
    Shield,
    Wrench,
    AlertTriangle,
    CheckCircle2,
    FileJson,
    User,
    Link,
    Users,
    Activity,
} from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PrivacyLevelSlider } from '@/components/ui/privacy-level-slider'

import { SyncDiagnostics } from '@/components/settings/SyncDiagnostics'

import { AccountSection } from '@/components/settings/AccountSection'
import { SyncSummarySection } from '@/components/settings/SyncSummarySection'
import { NotificationsSection } from '@/components/settings/NotificationsSection'
import { ThemeSection } from '@/components/settings/ThemeSection'
import { DangerZone } from '@/components/settings/DangerZone'
import { InstallAppCard } from '@/components/settings/InstallAppCard'
import { RepairTools } from '@/components/settings/RepairTools'
import { IntegrationsSection } from '@/components/settings/IntegrationsSection'

type ImportPreview = {
    fileName: string
    sizeLabel: string
    version?: string
    exportedAt?: string
    counts: {
        accounts: number
        matchingAccounts: number
        savedAddons: number
        profiles: number
        failoverRules: number
        accountStates: number
        vaultKeys: number | string
        changelog: number
        settings: number
        watchEvents: number
    }
    warnings: string[]
    errors: string[]
}

type PendingImport = {
    text: string
    preview: ImportPreview
}

const asArray = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value
    if (value && typeof value === 'object') return Object.values(value)
    return []
}

const getPreviewAccounts = (data: Record<string, unknown>) => {
    let accountsToImport = (data?.accounts || []) as unknown
    if (!Array.isArray(accountsToImport) && accountsToImport && typeof accountsToImport === 'object') {
        accountsToImport = ((accountsToImport as Record<string, unknown>).accounts || []) as unknown
    }
    return asArray(accountsToImport)
}

const getPreviewSavedAddons = (data: Record<string, unknown>) => asArray(
    data?.savedAddons ||
    data?.['stremio-manager:addon-library'] ||
    data?.templates ||
    (data?.addons as Record<string, unknown> | undefined)?.savedAddons ||
    (Array.isArray(data) ? data : null)
)

const getPreviewProfiles = (data: Record<string, unknown>) => asArray(data?.profiles || data?.['stremio-manager:profiles'])

const getPreviewFailoverRules = (data: Record<string, unknown>) => {
    if (Array.isArray(data?.failover)) return data.failover as unknown[]
    return asArray((data?.failover as Record<string, unknown> | undefined)?.rules || data?.['stremio-manager:failover-rules'])
}

const formatFileSize = (size: number) => {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

const BACKUP_SECTIONS = [
    { key: 'accounts', label: 'Accounts & Connections', description: 'Stremio/Nuvio accounts, auth keys, addon configs' },
    { key: 'library', label: 'Saved Addons', description: 'Library snapshots, profiles, tags' },
    { key: 'vault', label: 'Vault Keys', description: 'Debrid service credentials' },
    { key: 'failover', label: 'Autopilot Rules', description: 'Failover rules and webhook config' },
    { key: 'settings', label: 'Settings & Themes', description: 'App settings, privacy, custom themes' },
    { key: 'notes', label: 'Notes', description: 'Sticky notes and trash' },
]

function applySectionFilter(data: Record<string, unknown>, sections: Set<string>): void {
    if (!sections.has('accounts')) { delete data.accounts; delete data.manifests; delete data.apiKeys; delete data.watchEvents; delete data.watchSnapshot }
    if (!sections.has('library')) { delete data.addons; delete data.accountStates; delete data.profiles }
    if (!sections.has('vault')) { delete data.vault; delete data.vaultTombstones }
    if (!sections.has('failover')) { delete data.failover }
    if (!sections.has('settings')) { delete data.settings; delete data.customThemes; delete data.changelog; delete data.identity }
    if (!sections.has('notes')) { delete data.notes; delete data.notesTrash }
}

export function SettingsPage() {
    useDocumentTitle('Settings')
    const { theme, setTheme } = useTheme()
    const accounts = useAccountStore(s => s.accounts)
    const exportAccounts = useAccountStore(s => s.exportAccounts)
    const importAccounts = useAccountStore(s => s.importAccounts)
    const initializeAddonStore = useAddonStore(s => s.initialize)
    const isPrivacyModeEnabled = useUIStore(s => s.isPrivacyModeEnabled)
    const togglePrivacyMode = useUIStore(s => s.togglePrivacyMode)
    const liveActivity = useUIStore(s => s.liveActivity)
    const setLiveActivity = useUIStore(s => s.setLiveActivity)
    const privacyLevelNames = useUIStore(s => s.privacyLevelNames)
    const privacyLevelUrls = useUIStore(s => s.privacyLevelUrls)
    const privacyLevelProfiles = useUIStore(s => s.privacyLevelProfiles)
    const setPrivacyOption = useUIStore(s => s.setPrivacyOption)
    const { clear: clearLibraryCache, invalidate } = useLibraryCache()

    const [activeTab, setActiveTab] = useState(() => {
        const hash = window.location.hash.replace('#', '')
        if (['general', 'appearance', 'data', 'advanced'].includes(hash)) {
            return hash
        }
        return 'general'
    })

    const handleTabChange = (val: string) => {
        setActiveTab(val)
        window.history.replaceState(null, '', `#${val}`)
    }

    useEffect(() => {
        const settingsPath = window.location.pathname
        return () => {
            if (window.location.pathname === settingsPath) {
                window.history.replaceState(null, '', window.location.pathname)
            }
        }
    }, [])

    const [confirmDialog, setConfirmDialog] = useState<{
        open: boolean
        title: string
        description: string
        action: () => Promise<void>
        destructive?: boolean
    }>({ open: false, title: '', description: '', action: async () => { } })

    const [exporting, setExporting] = useState(false)
    const [importing, setImporting] = useState(false)
    const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [showExportDialog, setShowExportDialog] = useState(false)
    const [exportSections, setExportSections] = useState<Set<string>>(new Set(['accounts', 'library', 'vault', 'failover', 'settings', 'notes']))
    const [importSections, setImportSections] = useState<Set<string>>(new Set(['accounts', 'library', 'vault', 'failover', 'settings', 'notes']))

    const toggleExportSection = (key: string) => {
        setExportSections(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    const toggleImportSection = (key: string) => {
        setImportSections(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    const filterExportJson = (json: string, sections: Set<string>): string => {
        const data = JSON.parse(json) as Record<string, unknown>
        applySectionFilter(data, sections)
        return JSON.stringify(data, null, 2)
    }

    const filterImportJson = (json: string, sections: Set<string>): string => {
        const data = JSON.parse(json) as Record<string, unknown>
        applySectionFilter(data, sections)
        return JSON.stringify(data, null, 2)
    }

    const resetFileInput = () => {
        if (fileInputRef.current) {
            fileInputRef.current.value = ''
        }
    }

    const buildImportPreview = (data: Record<string, unknown>, file: File): ImportPreview => {
        const errors: string[] = []
        const warnings: string[] = []
        const incomingAccounts = getPreviewAccounts(data)
        const savedAddons = getPreviewSavedAddons(data)
        const profiles = getPreviewProfiles(data)
        const failoverRules = getPreviewFailoverRules(data)
        const accountStates = data?.accountStates && typeof data.accountStates === 'object'
            ? Object.keys(data.accountStates).length
            : 0
        const vaultKeys = data?.vault !== undefined ? asArray(data.vault).length : 'N/A'
        const changelog = asArray(data?.changelog).length
        const settings = data?.settings && typeof data.settings === 'object'
            ? Object.keys(data.settings).length
            : 0
        const watchEvents = asArray(data?.watchEvents).length
        const matchingAccounts = incomingAccounts.filter((incoming) =>
            accounts.some(a => {
                const inc = incoming as Record<string, unknown>
                return a.email?.toLowerCase() === ((inc.email as string) || '').toLowerCase()
            })
        ).length
        const missingCredentials = (incomingAccounts as Record<string, unknown>[]).filter((incoming) => !incoming.authKey).length
        const invalidSavedAddonUrls = (savedAddons as Record<string, unknown>[]).filter((addon) => {
            if (!addon?.installUrl) return true
            try {
                const parsed = new URL(addon.installUrl as string)
                return !['http:', 'https:'].includes(parsed.protocol)
            } catch {
                return true
            }
        }).length

        const recognizedTotal =
            incomingAccounts.length +
            savedAddons.length +
            profiles.length +
            failoverRules.length +
            accountStates +
            (typeof vaultKeys === 'number' ? vaultKeys : 0) +
            changelog +
            settings +
            watchEvents

        if (recognizedTotal === 0) {
            errors.push('No recognizable AIOManager data was found in this JSON file.')
        }
        if (incomingAccounts.length === 0) {
            warnings.push('This backup does not include accounts; it may only restore library data, settings, or diagnostics.')
        }
        if (missingCredentials > 0) {
            warnings.push(`${missingCredentials} account${missingCredentials !== 1 ? 's are' : ' is'} missing auth keys and may need to be re-authenticated after import.`)
        }
        if (invalidSavedAddonUrls > 0) {
            warnings.push(`${invalidSavedAddonUrls} saved addon${invalidSavedAddonUrls !== 1 ? 's have' : ' has'} invalid install URLs and will be skipped.`)
        }
        if (settings > 0) {
            warnings.push('Imported settings can update theme, privacy mode, library view, and custom themes.')
        }
        if (!data?.version) {
            warnings.push('This backup has no version marker; the importer will use compatibility recovery where possible.')
        }

        return {
            fileName: file.name,
            sizeLabel: formatFileSize(file.size),
            version: typeof data?.version === 'string' ? data.version : undefined,
            exportedAt: typeof data?.exportedAt === 'string' ? data.exportedAt : undefined,
            counts: {
                accounts: incomingAccounts.length,
                matchingAccounts,
                savedAddons: savedAddons.length,
                profiles: profiles.length,
                failoverRules: failoverRules.length,
                accountStates,
                vaultKeys,
                changelog,
                settings,
                watchEvents,
            },
            warnings,
            errors,
        }
    }

    const handleExport = () => {
        setExportSections(new Set(['accounts', 'library', 'vault', 'failover', 'settings', 'notes']))
        setShowExportDialog(true)
    }

    const handleConfirmExport = async () => {
        setExporting(true)
        try {
            const json = await exportAccounts(true)
            const filtered = filterExportJson(json, exportSections)

            const blob = new Blob([filtered], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const now = new Date()
            const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`

            const a = document.createElement('a')
            a.href = url
            a.download = `AIOManager-Backup-${timestamp}.json`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)

            toast({ title: 'Export Complete', description: 'Data downloaded.' })
            setShowExportDialog(false)
        } catch (error) {
            if (import.meta.env.DEV) console.error('Export failed:', error)
            toast({ variant: 'destructive', title: 'Export Failed', description: 'Could not export data.' })
        } finally {
            setExporting(false)
        }
    }

    const handleImportClick = () => {
        fileInputRef.current?.click()
    }

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        if (file.size > 100 * 1024 * 1024) {
            toast({ variant: 'destructive', title: 'File Too Large', description: 'Import file must be under 100MB.' })
            resetFileInput()
            return
        }

        if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
            toast({ variant: 'destructive', title: 'Invalid File', description: 'Select a valid JSON file.' })
            resetFileInput()
            return
        }

        try {
            let text = await file.text()
            let data: Record<string, unknown>
            try {
                data = JSON.parse(text) as Record<string, unknown>
            } catch {
                throw new Error('Invalid JSON format for import')
            }

            if (isSyncioExport(data)) {
                const { accounts: syncioAccounts, skipped } = parseSyncioExport(data)
                if (syncioAccounts.length === 0) {
                    throw new Error('No accounts with auth keys found in Syncio export')
                }
                data = {
                    accounts: syncioAccounts.map(a => ({
                        type: 'stremio',
                        authKey: a.authKey,
                        email: a.email,
                        name: a.name,
                    }))
                }
                text = JSON.stringify(data)
                if (skipped > 0) {
                    toast({ title: 'Syncio export detected', description: `Importing ${syncioAccounts.length} accounts, ${skipped} skipped (no auth key).` })
                }
            }

            const preview = buildImportPreview(data, file)
            if (preview.errors.length > 0) {
                toast({ variant: 'destructive', title: 'Import Blocked', description: preview.errors[0] })
                return
            }
            setPendingImport({ text, preview })
            setImportSections(new Set(['accounts', 'library', 'vault', 'failover', 'settings', 'notes']))
        } catch (error) {
            if (import.meta.env.DEV) console.error('Import preview failed:', error)
            toast({ variant: 'destructive', title: 'Import Failed', description: error instanceof Error ? error.message : 'Failed to read import file' })
        } finally {
            resetFileInput()
        }
    }

    const handleConfirmImport = async () => {
        if (!pendingImport) return

        setImporting(true)
        try {
            const filtered = filterImportJson(pendingImport.text, importSections)
            await importAccounts(filtered, false, 'merge', undefined)
            await initializeAddonStore()
            toast({ title: "Import Successful", description: "Selected data has been restored." })
            setPendingImport(null)
        } catch (error) {
            if (import.meta.env.DEV) console.error('Import failed:', error)
            toast({ variant: 'destructive', title: 'Import Failed', description: error instanceof Error ? error.message : 'Failed to import accounts' })
        } finally {
            setImporting(false)
        }
    }

    const handleClearActivity = () => {
        setConfirmDialog({
            open: true,
            title: 'Clear History Cache',
            description: 'This will delete all locally cached activity data and watch event history. Your next sync will re-capture events from your Stremio library. This only deletes local cache, not Stremio remote history.',
            destructive: false,
            action: async () => {
                await clearLibraryCache()
                const { useWatchEventStore } = await import('@/store/watchEventStore')
                useWatchEventStore.getState().reset()
                invalidate()
                toast({ title: 'Activity Cleared', description: 'Watch history cache and event log have been cleared. Sync to rebuild.' })
            },
        })
    }

    return (
        <div className="space-y-4 sm:space-y-8">
            <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                <TabsList className="grid w-full grid-cols-2 sm:inline-flex sm:w-fit">
                    <TabsTrigger value="general" className="h-9 px-3 text-xs sm:px-4">
                        <Shield className="h-3.5 w-3.5" />
                        General
                    </TabsTrigger>
                    <TabsTrigger value="appearance" className="h-9 px-3 text-xs sm:px-4">
                        <Palette className="h-3.5 w-3.5" />
                        Appearance
                    </TabsTrigger>
                    <TabsTrigger value="data" className="h-9 px-3 text-xs sm:px-4">
                        <Settings2 className="h-3.5 w-3.5" />
                        Data & Sync
                    </TabsTrigger>
                    <TabsTrigger value="advanced" className="h-9 px-3 text-xs sm:px-4">
                        <Wrench className="h-3.5 w-3.5" />
                        Advanced
                    </TabsTrigger>
                </TabsList>

                <div className="mt-4 sm:mt-8">
                    {/* General Tab */}
                    <TabsContent value="general" className="mt-0">
                        <div className="grid gap-4 sm:gap-6">
                            <AccountSection />

                            <InstallAppCard />

                            <div className="flex flex-col gap-4 rounded-[1.75rem] border border-border/45 bg-card/80 p-4 sm:p-6 shadow-sm">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="relative flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-2xl border border-border/35 bg-muted/25">
                                            <SquircleOverlay />
                                            <EyeOff className="relative z-10 h-4 w-4 text-muted-foreground" />
                                        </div>
                                        <div>
                                            <Label htmlFor="privacy-mode" className="text-sm sm:text-base font-medium cursor-pointer">Privacy Mode</Label>
                                            <p className="text-xs sm:text-sm text-muted-foreground">Control how sensitive data appears across AIOManager</p>
                                        </div>
                                    </div>
                                    <Switch
                                        id="privacy-mode"
                                        checked={isPrivacyModeEnabled}
                                        onCheckedChange={togglePrivacyMode}
                                        className="self-start sm:self-auto"
                                    />
                                </div>
                                <AnimatePresence initial={false}>
                                    {isPrivacyModeEnabled && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                                            className="overflow-hidden"
                                        >
                                            <div className="flex flex-col gap-4 rounded-xl border border-border/30 bg-muted/20 p-4 mt-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                                                        <p className="text-xs font-medium text-muted-foreground">Granular Privacy Controls</p>
                                                    </div>
                                                    <p className="text-[11px] text-muted-foreground/60">Live preview below each setting</p>
                                                </div>
                                                <div className="flex flex-col gap-4">
                                                    <div className="flex flex-col gap-2">
                                                        <div className="flex items-center justify-between">
                                                            <span className="flex items-center gap-2 text-xs font-medium"><User className="h-3.5 w-3.5 text-muted-foreground" />Account Names</span>
                                                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/50">{privacyLevelNames === 0 ? 'Visible' : privacyLevelNames === 1 ? 'Light' : privacyLevelNames === 2 ? 'Strict' : 'Hidden'}</span>
                                                        </div>
                                                        <PrivacyLevelSlider value={privacyLevelNames} onChange={(v) => setPrivacyOption('privacyLevelNames', v)} />
                                                        <p className="text-xs text-muted-foreground/70 font-mono truncate rounded-lg bg-muted/30 px-2.5 py-1.5 border border-border/20">
                                                            Sonic's Account <span className="text-muted-foreground/50 mx-1">→</span> {maskNameLevel("Sonic's Account", privacyLevelNames)}
                                                        </p>
                                                    </div>
                                                    <div className="h-px bg-border/20" />
                                                    <div className="flex flex-col gap-2">
                                                        <div className="flex items-center justify-between">
                                                            <span className="flex items-center gap-2 text-xs font-medium"><Link className="h-3.5 w-3.5 text-muted-foreground" />Addon URLs</span>
                                                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/50">{privacyLevelUrls === 0 ? 'Visible' : privacyLevelUrls === 1 ? 'Light' : privacyLevelUrls === 2 ? 'Strict' : 'Hidden'}</span>
                                                        </div>
                                                        <PrivacyLevelSlider value={privacyLevelUrls} onChange={(v) => setPrivacyOption('privacyLevelUrls', v)} />
                                                        <p className="text-xs text-muted-foreground/70 font-mono truncate rounded-lg bg-muted/30 px-2.5 py-1.5 border border-border/20">
                                                            {privacyLevelUrls === 0 ? 'metadata.aiostreams.io/stremio/abc' : maskUrlLevel('https://metadata.aiostreams.io/stremio/abc/manifest.json', privacyLevelUrls)}
                                                        </p>
                                                    </div>
                                                    <div className="h-px bg-border/20" />
                                                    <div className="flex flex-col gap-2">
                                                        <div className="flex items-center justify-between">
                                                            <span className="flex items-center gap-2 text-xs font-medium"><Users className="h-3.5 w-3.5 text-muted-foreground" />Profile Names</span>
                                                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/50">{privacyLevelProfiles === 0 ? 'Visible' : privacyLevelProfiles === 1 ? 'Light' : privacyLevelProfiles === 2 ? 'Strict' : 'Hidden'}</span>
                                                        </div>
                                                        <PrivacyLevelSlider value={privacyLevelProfiles} onChange={(v) => setPrivacyOption('privacyLevelProfiles', v)} />
                                                        <p className="text-xs text-muted-foreground/70 font-mono truncate rounded-lg bg-muted/30 px-2.5 py-1.5 border border-border/20">
                                                            Main Setup <span className="text-muted-foreground/50 mx-1">→</span> {maskProfileLevel('Main Setup', privacyLevelProfiles, 3)}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    </TabsContent>

                    {/* Appearance Tab */}
                    <TabsContent value="appearance" className="mt-0">
                        <ThemeSection theme={theme} setTheme={setTheme} />
                    </TabsContent>

                    {/* Data & Sync Tab */}
                    <TabsContent value="data" className="mt-0 space-y-4 sm:space-y-6">
                        {/* Backup & Restore */}
                        <div className="flex flex-col justify-between gap-4 sm:gap-5 rounded-[1.75rem] border border-border/45 bg-card/80 p-4 sm:p-5 shadow-sm md:flex-row md:items-center">
                            <div className="flex flex-1 items-start gap-4">
                                <div className="relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/35 bg-muted/25">
                                    <SquircleOverlay />
                                    <Database className="relative z-10 h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="space-y-1">
                                    <h3 className="text-base font-semibold">Cloud Backup & Restore</h3>
                                    <p className="text-sm text-muted-foreground max-w-md">
                                        Export your entire configuration (Accounts, Profiles, Addons, and Rules) to a portable JSON file.
                                    </p>
                                </div>
                            </div>
                            <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
                                <Button variant="outline" onClick={handleExport} disabled={exporting || accounts.length === 0} className="w-full gap-2 sm:w-auto">
                                    <Download className="h-4 w-4" />
                                    {exporting ? 'Exporting...' : 'Export'}
                                </Button>
                                <Button variant="outline" onClick={handleImportClick} disabled={importing} className="w-full gap-2 sm:w-auto">
                                    <Upload className="h-4 w-4" />
                                    {importing ? 'Importing...' : 'Import'}
                                </Button>
                            </div>
                        </div>

                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json,application/json"
                            onChange={handleFileChange}
                            className="hidden"
                        />

                        {/* Metadata Integrations */}
                        <IntegrationsSection />

                        {/* Active Sync Summary */}
                        <SyncSummarySection />

                        {/* Non-destructive Clear History Cache */}
                        <div className="flex flex-col justify-between gap-4 sm:gap-5 rounded-[1.75rem] border border-border/45 bg-card/80 p-4 sm:p-5 shadow-sm md:flex-row md:items-center">
                            <div className="flex flex-1 items-start gap-3 sm:gap-4">
                                <div className="relative mt-0.5 flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-2xl border border-border/35 bg-muted/25">
                                    <SquircleOverlay />
                                    <Trash2 className="relative z-10 h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="space-y-1">
                                    <h3 className="text-sm sm:text-base font-semibold">Clear History Cache</h3>
                                    <p className="max-w-2xl text-sm text-muted-foreground">
                                        Wipes all locally cached activity view data. Useful if you want to force a clean re-pull from your accounts immediately.
                                    </p>
                                </div>
                            </div>
                            <div className="flex shrink-0 gap-2">
                                <Button variant="outline" onClick={handleClearActivity} className="gap-2">
                                    <Trash2 className="h-4 w-4" />
                                    Clear Cache
                                </Button>
                            </div>
                        </div>

                        <div className="flex flex-col gap-3 sm:gap-4 rounded-[1.75rem] border border-border/45 bg-card/80 p-4 sm:p-5 shadow-sm">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="relative flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-2xl border border-border/35 bg-muted/25">
                                        <SquircleOverlay />
                                        <Activity className="relative z-10 h-4 w-4 text-muted-foreground" />
                                    </div>
                                    <div>
                                        <Label htmlFor="live-activity" className="text-sm sm:text-base font-medium cursor-pointer">Live Activity Refresh</Label>
                                        <p className="text-xs sm:text-sm text-muted-foreground">While viewing the Activity page, auto-refresh progress every 60 seconds</p>
                                    </div>
                                </div>
                                <Switch
                                    id="live-activity"
                                    checked={liveActivity}
                                    onCheckedChange={setLiveActivity}
                                    className="self-start sm:self-auto"
                                />
                            </div>
                                {liveActivity && (
                                    <p className="text-xs text-muted-foreground/60 pl-12 sm:pl-14 pt-1 border-t border-border/20 mt-1">
                                        {accounts.length > 10
                                            ? <span className="text-warning/80">You have {accounts.length} accounts. Live refresh will send ~{accounts.length} requests to Stremio every 60 seconds ({accounts.length * 60} requests/hour). This may trigger rate limits.</span>
                                            : <>Each refresh sends 1 request per account to Stremio. With {accounts.length} account{accounts.length !== 1 ? 's' : ''}, that's ~{accounts.length} requests every 60 seconds.</>
                                        }
                                    </p>
                                )}
                        </div>
                    </TabsContent>
                    <TabsContent value="advanced" className="mt-0 space-y-4 sm:space-y-6">
                        <NotificationsSection />
                        <RepairTools />
                        <SyncDiagnostics />
                        <DangerZone />
                    </TabsContent>
                </div>
            </Tabs>

            <AlertDialog
                open={!!pendingImport}
                onOpenChange={(open: boolean) => {
                    if (!open && !importing) setPendingImport(null)
                }}
            >
                <AlertDialogContent className="max-w-lg">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <FileJson className="h-5 w-5 text-primary" />
                            Preview Import
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Review the backup contents before applying changes to this device.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {pendingImport && (
                        <div className="space-y-4 px-6 pb-5">
                            <div className="rounded-2xl border border-border/40 bg-muted/20 p-3 text-sm">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate font-medium text-foreground">{pendingImport.preview.fileName}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {pendingImport.preview.sizeLabel}
                                            {pendingImport.preview.version ? ` / v${pendingImport.preview.version}` : ''}
                                            {pendingImport.preview.exportedAt ? ` / ${new Date(pendingImport.preview.exportedAt).toLocaleString()}` : ''}
                                        </p>
                                    </div>
                                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                                {[
                                    ['Accounts', pendingImport.preview.counts.accounts],
                                    ['Saved Addons', pendingImport.preview.counts.savedAddons],
                                    ['Profiles', pendingImport.preview.counts.profiles],
                                    ['Autopilot Rules', pendingImport.preview.counts.failoverRules],
                                    ['Vault Keys', pendingImport.preview.counts.vaultKeys],
                                    ['Settings', pendingImport.preview.counts.settings],
                                ].map(([label, count]) => (
                                    <div key={label} className="rounded-xl border border-border/35 bg-background/60 p-3">
                                        <p className="text-base font-semibold text-foreground">{count}</p>
                                        <p className="text-muted-foreground">{label}</p>
                                    </div>
                                ))}
                            </div>

                            <div className="rounded-2xl border border-border/35 bg-background/50 p-3 text-xs text-muted-foreground">
                                <p>
                                    {pendingImport.preview.counts.matchingAccounts} account{pendingImport.preview.counts.matchingAccounts !== 1 ? 's' : ''} appear to match existing local accounts by ID or email.
                                </p>
                                {(pendingImport.preview.counts.accountStates > 0 || pendingImport.preview.counts.changelog > 0 || pendingImport.preview.counts.watchEvents > 0) && (
                                    <p className="mt-1">
                                        Also includes {pendingImport.preview.counts.accountStates} account state record{pendingImport.preview.counts.accountStates !== 1 ? 's' : ''}, {pendingImport.preview.counts.changelog} changelog entr{pendingImport.preview.counts.changelog !== 1 ? 'ies' : 'y'}, and {pendingImport.preview.counts.watchEvents} watch event{pendingImport.preview.counts.watchEvents !== 1 ? 's' : ''}.
                                    </p>
                                )}
                            </div>

                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Select what to import</p>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={() => setImportSections(new Set(BACKUP_SECTIONS.map(s => s.key)))} className="text-xs text-primary hover:underline">Select All</button>
                                        <button type="button" onClick={() => setImportSections(new Set())} className="text-xs text-muted-foreground hover:underline">Clear</button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                                    {BACKUP_SECTIONS.map(section => {
                                        const isSelected = importSections.has(section.key)
                                        return (
                                            <button
                                                key={section.key}
                                                type="button"
                                                onClick={() => toggleImportSection(section.key)}
                                                className={`flex items-start gap-2 rounded-xl border p-2.5 text-left transition-colors ${isSelected ? 'border-primary/30 bg-primary/8' : 'border-border/30 bg-muted/20 opacity-60'}`}
                                            >
                                                <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'}`}>
                                                    {isSelected && <CheckCircle2 className="h-3 w-3" />}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-xs font-medium text-foreground">{section.label}</p>
                                                    <p className="text-[11px] text-muted-foreground line-clamp-1">{section.description}</p>
                                                </div>
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            {pendingImport.preview.warnings.length > 0 && (
                                <div className="space-y-2 rounded-2xl border border-warning/25 bg-warning/10 p-3">
                                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-warning">
                                        <AlertTriangle className="h-3.5 w-3.5" />
                                        Import Notes
                                    </p>
                                    <ul className="space-y-1 text-xs text-muted-foreground">
                                        {pendingImport.preview.warnings.map((warning) => (
                                            <li key={warning}>- {warning}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={importing}>Cancel</AlertDialogCancel>
                        <Button
                            type="button"
                            onClick={handleConfirmImport}
                            disabled={importing || importSections.size === 0}
                            className="h-11 rounded-full"
                        >
                            {importing ? 'Importing...' : 'Import Backup'}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={showExportDialog} onOpenChange={(open: boolean) => { if (!exporting) setShowExportDialog(open) }}>
                <AlertDialogContent className="max-w-lg">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <Download className="h-5 w-5 text-primary" />
                            Export Backup
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Choose what to include in your backup file.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-3 px-6 pb-5">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sections</p>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setExportSections(new Set(BACKUP_SECTIONS.map(s => s.key)))} className="text-xs text-primary hover:underline">Select All</button>
                                <button type="button" onClick={() => setExportSections(new Set())} className="text-xs text-muted-foreground hover:underline">Clear</button>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                            {BACKUP_SECTIONS.map(section => {
                                const isSelected = exportSections.has(section.key)
                                return (
                                    <button
                                        key={section.key}
                                        type="button"
                                        onClick={() => toggleExportSection(section.key)}
                                        className={`flex items-start gap-2 rounded-xl border p-2.5 text-left transition-colors ${isSelected ? 'border-primary/30 bg-primary/8' : 'border-border/30 bg-muted/20 opacity-60'}`}
                                    >
                                        <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'}`}>
                                            {isSelected && <CheckCircle2 className="h-3 w-3" />}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-xs font-medium text-foreground">{section.label}</p>
                                            <p className="text-[11px] text-muted-foreground line-clamp-1">{section.description}</p>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={exporting}>Cancel</AlertDialogCancel>
                        <Button
                            type="button"
                            onClick={handleConfirmExport}
                            disabled={exporting || exportSections.size === 0}
                            className="h-11 rounded-full"
                        >
                            {exporting ? 'Exporting...' : 'Download Backup'}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Confirmation Dialog needed for SettingsPage specifically (Clear History Cache) */}
            <AlertDialog open={confirmDialog.open} onOpenChange={(open: boolean) => setConfirmDialog(prev => ({ ...prev, open }))}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
                        <AlertDialogDescription>{confirmDialog.description}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className={confirmDialog.destructive ? 'bg-secondary text-destructive hover:bg-secondary/80 hover:text-destructive' : ''}
                            onClick={async () => {
                                await confirmDialog.action()
                                setConfirmDialog(prev => ({ ...prev, open: false }))
                            }}
                        >
                            Confirm
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
