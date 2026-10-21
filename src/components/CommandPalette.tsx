import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAccountStore } from '@/store/accountStore'
import type { BulkActionDefinition } from '@/components/accounts/bulk-actions/registry'
import { useNavigate } from 'react-router-dom'
import {
    LayoutDashboard,
    Package,
    Activity,
    BarChart3,
    Settings,
    HelpCircle,
    User,
    Search,
    CornerDownLeft,
    Sparkles,
    KeyRound,
    StickyNote,
    Tv,
    Key,
    Bookmark,
    ListChecks,
    Compass,
    Link2,
    Palette,
    Database,
    Wrench,
    Plug,
    Radar,
    Film,
} from 'lucide-react'
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useFailoverStore } from '@/store/failoverStore'
import { useUIStore } from '@/store/uiStore'
import { useNotesStore } from '@/store/notesStore'
import { useVaultStore } from '@/store/vaultStore'
import { useAddonStore } from '@/store/addonStore'
import { maskEmailLevel, maskNameLevel } from '@/lib/utils'
import { isAIOStreamsAddon, parseAIOStreamsUrl } from '@/lib/aiostreams-utils'
import { isAIOMetadataAddon, parseAIOMetadataUrl } from '@/lib/aiometadata-utils'
import { filterCommandsByQuery, groupCommandsByCategory } from '@/lib/command-search'
import type { Account } from '@/types/account'

type CommandCategory =
    | 'Navigation'
    | 'Settings'
    | 'Accounts'
    | 'Addons'
    | 'Notes'
    | 'Vault'
    | 'Saved Addons'
    | 'Quick Actions'
    | 'Bulk Operations'

// Authoritative visual order of the result groups. The keyboard selection
// index is derived from the flattened grouped order, never from the raw item
// list, so the highlighted row always matches what the user sees.
const CATEGORY_ORDER: CommandCategory[] = [
    'Navigation',
    'Settings',
    'Accounts',
    'Addons',
    'Notes',
    'Vault',
    'Saved Addons',
    'Quick Actions',
    'Bulk Operations',
]

const NO_ACCOUNTS: Account[] = []
const NO_RULES: ReturnType<typeof useFailoverStore.getState>['rules'] = []
const NO_NOTES: ReturnType<typeof useNotesStore.getState>['notes'] = []
const NO_VAULT_KEYS: ReturnType<typeof useVaultStore.getState>['keys'] = []
const NO_SAVED_ADDONS: ReturnType<typeof useAddonStore.getState>['library'] = {}

export interface CommandItem {
    id: string
    /** Masked display label. Raw searchable text lives in searchText. */
    label: string
    sublabel?: string
    icon: React.ReactNode
    action: () => void
    category: CommandCategory
    emoji?: string
    avatarUrl?: string
    searchText?: string
    aliases?: string[]
}

const VIRTUAL_RESULTS_THRESHOLD = 100
export interface CommandResultGroup { category: string; items: CommandItem[] }

type VirtualResultsComponent = typeof import('./CommandPaletteResults').VirtualCommandResults

// Settings tab destinations. The tab ids and hash routing mirror how
// SettingsPage reads location.hash ('general' | 'appearance' | 'data' |
// 'advanced') and the labels mirror SettingsNavigation's SETTING_TAB_LABELS.
const SETTINGS_TAB_ITEMS: Array<{
    id: string
    hash: string
    label: string
    sublabel: string
    icon: React.ReactNode
    aliases: string[]
}> = [
    {
        id: 'settings-general',
        hash: 'general',
        label: 'Settings - General',
        sublabel: 'Sync identity, privacy mode, install, about',
        icon: <Settings className="h-4 w-4" />,
        aliases: ['general', 'privacy', 'identity', 'preferences'],
    },
    {
        id: 'settings-appearance',
        hash: 'appearance',
        label: 'Settings - Appearance',
        sublabel: 'Light, dark, and OLED themes with accent colors',
        icon: <Palette className="h-4 w-4" />,
        aliases: ['appearance', 'theme', 'themes', 'dark mode', 'light mode', 'oled', 'accent'],
    },
    {
        id: 'settings-data',
        hash: 'data',
        label: 'Settings - Data & Sync',
        sublabel: 'Backup and restore, metadata integrations, API keys, active sync connections',
        icon: <Database className="h-4 w-4" />,
        aliases: ['data', 'backup', 'restore', 'export', 'import', 'api keys', 'metadata integrations'],
    },
    {
        id: 'settings-advanced',
        hash: 'advanced',
        label: 'Settings - Advanced',
        sublabel: 'Monitoring and alerts, repair and recovery, sync diagnostics, danger zone',
        icon: <Wrench className="h-4 w-4" />,
        aliases: ['advanced', 'webhook', 'webhooks', 'repair', 'diagnostics', 'alerts', 'danger zone', 'remembered devices', 'sessions'],
    },
]

export function CommandPalette() {
    const [open, setOpen] = useState(false)
    const [exitPending, setExitPending] = useState(false)
    // Dialog keeps its children for a 200ms exit. Keep the current list through
    // that transition, then release its subscriptions and derived commands.
    const indexActive = open || exitPending
    useEffect(() => {
        if (open) { setExitPending(true); return }
        const timer = setTimeout(() => setExitPending(false), 220)
        return () => clearTimeout(timer)
    }, [open])
    const [query, setQuery] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [bulkActions, setBulkActions] = useState<BulkActionDefinition[]>([])
    const [VirtualCommandResults, setVirtualCommandResults] = useState<VirtualResultsComponent | null>(null)
    const [resultsLoadFailed, setResultsLoadFailed] = useState(false)
    const [resultsLoadAttempt, setResultsLoadAttempt] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null)
    const attachScrollRoot = useCallback((node: HTMLDivElement | null) => {
        scrollRef.current = node
        setScrollRoot(node)
    }, [])
    const navigate = useNavigate()
    const accounts = useAccountStore((s) => indexActive ? s.accounts : NO_ACCOUNTS)
    const syncAllAccounts = useAccountStore((s) => s.syncAllAccounts)
    const checkRules = useFailoverStore((s) => s.checkRules)
    const autopilotRules = useFailoverStore((s) => indexActive ? s.rules : NO_RULES)
    const notes = useNotesStore((s) => indexActive ? s.notes : NO_NOTES)
    const vaultKeys = useVaultStore((s) => indexActive ? s.keys : NO_VAULT_KEYS)
    const savedAddonLibrary = useAddonStore((s) => indexActive ? s.library : NO_SAVED_ADDONS)
    const isPrivacyModeEnabled = useUIStore((s) => s.isPrivacyModeEnabled)
    const privacyLevelNames = useUIStore((s) => s.privacyLevelNames)
    const privacyLevelEmail = useUIStore((s) => s.privacyLevelEmail)
    const namePrivacy = isPrivacyModeEnabled ? privacyLevelNames : 0
    const emailPrivacy = isPrivacyModeEnabled ? privacyLevelEmail : 0

    useEffect(() => {
        const keyHandler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault()
                setOpen((prev) => !prev)
            }
        }
        const customHandler = () => setOpen(true)
        window.addEventListener('keydown', keyHandler)
        window.addEventListener('open-command-palette', customHandler)
        return () => {
            window.removeEventListener('keydown', keyHandler)
            window.removeEventListener('open-command-palette', customHandler)
        }
    }, [])

    const go = useCallback(
        (path: string) => {
            navigate(path)
            setOpen(false)
        },
        [navigate]
    )

    // Display helpers. Labels render masked under privacy mode while the raw
    // values stay searchable through searchText. Credential fields (connection
    // credentials, vault key values) are never searched or displayed.
    const accountLabel = useCallback(
        (acc: Account) => {
            const name = acc.name || acc.email || ''
            return (name.includes('@') ? maskEmailLevel(name, emailPrivacy) : maskNameLevel(name, namePrivacy)) || 'Unnamed Account'
        },
        [namePrivacy, emailPrivacy]
    )

    const accountSearchText = useCallback((acc: Account) => {
        const platforms = (acc.connections ?? []).flatMap((c) => [c.platform, c.displayName ?? ''])
        return [acc.name, acc.email ?? '', ...platforms].filter(Boolean).join(' ')
    }, [])

    const allItems = useMemo<CommandItem[]>(() => {
        if (!indexActive) return []
        const items: CommandItem[] = []
        const rulesByAccount = new Map<string, typeof autopilotRules>()
        for (const rule of autopilotRules) {
            const rules = rulesByAccount.get(rule.accountId)
            if (rules) rules.push(rule)
            else rulesByAccount.set(rule.accountId, [rule])
        }
        // Preserve account order and count each account once per installed URL.
        const accountsByAddonUrl = new Map<string, Account[]>()
        for (const account of accounts) {
            for (const url of new Set((account.addons ?? []).map(addon => addon.transportUrl))) {
                const installed = accountsByAddonUrl.get(url)
                if (installed) installed.push(account)
                else accountsByAddonUrl.set(url, [account])
            }
        }

        items.push(
            {
                id: 'nav-accounts',
                label: 'Accounts',
                sublabel: 'Dashboard home - manage all accounts',
                icon: <LayoutDashboard className="h-4 w-4" />,
                action: () => go('/'),
                category: 'Navigation',
                aliases: ['home', 'dashboard', 'accounts'],
            },
            {
                id: 'nav-discover',
                label: 'Discover Addons',
                sublabel: 'Find and save new addons',
                icon: <Compass className="h-4 w-4" />,
                action: () => go('/saved-addons#discover'),
                category: 'Navigation',
                aliases: ['discover', 'discovery', 'find addons', 'browse addons', 'new addons', 'catalog'],
            },
            {
                id: 'nav-library',
                label: 'Saved Addons Library',
                sublabel: 'Browse and manage saved addon profiles',
                icon: <Package className="h-4 w-4" />,
                action: () => go('/saved-addons'),
                category: 'Navigation',
                aliases: ['library', 'saved addons', 'addon library'],
            },
            {
                id: 'nav-addon-sync',
                label: 'Saved Addons Sync',
                sublabel: 'Review saved addons mirrored into account addons',
                icon: <Link2 className="h-4 w-4" />,
                action: () => go('/saved-addons#sync'),
                category: 'Navigation',
                aliases: ['sync', 'mirroring', 'mirror', 'active sync', 'deployment', 'addon sync'],
            },
            {
                id: 'nav-activity',
                label: 'Activity',
                sublabel: 'Unified watch history from all accounts',
                icon: <Activity className="h-4 w-4" />,
                action: () => go('/activity'),
                category: 'Navigation',
                aliases: ['history', 'watch history', 'activity'],
            },
            {
                id: 'nav-metrics',
                label: 'Metrics',
                sublabel: 'Stats, charts, and insights',
                icon: <BarChart3 className="h-4 w-4" />,
                action: () => go('/metrics'),
                category: 'Navigation',
                aliases: ['metrics', 'stats', 'statistics', 'charts'],
            },
            {
                id: 'nav-replay',
                label: 'Replay',
                sublabel: 'Year in review experience',
                icon: <Tv className="h-4 w-4" />,
                action: () => go('/replay'),
                category: 'Navigation',
                aliases: ['replay', 'year in review', 'wrapped'],
            },
            {
                id: 'nav-notes',
                label: 'Notes',
                sublabel: 'Markdown notes and documentation',
                icon: <StickyNote className="h-4 w-4" />,
                action: () => go('/notes'),
                category: 'Navigation',
                aliases: ['notes', 'markdown', 'documentation'],
            },
            {
                id: 'nav-vault',
                label: 'Key Vault',
                sublabel: 'Encrypted API key management',
                icon: <KeyRound className="h-4 w-4" />,
                action: () => go('/vault'),
                category: 'Navigation',
                aliases: ['vault', 'api keys', 'keys', 'credentials'],
            },
            {
                id: 'nav-theme-editor',
                label: 'Theme Editor',
                sublabel: 'Edit the custom theme color palette',
                icon: <Palette className="h-4 w-4" />,
                action: () => go('/settings/theme/editor'),
                category: 'Navigation',
                aliases: ['theme editor', 'custom theme', 'colors', 'design'],
            },
            {
                id: 'nav-settings',
                label: 'Settings',
                sublabel: 'Themes, sync, privacy, and preferences',
                icon: <Settings className="h-4 w-4" />,
                action: () => go('/settings'),
                category: 'Navigation',
                aliases: ['settings', 'preferences', 'options'],
            },
            {
                id: 'nav-faq',
                label: 'Docs',
                sublabel: 'Help, guides, and troubleshooting',
                icon: <HelpCircle className="h-4 w-4" />,
                action: () => go('/kronorium'),
                category: 'Navigation',
                aliases: ['docs', 'documentation', 'help', 'faq', 'guides', 'kronorium'],
            }
        )

        for (const tab of SETTINGS_TAB_ITEMS) {
            items.push({
                id: tab.id,
                label: tab.label,
                sublabel: tab.sublabel,
                icon: tab.icon,
                action: () => go(`/settings#${tab.hash}`),
                category: 'Settings',
                aliases: tab.aliases,
            })
        }

        for (const acc of accounts) {
            items.push({
                id: `acc-${acc.id}`,
                label: accountLabel(acc),
                emoji: acc.emoji,
                avatarUrl: acc.avatar,
                sublabel: acc.email && acc.name ? maskEmailLevel(acc.email, emailPrivacy) : undefined,
                icon: <User className="h-4 w-4" />,
                action: () => go(`/account/${acc.id}`),
                category: 'Accounts',
                searchText: accountSearchText(acc),
            })

            // Per-account Connections tab destination, searchable by account
            // name and linked platform.
            const connections = acc.connections ?? []
            if (connections.length > 0) {
                // Display platform names only; connection display names can
                // carry personal text, so they stay searchable but unrendered.
                const platformLabels = [
                    ...new Set(connections.map((c) => c.platform)),
                ]
                items.push({
                    id: `connections-${acc.id}`,
                    label: `Connections - ${accountLabel(acc)}`,
                    sublabel: platformLabels.join(', '),
                    icon: <Plug className="h-4 w-4" />,
                    action: () => go(`/account/${acc.id}?tab=connections`),
                    category: 'Accounts',
                    searchText: accountSearchText(acc),
                    aliases: ['connections', 'platforms', 'linked platforms', 'integrations'],
                })
            }

            // Per-account Autopilot tab destination, searchable by account
            // name, platform, and rule names.
            const rules = rulesByAccount.get(acc.id) ?? []
            if (rules.length > 0) {
                const ruleNames = rules.map((r) => r.name).filter((n): n is string => Boolean(n))
                const countLabel = `${rules.length} rule${rules.length !== 1 ? 's' : ''}`
                items.push({
                    id: `autopilot-${acc.id}`,
                    label: `Autopilot - ${accountLabel(acc)}`,
                    sublabel:
                        ruleNames.length > 0
                            ? `${countLabel}: ${ruleNames.slice(0, 2).join(', ')}`
                            : countLabel,
                    icon: <Radar className="h-4 w-4" />,
                    action: () => go(`/account/${acc.id}?tab=failover`),
                    category: 'Accounts',
                    searchText: [accountSearchText(acc), ...ruleNames].filter(Boolean).join(' '),
                    aliases: ['autopilot', 'failover', 'rules', 'monitoring', 'chains'],
                })
            }
        }

        // Per-account AIOStreams and AIOMetadata instance destinations. The
        // routes and uuid parsing mirror AIOStreamsPage and AIOMetadataPage.
        for (const acc of accounts) {
            for (const addon of acc.addons ?? []) {
                const addonName =
                    addon.metadata?.customName || addon.manifest?.name || addon.transportName || ''
                if (isAIOStreamsAddon(addon)) {
                    const parsed = parseAIOStreamsUrl(addon.transportUrl)
                    if (parsed) {
                        items.push({
                            id: `aiostreams-${acc.id}-${parsed.uuid}`,
                            label: addonName || 'AIOStreams',
                            sublabel: `AIOStreams - ${accountLabel(acc)}`,
                            icon: <Tv className="h-4 w-4" />,
                            action: () => go(`/account/${acc.id}/aiostreams/${parsed.uuid}`),
                            category: 'Addons',
                            searchText: [
                                accountSearchText(acc),
                                parsed.baseUrl,
                                parsed.uuid,
                                addonName,
                                'aiostreams',
                            ]
                                .filter(Boolean)
                                .join(' '),
                            aliases: ['aiostreams', 'streams', 'debrid', 'config'],
                        })
                    }
                }
                if (isAIOMetadataAddon(addon)) {
                    const parsed = parseAIOMetadataUrl(addon.transportUrl)
                    if (parsed) {
                        items.push({
                            id: `aiometadata-${acc.id}-${parsed.uuid}`,
                            label: addonName || 'AIOMetadata',
                            sublabel: `AIOMetadata - ${accountLabel(acc)}`,
                            icon: <Film className="h-4 w-4" />,
                            action: () => go(`/account/${acc.id}/aiometadata/${parsed.uuid}`),
                            category: 'Addons',
                            searchText: [
                                accountSearchText(acc),
                                parsed.baseUrl,
                                parsed.uuid,
                                addonName,
                                'aiometadata',
                            ]
                                .filter(Boolean)
                                .join(' '),
                            aliases: ['aiometadata', 'metadata', 'meta', 'catalogs', 'config'],
                        })
                    }
                }
            }
        }

        for (const n of notes) {
            const sublabel = n.tags.length > 0 ? n.tags.slice(0, 3).map(t => `#${t}`).join(' ') : 'Note'
            items.push({
                id: `note-${n.id}`,
                label: n.title,
                sublabel,
                icon: <StickyNote className="h-4 w-4" />,
                action: () => go(`/notes?note=${encodeURIComponent(n.id)}`),
                category: 'Notes',
                searchText: [n.title, ...n.tags, ...n.wikilinks].filter(Boolean).join(' '),
            })
        }

        for (const k of vaultKeys) {
            items.push({
                id: `vault-${k.id}`,
                label: k.name || k.customProviderName || k.provider,
                sublabel: k.provider,
                icon: <Key className="h-4 w-4" />,
                action: () => go('/vault'),
                category: 'Vault',
                searchText: [k.serverUrl, k.addonUuid, k.customProviderName].filter(Boolean).join(' '),
                aliases: ['api key', 'vault', 'credential'],
            })
        }

        const savedAddonList = Object.values(savedAddonLibrary)
        for (const a of savedAddonList) {
            const tagStr = (a.tags ?? []).join(' ')
            const manifestName = a.manifest?.name ?? ''
            const installedAccounts = accountsByAddonUrl.get(a.installUrl) ?? []
            const installedLabels = installedAccounts.map(acc => accountLabel(acc))
            const accountStr = installedLabels.length > 0 ? installedLabels.join(', ') : 'Not installed'
            const firstAccountId = installedAccounts[0]?.id
            // Raw account names and emails stay searchable while the
            // displayed deployment list is masked under privacy mode.
            const rawAccountStr = installedAccounts
                .map(acc => [acc.name, acc.email ?? ''].filter(Boolean).join(' '))
                .join(' ')
            items.push({
                id: `addon-${a.id}`,
                label: a.name || 'Unnamed Addon',
                sublabel: accountStr,
                icon: <Bookmark className="h-4 w-4" />,
                action: () => go(firstAccountId ? `/account/${firstAccountId}` : '/saved-addons'),
                category: 'Saved Addons',
                searchText: `${a.name ?? ''} ${manifestName} ${tagStr} ${rawAccountStr}`,
            })
        }

        items.push(
            {
                id: 'action-refresh',
                label: 'Refresh All Accounts',
                sublabel: 'Sync addons for every connected account',
                icon: <Activity className="h-4 w-4" />,
                action: () => {
                    syncAllAccounts()
                    checkRules()
                    setOpen(false)
                },
                category: 'Quick Actions',
                aliases: ['refresh', 'sync all', 'update all'],
            },
            {
                id: 'action-changelog',
                label: 'View Changelog',
                sublabel: "See what's new in this release",
                icon: <Sparkles className="h-4 w-4" />,
                action: () => {
                    useUIStore.getState().setWhatsNewOpen(true)
                    setOpen(false)
                },
                category: 'Quick Actions',
                aliases: ['changelog', 'whats new', 'release notes'],
            }
        )

        for (const def of bulkActions) {
            items.push({
                id: `bulk-${def.id}`,
                label: def.title,
                sublabel: def.description,
                icon: <ListChecks className="h-4 w-4" />,
                action: () => {
                    navigate('/?bulk=' + def.id)
                    setOpen(false)
                },
                category: 'Bulk Operations',
                aliases: ['bulk', 'batch'],
            })
        }

        return items
    }, [indexActive, accounts, notes, vaultKeys, savedAddonLibrary, autopilotRules, go, syncAllAccounts, checkRules, navigate, bulkActions, accountLabel, accountSearchText, emailPrivacy])

    const filtered = useMemo(() => filterCommandsByQuery(allItems, query), [allItems, query])

    const groups = useMemo(() => groupCommandsByCategory(filtered, CATEGORY_ORDER), [filtered])

    // Flattened grouped order. This is the order the user sees and the order
    // the keyboard navigates, so selection can never drift from the visual
    // grouping.
    const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups])
    const needsVirtualResults = indexActive && ordered.length > VIRTUAL_RESULTS_THRESHOLD
    useEffect(() => {
        if (!needsVirtualResults || VirtualCommandResults) return
        let cancelled = false
        setResultsLoadFailed(false)
        // Keep the virtualizer out of the startup bundle without suspending the
        // dialog's first reveal while the result module resolves.
        import('./CommandPaletteResults').then(module => {
            if (!cancelled) setVirtualCommandResults(() => module.VirtualCommandResults)
        }).catch(() => {
            if (!cancelled) setResultsLoadFailed(true)
        })
        return () => { cancelled = true }
    }, [needsVirtualResults, VirtualCommandResults, resultsLoadAttempt])

    const indexById = useMemo(() => {
        const map = new Map<string, number>()
        ordered.forEach((item, i) => map.set(item.id, i))
        return map
    }, [ordered])

    useEffect(() => {
        setSelectedIndex(0)
    }, [query])

    // Keep the selection inside the result list as it shrinks or empties.
    // Never allow a negative index with zero results.
    useEffect(() => {
        setSelectedIndex((prev) => (prev >= ordered.length ? 0 : prev))
    }, [ordered.length])

    useEffect(() => {
        if (!open || bulkActions.length > 0) return
        let cancelled = false
        import('@/components/accounts/bulk-actions/registry')
            .then(m => { if (!cancelled) setBulkActions(m.BULK_ACTIONS) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [open, bulkActions.length])

    useEffect(() => {
        if (open) {
            setQuery('')
            setSelectedIndex(0)
            setTimeout(() => inputRef.current?.focus(), 50)
        }
    }, [open])

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (ordered.length === 0) return
            setSelectedIndex((prev) => Math.min(prev + 1, ordered.length - 1))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            if (ordered.length === 0) return
            setSelectedIndex((prev) => Math.max(prev - 1, 0))
        } else if (e.key === 'Enter') {
            const item = ordered[selectedIndex]
            if (item) {
                e.preventDefault()
                item.action()
            }
        } else if (e.key === 'Escape') {
            setOpen(false)
        }
    }

    useEffect(() => {
        if (ordered.length > VIRTUAL_RESULTS_THRESHOLD) return
        const el = scrollRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
        if (el) {
            el.scrollIntoView({ block: 'nearest' })
        }
    }, [selectedIndex, ordered.length])

    const renderCommandItem = (item: CommandItem) => {
        const flatIndex = indexById.get(item.id) ?? -1
        const isSelected = flatIndex === selectedIndex

        return (
            <button data-theme-part="nav-item" data-state={isSelected ? "active" : "inactive"}
                key={item.id}
                data-index={flatIndex}
                onClick={(e) => {
                    e.preventDefault()
                    item.action()
                }}
                className={`relative mx-3 flex w-[calc(100%-1.5rem)] items-center gap-3 rounded-2xl px-3 py-3 text-left transition-[background-color,box-shadow,color,transform] duration-150 ${isSelected
                    ? 'bg-primary/10 text-foreground shadow-sm ring-1 ring-primary/20'
                    : 'text-foreground hover:bg-muted/30'
                    }`}
            >
                {isSelected && (
                    <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" />
                )}
                    {item.avatarUrl ? (
                        <span data-theme-part="avatar" className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl overflow-hidden transition-colors">
                            <img src={item.avatarUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                        </span>
                    ) : (
                        <span data-theme-part="badge"
                            className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition-colors ${isSelected ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted/45 text-muted-foreground'}`}
                        >
                            {item.icon}
                        </span>
                    )}
                <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-semibold tracking-tight">
                        {item.emoji && <span className="mr-2">{item.emoji}</span>}
                        {item.label}
                    </div>
                    {item.sublabel && (
                        <div className="truncate text-xs font-medium text-muted-foreground">
                            {item.sublabel}
                        </div>
                    )}
                </div>
                {isSelected && (
                    <CornerDownLeft className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
                )}
            </button>
        )

    }
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
                className="max-w-[min(92vw,42rem)] sm:max-w-2xl p-0 gap-0 overflow-hidden rounded-[2rem] border border-border/50 bg-card/90 shadow-2xl ring-1 ring-white/5 backdrop-blur-2xl [&>button:last-child]:hidden"
                onKeyDown={handleKeyDown}
            >
                <DialogTitle className="sr-only">Command palette</DialogTitle>

                <div data-theme-part="field" className="mx-3 mt-3 flex items-center gap-3 rounded-2xl border border-border/40 bg-muted/25 px-4 py-3 shadow-inner">
                    <Search className="h-4 w-4 text-muted-foreground/80 flex-shrink-0" />
                    <input
                        data-theme-part="inline-input"
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search pages, accounts, addons, actions..."
                        className="h-6 w-full min-w-0 flex-1 border-0 bg-transparent p-0 text-base font-medium text-foreground outline-none placeholder:text-muted-foreground/55 focus:ring-0 sm:text-sm"
                    />
                    <button data-theme-part="button"
                        onClick={() => setOpen(false)}
                        className="hidden sm:inline-flex items-center gap-0.5 rounded-lg border border-border/50 bg-background/40 px-2 py-1 text-[11px] font-mono text-muted-foreground shadow-sm transition-colors hover:bg-muted/60 hover:text-foreground"
                    >
                        Esc
                    </button>
                </div>


                <ScrollArea className={ordered.length > VIRTUAL_RESULTS_THRESHOLD ? "h-[min(54vh,440px)]" : "max-h-[min(54vh,440px)]"} ref={attachScrollRoot}>
                    <div className="py-3">
                        {filtered.length === 0 && (
                            <div data-theme-part="panel" className="mx-3 rounded-2xl border border-dashed border-border/40 bg-muted/15 px-4 py-10 text-center text-sm text-muted-foreground">
                                No results found for "{query}"
                            </div>
                        )}

                        {ordered.length > VIRTUAL_RESULTS_THRESHOLD ? (VirtualCommandResults
                            ? <VirtualCommandResults groups={groups} selectedIndex={selectedIndex} query={query} scrollRoot={scrollRoot} renderItem={renderCommandItem} />
                            : <div className="px-6 py-4 text-sm text-muted-foreground" role="status">
                                {resultsLoadFailed ? <>Could not load search results. <button type="button" className="underline" onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation() }} onClick={() => setResultsLoadAttempt(attempt => attempt + 1)}>Retry</button></> : 'Loading search results...'}
                            </div>) : groups.map(({ category, items }) => (
                            <div key={category} className="space-y-1">
                                <div className="px-6 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
                                    {category}
                                </div>
                                {items.map(item => renderCommandItem(item))}
                            </div>
                        ))}
                    </div>
                </ScrollArea>


                <div data-theme-part="toolbar" className="m-3 mt-0 flex items-center gap-4 rounded-2xl border border-border/35 bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                        <kbd data-theme-part="badge" className="rounded-lg border border-border/50 bg-background/40 px-1.5 py-0.5 text-xs shadow-sm">↑↓</kbd>
                        Navigate
                    </span>
                    <span className="flex items-center gap-1">
                        <kbd data-theme-part="badge" className="rounded-lg border border-border/50 bg-background/40 px-1.5 py-0.5 text-xs shadow-sm">↵</kbd>
                        Select
                    </span>
                    <span className="flex items-center gap-1">
                        <kbd data-theme-part="badge" className="rounded-lg border border-border/50 bg-background/40 px-1.5 py-0.5 text-xs shadow-sm">Esc</kbd>
                        Close
                    </span>
                </div>
            </DialogContent>
        </Dialog>
    )
}
