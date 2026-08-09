import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GripVertical, ChevronUp, ChevronDown, X, LayoutGrid, SlidersHorizontal, RotateCcw, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
    useCatalogs,
    useRailSize,
    setCatalogEnabled,
    moveCatalog,
    setRailSize,
    setAccountRailSize,
    CATALOG_LABELS,
} from '@/lib/discovery-prefs-store'
import { useAccountStore } from '@/store/accountStore'
import { useDiscoveryStore, useDiscoveryPrefs, useHouseholdSettings, HOUSEHOLD_CONTEXT } from '@/store/discoveryStore'
import {
    listCustomCatalogs,
    createCustomCatalog,
    deleteCustomCatalog,
    type CustomCatalog,
} from '@/lib/catalog-sync'

const SHELF_SIZE_OPTIONS = [10, 20, 30, 40, 50, 75, 100]
const DEFAULT_RAIL_SIZE = 20

const COMMON_GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 'Thriller', 'War', 'Western']

const OBSCURITY_OPTIONS: { value: 'popular' | 'balanced' | 'hidden' | 'gems' | 'all'; label: string; desc: string }[] = [
    { value: 'popular', label: 'Popular', desc: 'Blockbusters and crowd-pleasers' },
    { value: 'balanced', label: 'Balanced', desc: 'Mix of mainstream and niche' },
    { value: 'hidden', label: 'Hidden Gems', desc: 'Under-the-radar discoveries' },
    { value: 'gems', label: 'Deep Cuts', desc: 'Truly obscure finds' },
    { value: 'all', label: 'Everything', desc: 'No obscurity filter' },
]

const TYPE_OPTIONS: { value: 'both' | 'movies' | 'series'; label: string }[] = [
    { value: 'both', label: 'Both' },
    { value: 'movies', label: 'Movies' },
    { value: 'series', label: 'Series' },
]

const MERGE_OPTIONS: { value: 'union' | 'intersection'; label: string; desc: string }[] = [
    { value: 'union', label: 'Union', desc: 'Combine all tastes broadly' },
    { value: 'intersection', label: 'Intersection', desc: 'Only shared tastes' },
]

const DECADES = [
    { label: '1990s', from: 1990, to: 1999 },
    { label: '2000s', from: 2000, to: 2009 },
    { label: '2010s', from: 2010, to: 2019 },
    { label: '2020s', from: 2020, to: 2029 },
]

const EMPTY_FORM = {
    name: '',
    type: 'movie',
    genres: [] as string[],
    minRating: 'none',
    eraStart: '',
    eraEnd: '',
    obscurity: 'any',
}

function summarizeCatalogFilters(filters: Record<string, unknown>): string {
    if (!filters || typeof filters !== 'object') return 'No filters'
    const parts: string[] = []
    if (filters.genres) parts.push(String(filters.genres))
    if (typeof filters.minRating === 'number') parts.push(`Rating ≥ ${filters.minRating}`)
    const era: string[] = []
    if (typeof filters.eraStart === 'number') era.push(String(filters.eraStart))
    if (typeof filters.eraEnd === 'number') era.push(String(filters.eraEnd))
    if (era.length === 2) parts.push(`${era[0]}-${era[1]}`)
    else if (era.length === 1) parts.push(`${era[0]}+`)
    if (typeof filters.obscurity === 'string' && filters.obscurity) {
        parts.push(filters.obscurity.charAt(0).toUpperCase() + filters.obscurity.slice(1))
    }
    return parts.length > 0 ? parts.join(' · ') : 'No filters'
}

interface DiscoveryPreferencesModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    accountId?: string
}

export function DiscoveryPreferencesModal({ open, onOpenChange, accountId }: DiscoveryPreferencesModalProps) {
    const catalogs = useCatalogs(accountId)
    const isAccountMode = Boolean(accountId)
    const globalSize = useRailSize()
    const accountSize = useRailSize(accountId)
    const hasOverride = isAccountMode && accountSize !== globalSize
    const activeSize = isAccountMode ? accountSize : globalSize
    const accounts = useAccountStore(s => s.accounts)
    const accountName = (() => {
        if (!accountId) return ''
        const acc = accounts.find(a => a.id === accountId)
        return acc?.name || acc?.email?.split('@')[0] || 'Account'
    })()

    const ctx = accountId || HOUSEHOLD_CONTEXT
    const _prefs = useDiscoveryPrefs(ctx)
    const _store = useDiscoveryStore()
    const _household = useHouseholdSettings()
    const discoveryPrefs = {
        ..._prefs,
        enabledAccounts: _household.enabledAccounts,
        mergeMode: _household.mergeMode,
        setObscurity: (v: typeof _prefs.obscurity) => _store.setObscurity(ctx, v),
        setMinRating: (v: number) => _store.setMinRating(ctx, v),
        setEraRange: (from: number, to: number) => _store.setEraRange(ctx, from, to),
        setTypeMix: (v: typeof _prefs.typeMix) => _store.setTypeMix(ctx, v),
        setGenreBoost: (genre: string, mult: number) => _store.setGenreBoost(ctx, genre, mult),
        removeGenreBoost: (genre: string) => _store.removeGenreBoost(ctx, genre),
        toggleExcludedGenre: (genre: string) => _store.toggleExcludedGenre(ctx, genre),
        dismissItem: (id: string) => _store.dismissItem(ctx, id),
        undismissItem: (id: string) => _store.undismissItem(ctx, id),
        loveItem: (id: string) => _store.loveItem(ctx, id),
        unloveItem: (id: string) => _store.unloveItem(ctx, id),
        resetToDefaults: () => _store.resetContext(ctx),
        setEnabledAccounts: _store.setEnabledAccounts,
        setMergeMode: _store.setMergeMode,
    }
    const activeDecade = DECADES.find(d => d.from === discoveryPrefs.eraRange.from && d.to === discoveryPrefs.eraRange.to)

    const genreState = (genre: string): 'default' | 'boost' | 'strong' | 'suppress' | 'excluded' => {
        if (discoveryPrefs.excludedGenres.includes(genre)) return 'excluded'
        const mult = discoveryPrefs.genreBoosts[genre]
        if (!mult) return 'default'
        if (mult >= 2) return 'strong'
        if (mult > 1) return 'boost'
        return 'suppress'
    }

    const cycleGenre = (genre: string) => {
        const state = genreState(genre)
        if (state === 'default') {
            discoveryPrefs.setGenreBoost(genre, 1.5)
        } else if (state === 'boost') {
            discoveryPrefs.setGenreBoost(genre, 2.0)
        } else if (state === 'strong') {
            discoveryPrefs.setGenreBoost(genre, 0.3)
        } else if (state === 'suppress') {
            discoveryPrefs.removeGenreBoost(genre)
            discoveryPrefs.toggleExcludedGenre(genre)
        } else {
            discoveryPrefs.toggleExcludedGenre(genre)
        }
    }

    const handleResetAll = () => {
        discoveryPrefs.resetToDefaults()
        setRailSize(DEFAULT_RAIL_SIZE)
    }

    const [customCatalogs, setCustomCatalogs] = useState<CustomCatalog[]>([])
    const [showCreateForm, setShowCreateForm] = useState(false)
    const [creating, setCreating] = useState(false)
    const [form, setForm] = useState(EMPTY_FORM)

    useEffect(() => {
        if (!open) return
        let cancelled = false
        listCustomCatalogs().then(list => {
            if (cancelled) return
            setCustomCatalogs(list)
            if (import.meta.env.DEV) console.log('[CustomCatalogs] loaded:', list.length, list.map(c => c.name))
        }).catch(err => {
            if (import.meta.env.DEV) console.error('[CustomCatalogs] fetch failed:', err)
        })
        return () => { cancelled = true }
    }, [open])

    const refreshCatalogs = () => {
        listCustomCatalogs().then(setCustomCatalogs)
    }

    const handleCreate = async () => {
        if (!form.name.trim() || creating) return
        const filters: Record<string, unknown> = {}
        if (form.genres.length > 0) filters.genres = form.genres.join(', ')
        if (form.minRating !== 'none') filters.minRating = Number(form.minRating)
        if (form.eraStart.trim()) filters.eraStart = Number(form.eraStart)
        if (form.eraEnd.trim()) filters.eraEnd = Number(form.eraEnd)
        if (form.obscurity !== 'any') filters.obscurity = form.obscurity
        setCreating(true)
        try {
            await createCustomCatalog(form.name.trim(), form.type, filters)
            setForm(EMPTY_FORM)
            setShowCreateForm(false)
            refreshCatalogs()
        } catch {
        } finally {
            setCreating(false)
        }
    }

    const handleDelete = async (id: string) => {
        const ok = await deleteCustomCatalog(id)
        if (!ok) {
            toast({ variant: 'destructive', title: 'Failed to delete catalog' })
            return
        }
        toast({ title: 'Catalog deleted' })
        refreshCatalogs()
    }

    const applySize = (size: number) => {
        if (isAccountMode && accountId) setAccountRailSize(accountId, size)
        else setRailSize(size)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn(
                    '!gap-0 !p-0 flex flex-col overflow-hidden',
                    '!max-w-3xl !max-h-[88vh]',
                    'shadow-[0_24px_64px_hsl(0_0%_0%/0.45)]',
                )}
                hideClose
            >
                <DialogTitle className="sr-only">Discovery Preferences</DialogTitle>

                <div className="flex items-start justify-between gap-4 border-b border-border/40 bg-gradient-to-br from-card to-card/60 px-5 py-5 sm:px-7">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/40 bg-muted/40 text-primary">
                                <LayoutGrid className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                                <h2 className="text-base font-bold leading-tight tracking-tight text-foreground">
                                    Discovery Preferences
                                </h2>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                    {isAccountMode
                                        ? <>Managing: <span className="font-semibold text-foreground/90">{accountName}</span></>
                                        : <>Managing: <span className="font-semibold text-foreground/90">Unified Catalog</span></>}
                                </p>
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        aria-label="Close"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/40 bg-muted/30 text-muted-foreground transition-all hover:bg-muted/60 hover:text-foreground active:scale-95"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="space-y-7 overflow-y-auto px-5 py-6 sm:px-7">
                    <section className="space-y-4">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Your Catalogs
                                </h3>
                                <p className="mt-1 text-xs text-muted-foreground/70">
                                    {isAccountMode
                                        ? <>Managing: <span className="font-semibold text-foreground/80">{accountName}</span></>
                                        : <>Managing: <span className="font-semibold text-foreground/80">Unified Catalog</span></>}
                                </p>
                            </div>
                            <span className="shrink-0 rounded-full border border-border/40 bg-muted/30 px-2.5 py-0.5 text-xs font-bold tabular-nums text-foreground">
                                {activeSize}
                            </span>
                        </div>

                        <div className="rounded-2xl border border-border/40 bg-muted/15 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Shelf Size
                                </span>
                                <span className="text-[11px] text-muted-foreground/70">items per row</span>
                            </div>
                            <div className="grid grid-cols-5 gap-1.5">
                                {SHELF_SIZE_OPTIONS.map(size => (
                                    <button
                                        key={size}
                                        type="button"
                                        onClick={() => applySize(size)}
                                        className={cn(
                                            'rounded-lg border py-2 text-sm font-semibold tabular-nums transition-colors',
                                            activeSize === size
                                                ? 'border-primary/50 bg-primary/10 text-primary'
                                                : 'border-border/40 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                                        )}
                                    >
                                        {size}
                                    </button>
                                ))}
                            </div>
                            {isAccountMode && (
                                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
                                    <SlidersHorizontal className="h-3 w-3 shrink-0" />
                                    {hasOverride
                                        ? `Override for ${accountName} (${accountSize}). Global default is ${globalSize}.`
                                        : `Using global default of ${globalSize} for ${accountName}.`}
                                </p>
                            )}
                        </div>

                        <div className="border-t border-border/30" />

                        <div className="space-y-1.5">
                            {catalogs.map((cat, idx) => {
                                const label = CATALOG_LABELS[cat.id] ?? cat.id
                                const above = catalogs[idx - 1]
                                const below = catalogs[idx + 1]
                                const canMoveUp = !cat.locked && idx > 0 && !above?.locked
                                const canMoveDown = !cat.locked && idx < catalogs.length - 1 && !below?.locked
                                return (
                                    <div
                                        key={cat.id}
                                        className={cn(
                                            'flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                                            cat.locked
                                                ? 'border-border/30 bg-muted/15'
                                                : cat.enabled
                                                    ? 'border-border/40 bg-muted/25'
                                                    : 'border-border/25 bg-muted/10 opacity-70',
                                        )}
                                    >
                                        <div className="flex w-5 shrink-0 justify-center">
                                            {cat.locked ? (
                                                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                                            ) : (
                                                <GripVertical className="h-4 w-4 text-muted-foreground/40" />
                                            )}
                                        </div>
                                        <span className={cn(
                                            'flex-1 truncate text-sm',
                                            cat.enabled ? 'font-medium text-foreground' : 'text-muted-foreground',
                                        )}>
                                            {label}
                                        </span>
                                        {cat.locked ? (
                                            <span className="shrink-0 rounded-full border border-border/40 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                                                Always On
                                            </span>
                                        ) : (
                                            <>
                                                <div className="flex shrink-0 items-center gap-0.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => moveCatalog(cat.id, 'up')}
                                                        disabled={!canMoveUp}
                                                        aria-label={`Move ${label} up`}
                                                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                                                    >
                                                        <ChevronUp className="h-3.5 w-3.5" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => moveCatalog(cat.id, 'down')}
                                                        disabled={!canMoveDown}
                                                        aria-label={`Move ${label} down`}
                                                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                                                    >
                                                        <ChevronDown className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                                <Switch
                                                    checked={cat.enabled}
                                                    onCheckedChange={(v) => setCatalogEnabled(cat.id, v, accountId)}
                                                    aria-label={`Toggle ${label}`}
                                                />
                                            </>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </section>

                    <div className="border-t border-border/30" />

                    <section className="space-y-4">
                        <div>
                            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Content Mix
                            </h3>
                            <p className="mt-1 text-xs text-muted-foreground/70">
                                Tune what kind of content surfaces in your recommendations
                            </p>
                        </div>

                        <div className="space-y-2">
                            <span className="text-xs font-medium text-muted-foreground">Obscurity</span>
                            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                                {OBSCURITY_OPTIONS.map(opt => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => discoveryPrefs.setObscurity(opt.value)}
                                        className={cn(
                                            'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                                            discoveryPrefs.obscurity === opt.value
                                                ? 'border-primary/50 bg-primary/10 text-foreground'
                                                : 'border-border/40 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                                        )}
                                    >
                                        <span className="block font-semibold">{opt.label}</span>
                                        <span className="mt-0.5 block text-[10px] text-muted-foreground/70">{opt.desc}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <span className="text-xs font-medium text-muted-foreground">Content Type</span>
                            <div className="flex gap-1.5">
                                {TYPE_OPTIONS.map(opt => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => discoveryPrefs.setTypeMix(opt.value)}
                                        className={cn(
                                            'flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                                            discoveryPrefs.typeMix === opt.value
                                                ? 'border-primary/50 bg-primary/10 text-primary'
                                                : 'border-border/40 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                                        )}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-muted-foreground">Minimum Rating</span>
                                <span className="rounded-full border border-border/40 bg-muted/30 px-2 py-0.5 text-[11px] font-bold tabular-nums text-foreground">
                                    {discoveryPrefs.minRating.toFixed(1)}+
                                </span>
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={10}
                                step={0.5}
                                value={discoveryPrefs.minRating}
                                onChange={(e) => discoveryPrefs.setMinRating(parseFloat(e.target.value))}
                                className="w-full accent-primary"
                            />
                        </div>

                        <div className="space-y-2">
                            <span className="text-xs font-medium text-muted-foreground">Era</span>
                            <div className="flex flex-wrap gap-1">
                                <button
                                    type="button"
                                    onClick={() => discoveryPrefs.setEraRange(1990, new Date().getFullYear())}
                                    className={cn(
                                        'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                                        !activeDecade
                                            ? 'border-primary/50 bg-primary/10 text-primary'
                                            : 'border-border/40 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                                    )}
                                >
                                    All eras
                                </button>
                                {DECADES.map(d => (
                                    <button
                                        key={d.label}
                                        type="button"
                                        onClick={() => discoveryPrefs.setEraRange(d.from, d.to)}
                                        className={cn(
                                            'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                                            activeDecade?.label === d.label
                                                ? 'border-primary/50 bg-primary/10 text-primary'
                                                : 'border-border/40 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                                        )}
                                    >
                                        {d.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </section>

                    <div className="border-t border-border/30" />

                    <section className="space-y-3">
                        <div>
                            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Genre Preferences
                            </h3>
                            <p className="mt-1 text-xs text-muted-foreground/70">
                                Tap to cycle: Boost 1.5x, Strong 2x, Suppress 0.3x, Exclude
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {COMMON_GENRES.map(genre => {
                                const state = genreState(genre)
                                const mult = discoveryPrefs.genreBoosts[genre]
                                return (
                                    <button
                                        key={genre}
                                        type="button"
                                        onClick={() => cycleGenre(genre)}
                                        className={cn(
                                            'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                                            state === 'default' && 'border-border/40 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                                            state === 'boost' && 'border-success/40 bg-success/10 text-success',
                                            state === 'strong' && 'border-success/60 bg-success/20 text-success font-bold',
                                            state === 'suppress' && 'border-warning/40 bg-warning/10 text-warning',
                                            state === 'excluded' && 'border-destructive/40 bg-destructive/10 text-destructive line-through',
                                        )}
                                    >
                                        {state === 'excluded' || !mult ? genre : `${genre} \u00d7${mult.toFixed(1)}`}
                                    </button>
                                )
                            })}
                        </div>
                    </section>

                    {accounts.length > 1 && !accountId && (
                        <>
                            <div className="border-t border-border/30" />
                            <section className="space-y-3">
                                <div>
                                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                        Accounts
                                    </h3>
                                    <p className="mt-1 text-xs text-muted-foreground/70">
                                        Which accounts contribute to recommendations
                                    </p>
                                </div>
                                <div className="space-y-1.5">
                                    <button
                                        type="button"
                                        onClick={() => discoveryPrefs.setEnabledAccounts('all')}
                                        className={cn(
                                            'flex w-full items-center justify-between rounded-xl border px-3 py-2 text-xs transition-colors',
                                            discoveryPrefs.enabledAccounts === 'all'
                                                ? 'border-primary/50 bg-primary/10'
                                                : 'border-border/40 bg-muted/20 hover:bg-muted/40',
                                        )}
                                    >
                                        <span className="font-medium text-foreground">All accounts</span>
                                        <span className="text-muted-foreground">{accounts.length}</span>
                                    </button>
                                    {accounts.map(acc => {
                                        const enabled = discoveryPrefs.enabledAccounts === 'all' || (Array.isArray(discoveryPrefs.enabledAccounts) && discoveryPrefs.enabledAccounts.includes(acc.id))
                                        return (
                                            <button
                                                key={acc.id}
                                                type="button"
                                                onClick={() => {
                                                    if (discoveryPrefs.enabledAccounts === 'all') {
                                                        discoveryPrefs.setEnabledAccounts(accounts.filter(a => a.id !== acc.id).map(a => a.id))
                                                    } else if (Array.isArray(discoveryPrefs.enabledAccounts)) {
                                                        discoveryPrefs.setEnabledAccounts(enabled ? discoveryPrefs.enabledAccounts.filter(id => id !== acc.id) : [...discoveryPrefs.enabledAccounts, acc.id])
                                                    }
                                                }}
                                                className={cn(
                                                    'flex w-full items-center justify-between rounded-xl border px-3 py-2 text-xs transition-colors',
                                                    enabled ? 'border-border/40 bg-muted/20' : 'border-border/25 opacity-50',
                                                )}
                                            >
                                                <span className="font-medium text-foreground">{acc.name || acc.email?.split('@')[0] || acc.id}</span>
                                                <span className={cn('h-2 w-2 rounded-full', enabled ? 'bg-success' : 'bg-muted-foreground/30')} />
                                            </button>
                                        )
                                    })}
                                </div>
                                <div className="flex gap-1.5">
                                    {MERGE_OPTIONS.map(opt => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => discoveryPrefs.setMergeMode(opt.value)}
                                            className={cn(
                                                'flex-1 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors',
                                                discoveryPrefs.mergeMode === opt.value
                                                    ? 'border-primary/50 bg-primary/10'
                                                    : 'border-border/40 bg-muted/20 hover:bg-muted/40',
                                            )}
                                        >
                                            <span className="block font-medium text-foreground">{opt.label}</span>
                                            <span className="mt-0.5 block text-[10px] text-muted-foreground/70">{opt.desc}</span>
                                        </button>
                                    ))}
                                </div>
                            </section>
                        </>
                    )}

                    {!accountId && (
                    <>
                    <div className="border-t border-border/30" />

                    <section className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Custom Catalogs
                                </h3>
                                <p className="mt-1 text-xs text-muted-foreground/70">
                                    Discovery catalogs filtered by genre, rating, era, and obscurity
                                </p>
                            </div>
                            <Button
                                variant={showCreateForm ? 'ghost' : 'outline'}
                                size="sm"
                                className="h-8 shrink-0 gap-1.5 text-xs"
                                onClick={() => setShowCreateForm(v => !v)}
                            >
                                <Plus className="h-3.5 w-3.5" />
                                {showCreateForm ? 'Cancel' : 'Create'}
                            </Button>
                        </div>

                        {showCreateForm && (
                            <div className="space-y-3 rounded-2xl border border-border/40 bg-muted/20 p-3">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">Name</label>
                                    <Input
                                        value={form.name}
                                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                        placeholder="e.g. 90s Action Thrillers"
                                        className="h-9 text-sm"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-muted-foreground">Type</label>
                                        <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                                            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="movie">Movie</SelectItem>
                                                <SelectItem value="series">Series</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-muted-foreground">Min Rating</label>
                                        <Select value={form.minRating} onValueChange={v => setForm(f => ({ ...f, minRating: v }))}>
                                            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">Any</SelectItem>
                                                <SelectItem value="6">6.0+</SelectItem>
                                                <SelectItem value="7">7.0+</SelectItem>
                                                <SelectItem value="8">8.0+</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">
                                        Genres {form.genres.length > 0 && <span className="text-muted-foreground/60">({form.genres.length})</span>}
                                    </label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {COMMON_GENRES.map(genre => {
                                            const selected = form.genres.includes(genre)
                                            return (
                                                <button
                                                    key={genre}
                                                    type="button"
                                                    onClick={() => setForm(f => ({
                                                        ...f,
                                                        genres: selected
                                                            ? f.genres.filter(g => g !== genre)
                                                            : [...f.genres, genre],
                                                    }))}
                                                    className={cn(
                                                        'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                                                        selected
                                                            ? 'border-primary/50 bg-primary/15 text-primary'
                                                            : 'border-border/40 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                                                    )}
                                                >
                                                    {genre}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-muted-foreground">Era Start</label>
                                        <Input
                                            type="number"
                                            value={form.eraStart}
                                            onChange={e => setForm(f => ({ ...f, eraStart: e.target.value }))}
                                            placeholder="2000"
                                            className="h-9 text-sm"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-muted-foreground">Era End</label>
                                        <Input
                                            type="number"
                                            value={form.eraEnd}
                                            onChange={e => setForm(f => ({ ...f, eraEnd: e.target.value }))}
                                            placeholder="2024"
                                            className="h-9 text-sm"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">Obscurity</label>
                                    <Select value={form.obscurity} onValueChange={v => setForm(f => ({ ...f, obscurity: v }))}>
                                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="any">Any</SelectItem>
                                            <SelectItem value="popular">Popular</SelectItem>
                                            <SelectItem value="balanced">Balanced</SelectItem>
                                            <SelectItem value="hidden">Hidden</SelectItem>
                                            <SelectItem value="gems">Gems</SelectItem>
                                            <SelectItem value="obscure">Obscure</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="flex justify-end gap-2 pt-1">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 text-xs"
                                        onClick={() => { setShowCreateForm(false); setForm(EMPTY_FORM) }}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        size="sm"
                                        className="h-8 gap-1.5 text-xs font-semibold"
                                        disabled={!form.name.trim() || creating}
                                        onClick={handleCreate}
                                    >
                                        {creating ? 'Creating...' : 'Create Catalog'}
                                    </Button>
                                </div>
                            </div>
                        )}

                        {customCatalogs.length === 0 && !showCreateForm ? (
                            <div className="rounded-2xl border border-dashed border-border/30 bg-muted/10 px-3 py-6 text-center">
                                <p className="text-xs text-muted-foreground/70">
                                    No custom catalogs yet. Create one to filter by genre, rating, era, and obscurity.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                {customCatalogs.map(cat => (
                                    <div
                                        key={cat.id}
                                        className="flex items-center gap-3 rounded-xl border border-border/40 bg-muted/25 px-3 py-2.5"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate text-sm font-medium text-foreground">{cat.name}</span>
                                                <span className="shrink-0 rounded-full border border-border/40 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                                                    {cat.type === 'series' ? 'Series' : 'Movie'}
                                                </span>
                                            </div>
                                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                                                {summarizeCatalogFilters(cat.filters)}
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(cat.id)}
                                            aria-label={`Delete ${cat.name}`}
                                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                    </>
                    )}

                    {isAccountMode && accountId && (
                        <>
                            <div className="border-t border-border/30" />
                            <section className="space-y-3">
                                <div>
                                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                        Account Override
                                    </h3>
                                    <p className="mt-1 text-xs text-muted-foreground/70">
                                        Manage this account's row size preference
                                    </p>
                                </div>
                                <div className="flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5">
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-foreground">
                                            {hasOverride
                                                ? `Custom size: ${accountSize} items`
                                                : `Using global default: ${globalSize} items`}
                                        </p>
                                        <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                                            {hasOverride
                                                ? `Global default is ${globalSize} items`
                                                : 'No override applied'}
                                        </p>
                                    </div>
                                    {hasOverride && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 shrink-0 gap-1.5 text-xs"
                                            onClick={() => setAccountRailSize(accountId, null)}
                                        >
                                            <RotateCcw className="h-3.5 w-3.5" />
                                            Reset
                                        </Button>
                                    )}
                                </div>
                            </section>
                        </>
                    )}
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-border/40 bg-muted/15 px-5 py-4 sm:px-7">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 gap-1.5 text-xs"
                        onClick={handleResetAll}
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reset
                    </Button>
                    <Button
                        size="sm"
                        className="h-9 gap-1.5 px-5 text-xs font-semibold"
                        onClick={() => onOpenChange(false)}
                    >
                        Done
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
