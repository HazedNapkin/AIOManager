import { useState, useEffect, useMemo, useRef } from 'react'
import { useVaultStore } from '@/store/vaultStore'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import {
    Eye, EyeOff, ExternalLink, Info, KeyRound, Search, X, ChevronLeft, ChevronRight,
    Cloud, Layers, Cable, Database, Magnet, Type, Activity, Sparkles, ShieldCheck, Wrench,
} from 'lucide-react'
import { deriveGroup, resolveVaultGroup, VAULT_GROUPS } from '@/lib/constants'
import { PROVIDER_REGISTRY, registryForKey, RegistryProvider } from '@/lib/provider-registry'
import { toast } from '@/hooks/use-toast'
import { VaultKey } from '@/types/vault'

interface VaultKeyDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    editingKey?: VaultKey | null
    /** When adding from a group filter, pre-scopes the picker search to that group. */
    defaultGroup?: string
}

function entryAbbr(p: RegistryProvider) {
    return p.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '··'
}

const CATEGORY_ICONS: Record<string, typeof Cloud> = {
    'Debrid Services': Cloud,
    'AIOStreams': Layers,
    'Usenet Providers': Cable,
    'Usenet Indexers': Database,
    'Torrent Indexers': Magnet,
    'Subtitles': Type,
    'Metadata & Trackers': Activity,
    'AI Services': Sparkles,
    'VPN': ShieldCheck,
    'Custom': Wrench,
}

// Mirrors VaultPage's group colors so the picker speaks the same category language as the vault.
const CATEGORY_COLOR: Record<string, { text: string; bg: string }> = {
    'Debrid Services': { text: 'text-primary', bg: 'bg-primary/12' },
    'AIOStreams': { text: 'text-info', bg: 'bg-info/10' },
    'Usenet Providers': { text: 'text-info', bg: 'bg-info/10' },
    'Usenet Indexers': { text: 'text-success', bg: 'bg-success/10' },
    'Torrent Indexers': { text: 'text-success', bg: 'bg-success/10' },
    'Subtitles': { text: 'text-warning', bg: 'bg-warning/10' },
    'Metadata & Trackers': { text: 'text-warning', bg: 'bg-warning/10' },
    'AI Services': { text: 'text-info', bg: 'bg-info/10' },
    'VPN': { text: 'text-primary', bg: 'bg-primary/12' },
    'Custom': { text: 'text-muted-foreground', bg: 'bg-muted/30' },
}

function tint(group: string) {
    return CATEGORY_COLOR[group] || CATEGORY_COLOR.Custom
}

function ProviderButton({ p, onSelect }: { p: RegistryProvider; onSelect: (p: RegistryProvider) => void }) {
    const c = tint(p.group)
    return (
        <button
            type="button"
            onClick={() => onSelect(p)}
            className="flex items-center gap-3 rounded-xl border border-border/40 bg-muted/10 px-3 py-3 text-left transition-colors hover:border-border/70 hover:bg-muted/25"
        >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/40 text-xs font-bold ${c.bg} ${c.text}`}>
                {entryAbbr(p)}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
        </button>
    )
}

export function VaultKeyDialog({ open, onOpenChange, editingKey, defaultGroup }: VaultKeyDialogProps) {
    const addKey = useVaultStore(s => s.addKey)
    const updateKey = useVaultStore(s => s.updateKey)
    const loading = useVaultStore(s => s.loading)

    const [selected, setSelected] = useState<RegistryProvider | null>(null)
    const [providerSearch, setProviderSearch] = useState('')
    const [pickerCategory, setPickerCategory] = useState<string | null>(null)
    const [name, setName] = useState('')
    const [value, setValue] = useState('')
    const [customExpiry, setCustomExpiry] = useState('')
    const [customAbbr, setCustomAbbr] = useState('')
    const [customDashboardUrl, setCustomDashboardUrl] = useState('')
    const [customProviderName, setCustomProviderName] = useState('')
    const [group, setGroup] = useState('')
    const [showKeyValue, setShowKeyValue] = useState(false)
    const searchRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (!open) return
        setShowKeyValue(false)
        setProviderSearch('')
        if (editingKey) {
            setPickerCategory(null)
            const entry = registryForKey(editingKey)
            setSelected(entry)
            setName(editingKey.name)
            setValue(editingKey.value)
            setCustomExpiry(editingKey.customExpiry || '')
            setCustomAbbr(editingKey.customAbbr || '')
            setCustomDashboardUrl(editingKey.customDashboardUrl || '')
            setCustomProviderName(editingKey.customProviderName || '')
            setGroup(resolveVaultGroup(editingKey.provider, editingKey.group))
        } else {
            setSelected(null)
            setPickerCategory(defaultGroup ?? null)
            setName('')
            setValue('')
            setCustomExpiry('')
            setCustomAbbr('')
            setCustomDashboardUrl('')
            setCustomProviderName('')
            setGroup('')
        }
    }, [open, editingKey, defaultGroup])

    const handleSelect = (entry: RegistryProvider) => {
        setSelected(entry)
        setGroup(entry.group)
        setCustomDashboardUrl(entry.credentialUrl || '')
        // Catalog "other" entries carry their own display name; custom entries are user-named.
        setCustomProviderName(entry.vaultProvider === 'other' && entry.id !== 'custom' ? entry.name : '')
    }

    const GROUP_ORDER = ['AIOStreams', ...VAULT_GROUPS]

    // Search results, flattened across every category so a known name skips the drill-in.
    const searchResults = useMemo(() => {
        const q = providerSearch.trim().toLowerCase()
        if (!q) return []
        const byGroup = new Map<string, RegistryProvider[]>()
        for (const p of PROVIDER_REGISTRY) {
            if (!(p.name.toLowerCase().includes(q) || p.group.toLowerCase().includes(q))) continue
            if (!byGroup.has(p.group)) byGroup.set(p.group, [])
            byGroup.get(p.group)!.push(p)
        }
        return [...byGroup.entries()].sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]))
    }, [providerSearch])

    // Category landing: one tile per non-empty group, in canonical order.
    const categories = useMemo(() => {
        const counts = new Map<string, number>()
        for (const p of PROVIDER_REGISTRY) counts.set(p.group, (counts.get(p.group) || 0) + 1)
        return GROUP_ORDER
            .filter((g, i) => GROUP_ORDER.indexOf(g) === i && counts.has(g))
            .map((g) => ({ group: g, count: counts.get(g)! }))
    }, [])

    const categoryEntries = useMemo(
        () => (pickerCategory ? PROVIDER_REGISTRY.filter((p) => p.group === pickerCategory) : []),
        [pickerCategory]
    )

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!selected) return
        const provider = selected.vaultProvider
        try {
            const resolvedGroup = resolveVaultGroup(provider, group)
            const extra = {
                ...(provider === 'other' ? {
                    customExpiry: customExpiry || undefined,
                    customDashboardUrl: customDashboardUrl || undefined,
                    customProviderName: (selected.id === 'custom' ? customProviderName : selected.name) || undefined,
                } : {}),
                customAbbr: customAbbr || undefined,
                group: resolvedGroup === deriveGroup(provider) ? undefined : resolvedGroup,
                catalogId: selected.id === 'custom' ? undefined : selected.id,
            }

            if (editingKey) {
                await updateKey(editingKey.id, { name, provider, value, ...extra })
                toast({ title: 'Key Updated', description: `${name} has been updated in your vault.` })
            } else {
                await addKey({ name, provider, value, ...extra })
                toast({ title: 'Key Added', description: `${name} has been added to your secure vault.` })
            }
            onOpenChange(false)
        } catch {
            toast({
                variant: 'destructive',
                title: 'Vault Error',
                description: 'Failed to save key. Ensure your vault is unlocked.'
            })
        }
    }

    const showPicker = !selected
    const isCustom = selected?.id === 'custom'
    const isOther = selected?.vaultProvider === 'other'

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/40 bg-muted/30 text-muted-foreground">
                            <KeyRound className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 space-y-0.5 text-left">
                            <DialogTitle>{editingKey ? 'Edit key' : showPicker ? 'Choose a provider' : 'Add key'}</DialogTitle>
                            <DialogDescription className="text-xs">
                                {showPicker
                                    ? 'Pick a provider to store its credentials in your encrypted vault.'
                                    : 'Save the credential in your vault.'}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                {showPicker ? (
                    <div className="space-y-4 py-1">
                        <div className="flex h-9 items-center gap-2 rounded-lg border border-border/40 bg-muted/30 px-2.5 transition-colors focus-within:border-border">
                            <Search className="h-3.5 w-3.5 text-muted-foreground" />
                            <input
                                ref={searchRef}
                                value={providerSearch}
                                onChange={(e) => setProviderSearch(e.target.value)}
                                placeholder="Search all providers..."
                                autoFocus
                                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                            />
                            {providerSearch && (
                                <button type="button" onClick={() => setProviderSearch('')} className="text-muted-foreground hover:text-foreground" aria-label="Clear search">
                                    <X className="h-3 w-3" />
                                </button>
                            )}
                        </div>

                        {pickerCategory && !providerSearch && (
                            <button
                                type="button"
                                onClick={() => setPickerCategory(null)}
                                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                            >
                                <ChevronLeft className="h-3.5 w-3.5" /> All categories
                            </button>
                        )}

                        <div className="max-h-[440px] space-y-5 overflow-y-auto pr-1">
                            {providerSearch ? (
                                searchResults.length === 0 ? (
                                    <p className="py-10 text-center text-xs text-muted-foreground">No providers match your search.</p>
                                ) : (
                                    searchResults.map(([groupName, entries]) => (
                                        <div key={groupName} className="space-y-1.5">
                                            <div className="px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                                {groupName}
                                            </div>
                                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                {entries.map((p) => (
                                                    <ProviderButton key={p.id} p={p} onSelect={handleSelect} />
                                                ))}
                                            </div>
                                        </div>
                                    ))
                                )
                            ) : pickerCategory ? (
                                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                                    {categoryEntries.map((p) => (
                                        <ProviderButton key={p.id} p={p} onSelect={handleSelect} />
                                    ))}
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2.5">
                                    {categories.map(({ group, count }) => {
                                        const Icon = CATEGORY_ICONS[group] || Wrench
                                        const c = tint(group)
                                        return (
                                            <button
                                                key={group}
                                                type="button"
                                                onClick={() => setPickerCategory(group)}
                                                className="flex items-center gap-3 rounded-xl border border-border/40 bg-muted/10 px-3 py-3.5 text-left transition-colors hover:border-border/70 hover:bg-muted/25"
                                            >
                                                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/40 ${c.bg} ${c.text}`}>
                                                    <Icon className="h-[18px] w-[18px]" />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm font-medium">{group}</span>
                                                    <span className="block text-xs text-muted-foreground">{count} {count === 1 ? 'provider' : 'providers'}</span>
                                                </span>
                                                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4 py-1">
                        <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-muted/20 p-3">
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/40 text-xs font-bold ${tint(selected.group).bg} ${tint(selected.group).text}`}>
                                {entryAbbr(selected)}
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold">{selected.name}</div>
                                <div className="truncate text-xs text-muted-foreground">{selected.group}</div>
                            </div>
                            {!editingKey && (
                                <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => setSelected(null)}>
                                    Change
                                </Button>
                            )}
                        </div>

                        {selected.description && (
                            <div className="flex gap-3 rounded-xl border border-border/40 bg-muted/25 p-3 text-xs leading-relaxed text-muted-foreground">
                                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                                <p>{selected.description}</p>
                            </div>
                        )}

                        {selected.setup && (
                            <div className="space-y-2 rounded-xl border border-border/40 bg-muted/15 p-3">
                                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                    How to get your {selected.credentialLabel.toLowerCase()}
                                </div>
                                {selected.setup.intro && (
                                    <p className="text-xs leading-relaxed text-muted-foreground">{selected.setup.intro}</p>
                                )}
                                <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground/90 marker:text-muted-foreground/50">
                                    {selected.setup.steps.map((step, i) => (
                                        <li key={i}>{step}</li>
                                    ))}
                                </ol>
                                {selected.setup.note && (
                                    <p className="text-[11px] italic text-muted-foreground/70">{selected.setup.note}</p>
                                )}
                            </div>
                        )}

                        {isCustom && (
                            <div className="space-y-2">
                                <Label htmlFor="v-custom-provider-name">Provider Name</Label>
                                <Input
                                    id="v-custom-provider-name"
                                    placeholder="e.g. UsenetServer, NZBgeek"
                                    value={customProviderName}
                                    onChange={(e) => setCustomProviderName(e.target.value)}
                                />
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="v-name">Display name</Label>
                            <Input
                                id="v-name"
                                placeholder={`e.g. My ${selected.name} Account`}
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                                autoFocus
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="v-value">{selected.credentialLabel}</Label>
                                {selected.credentialUrl && (
                                    <a
                                        href={selected.credentialUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                                    >
                                        Get credential <ExternalLink className="h-2.5 w-2.5" />
                                    </a>
                                )}
                            </div>
                            <div className="relative">
                                <Input
                                    id="v-value"
                                    type={showKeyValue ? 'text' : 'password'}
                                    placeholder={selected.placeholder || 'Paste your key here'}
                                    value={value}
                                    onChange={(e) => setValue(e.target.value)}
                                    required
                                    className="pr-9 font-mono text-sm"
                                />
                                <Tooltip content={showKeyValue ? 'Hide value' : 'Show value'} side="top">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground hover:text-primary"
                                        onClick={() => setShowKeyValue(v => !v)}
                                        aria-label={showKeyValue ? 'Hide value' : 'Show value'}
                                    >
                                        {showKeyValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                    </Button>
                                </Tooltip>
                            </div>
                            {selected.composite && (
                                <p className="text-xs text-muted-foreground">
                                    Enter combined credentials as a single value{selected.placeholder ? ` (e.g. ${selected.placeholder})` : ''}.
                                </p>
                            )}
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="v-group">Group</Label>
                                <Select value={resolveVaultGroup(selected.vaultProvider, group)} onValueChange={setGroup}>
                                    <SelectTrigger id="v-group">
                                        <SelectValue placeholder={deriveGroup(selected.vaultProvider)} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {VAULT_GROUPS.map(g => (
                                            <SelectItem key={g} value={g}>{g}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="v-custom-abbr">Header badge</Label>
                                <Input
                                    id="v-custom-abbr"
                                    placeholder={entryAbbr(selected)}
                                    maxLength={3}
                                    value={customAbbr}
                                    onChange={(e) => setCustomAbbr(e.target.value.toUpperCase())}
                                    className="font-bold placeholder:normal-case"
                                />
                            </div>
                        </div>

                        {isOther && (
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="v-custom-expiry">Auto Expiry Check</Label>
                                    <Input
                                        id="v-custom-expiry"
                                        type="text"
                                        placeholder="MM/DD/YYYY"
                                        value={customExpiry
                                            ? (() => {
                                                const [y, m, d] = customExpiry.split('-')
                                                return y && m && d ? `${m}/${d}/${y}` : customExpiry
                                            })()
                                            : ''}
                                        onChange={(e) => {
                                            const val = e.target.value
                                            const match = val.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
                                            if (match) {
                                                setCustomExpiry(`${match[3]}-${match[1]}-${match[2]}`)
                                            } else {
                                                setCustomExpiry(val)
                                            }
                                        }}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="v-custom-dashboard">Dashboard URL</Label>
                                    <Input
                                        id="v-custom-dashboard"
                                        type="url"
                                        placeholder="https://provider.com/account"
                                        value={customDashboardUrl}
                                        onChange={(e) => setCustomDashboardUrl(e.target.value)}
                                    />
                                </div>
                            </div>
                        )}

                        <DialogFooter>
                            <Button type="button" variant="subtle" onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={loading}>
                                {editingKey ? 'Update key' : 'Add key'}
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    )
}
