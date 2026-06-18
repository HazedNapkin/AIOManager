import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAccountStore } from '@/store/accountStore'
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
} from 'lucide-react'
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useFailoverStore } from '@/store/failoverStore'
import { useUIStore } from '@/store/uiStore'
import { useNotesStore } from '@/store/notesStore'
import { useVaultStore } from '@/store/vaultStore'
import { useAddonStore } from '@/store/addonStore'

interface CommandItem {
    id: string
    label: string
    sublabel?: string
    icon: React.ReactNode
    action: () => void
    category: 'Navigation' | 'Accounts' | 'Notes' | 'Vault' | 'Saved Addons' | 'Quick Actions'
    emoji?: string
    searchText?: string
}

export function CommandPalette() {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const navigate = useNavigate()
    const accounts = useAccountStore((s) => s.accounts)
    const syncAllAccounts = useAccountStore((s) => s.syncAllAccounts)
    const checkRules = useFailoverStore((s) => s.checkRules)
    const notes = useNotesStore((s) => s.notes)
    const vaultKeys = useVaultStore((s) => s.keys)
    const savedAddonLibrary = useAddonStore((s) => s.library)

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

    const allItems = useMemo<CommandItem[]>(() => {
        const items: CommandItem[] = []

        items.push(
            {
                id: 'nav-accounts',
                label: 'Accounts',
                sublabel: 'Dashboard home - manage all accounts',
                icon: <LayoutDashboard className="h-4 w-4" />,
                action: () => go('/'),
                category: 'Navigation',
            },
            {
                id: 'nav-library',
                label: 'Saved Addons Library',
                sublabel: 'Browse and manage saved addon profiles',
                icon: <Package className="h-4 w-4" />,
                action: () => go('/saved-addons'),
                category: 'Navigation',
            },
            {
                id: 'nav-activity',
                label: 'Activity',
                sublabel: 'Unified watch history from all accounts',
                icon: <Activity className="h-4 w-4" />,
                action: () => go('/activity'),
                category: 'Navigation',
            },
            {
                id: 'nav-metrics',
                label: 'Metrics',
                sublabel: 'Stats, charts, and insights',
                icon: <BarChart3 className="h-4 w-4" />,
                action: () => go('/metrics'),
                category: 'Navigation',
            },
            {
                id: 'nav-settings',
                label: 'Settings',
                sublabel: 'Themes, sync, privacy, and preferences',
                icon: <Settings className="h-4 w-4" />,
                action: () => go('/settings'),
                category: 'Navigation',
            },
            {
                id: 'nav-vault',
                label: 'Key Vault',
                sublabel: 'Encrypted API key management',
                icon: <KeyRound className="h-4 w-4" />,
                action: () => go('/vault'),
                category: 'Navigation',
            },
            {
                id: 'nav-faq',
                label: 'Docs',
                sublabel: 'Help, guides, and troubleshooting',
                icon: <HelpCircle className="h-4 w-4" />,
                action: () => go('/kronorium'),
                category: 'Navigation',
            },
            {
                id: 'nav-notes',
                label: 'Notes',
                sublabel: 'Markdown notes and documentation',
                icon: <StickyNote className="h-4 w-4" />,
                action: () => go('/notes'),
                category: 'Navigation',
            },
            {
                id: 'nav-replay',
                label: 'Replay',
                sublabel: 'Year in review experience',
                icon: <Tv className="h-4 w-4" />,
                action: () => go('/replay'),
                category: 'Navigation',
            }
        )

        for (const acc of accounts) {
            items.push({
                id: `acc-${acc.id}`,
                label: acc.name || acc.email || 'Unnamed Account',
                emoji: acc.emoji,
                sublabel: acc.email && acc.name ? acc.email : undefined,
                icon: <User className="h-4 w-4" />,
                action: () => go(`/account/${acc.id}`),
                category: 'Accounts',
            })
        }

        for (const n of notes) {
            const sublabel = n.tags.length > 0 ? n.tags.slice(0, 3).map(t => `#${t}`).join(' ') : 'Note'
            items.push({
                id: `note-${n.id}`,
                label: n.title,
                sublabel,
                icon: <StickyNote className="h-4 w-4" />,
                action: () => go('/notes'),
                category: 'Notes',
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
            })
        }

        const savedAddonList = Object.values(savedAddonLibrary)
        for (const a of savedAddonList) {
            const tagStr = (a.tags ?? []).join(' ')
            const manifestName = a.manifest?.name ?? ''
            const installedAccounts = accounts
                .filter(acc => acc.addons?.some(addon => addon.transportUrl === a.installUrl))
                .map(acc => acc.name || acc.email || 'Unnamed')
            const accountStr = installedAccounts.length > 0 ? installedAccounts.join(', ') : 'Not installed'
            const firstAccountId = accounts.find(acc => acc.addons?.some(addon => addon.transportUrl === a.installUrl))?.id
            items.push({
                id: `addon-${a.id}`,
                label: a.name || 'Unnamed Addon',
                sublabel: accountStr,
                icon: <Bookmark className="h-4 w-4" />,
                action: () => go(firstAccountId ? `/account/${firstAccountId}` : '/saved-addons'),
                category: 'Saved Addons',
                searchText: `${manifestName} ${tagStr} ${accountStr}`,
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
            }
        )

        return items
    }, [accounts, notes, vaultKeys, savedAddonLibrary, go, syncAllAccounts, checkRules])

    const filtered = useMemo(() => {
        if (!query.trim()) return allItems
        const q = query.toLowerCase()
        return allItems.filter(
            (item) =>
                item.label.toLowerCase().includes(q) ||
                item.sublabel?.toLowerCase().includes(q) ||
                item.category.toLowerCase().includes(q) ||
                item.searchText?.toLowerCase().includes(q)
        )
    }, [allItems, query])

    const grouped = useMemo(() => {
        const groups: Record<string, CommandItem[]> = {}
        for (const item of filtered) {
            if (!groups[item.category]) groups[item.category] = []
            groups[item.category].push(item)
        }
        return groups
    }, [filtered])

    useEffect(() => {
        setSelectedIndex(0)
    }, [query])

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
            setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSelectedIndex((prev) => Math.max(prev - 1, 0))
        } else if (e.key === 'Enter' && filtered[selectedIndex]) {
            e.preventDefault()
            filtered[selectedIndex].action()
        } else if (e.key === 'Escape') {
            setOpen(false)
        }
    }

    useEffect(() => {
        const el = scrollRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
        if (el) {
            el.scrollIntoView({ block: 'nearest' })
        }
    }, [selectedIndex])

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
                className="max-w-[min(92vw,42rem)] sm:max-w-2xl p-0 gap-0 overflow-hidden rounded-[2rem] border border-border/50 bg-card/90 shadow-2xl ring-1 ring-white/5 backdrop-blur-2xl [&>button:last-child]:hidden"
                onKeyDown={handleKeyDown}
            >
                <DialogTitle className="sr-only">Command palette</DialogTitle>

                <div className="mx-3 mt-3 flex items-center gap-3 rounded-2xl border border-border/40 bg-muted/25 px-4 py-3 shadow-inner">
                    <Search className="h-4 w-4 text-muted-foreground/80 flex-shrink-0" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search pages, accounts, actions..."
                        className="h-6 w-full min-w-0 flex-1 border-0 bg-transparent p-0 text-base font-medium text-foreground outline-none placeholder:text-muted-foreground/55 focus:ring-0 sm:text-sm"
                    />
                    <button
                        onClick={() => setOpen(false)}
                        className="hidden sm:inline-flex items-center gap-0.5 rounded-lg border border-border/50 bg-background/40 px-2 py-1 text-[11px] font-mono text-muted-foreground shadow-sm transition-colors hover:bg-muted/60 hover:text-foreground"
                    >
                        Esc
                    </button>
                </div>


                <ScrollArea className="max-h-[min(54vh,440px)]" ref={scrollRef}>
                    <div className="py-3">
                        {filtered.length === 0 && (
                            <div className="mx-3 rounded-2xl border border-dashed border-border/40 bg-muted/15 px-4 py-10 text-center text-sm text-muted-foreground">
                                No results found for "{query}"
                            </div>
                        )}

                        {Object.entries(grouped).map(([category, items]) => (
                            <div key={category} className="space-y-1">
                                <div className="px-6 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
                                    {category}
                                </div>
                                {items.map((item) => {
                                    const flatIndex = filtered.indexOf(item)
                                    const isSelected = flatIndex === selectedIndex

                                    return (
                                        <button
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
                                            <span
                                                className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition-colors ${isSelected ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted/45 text-muted-foreground'}`}
                                            >
                                                {item.icon}
                                            </span>
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
                                })}
                            </div>
                        ))}
                    </div>
                </ScrollArea>


                <div className="m-3 mt-0 flex items-center gap-4 rounded-2xl border border-border/35 bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                        <kbd className="rounded-lg border border-border/50 bg-background/40 px-1.5 py-0.5 text-xs shadow-sm">↑↓</kbd>
                        Navigate
                    </span>
                    <span className="flex items-center gap-1">
                        <kbd className="rounded-lg border border-border/50 bg-background/40 px-1.5 py-0.5 text-xs shadow-sm">↵</kbd>
                        Select
                    </span>
                    <span className="flex items-center gap-1">
                        <kbd className="rounded-lg border border-border/50 bg-background/40 px-1.5 py-0.5 text-xs shadow-sm">Esc</kbd>
                        Close
                    </span>
                </div>
            </DialogContent>
        </Dialog>
    )
}
