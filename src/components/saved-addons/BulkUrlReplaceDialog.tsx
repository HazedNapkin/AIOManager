import { Button } from '@/components/ui/button'
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
import { useAddonStore } from '@/store/addonStore'
import { AlertTriangle, Check, Loader2, Wand2, X, ArrowRight } from 'lucide-react'
import { useEffect, useState, useMemo } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn, normalizeAddonUrl } from '@/lib/utils'
import { SavedAddonIcon } from './SavedAddonIcon'

function escapeRegExp(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceAllCaseInsensitive(str: string, find: string, replace: string) {
    return str.replace(new RegExp(escapeRegExp(find), 'gi'), replace)
}

interface BulkUrlReplaceDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

interface ReplaceResult {
    id: string
    name: string
    logo?: string
    manifestId: string
    oldUrl: string
    newUrl: string
    status: 'idle' | 'skipped' | 'running' | 'success' | 'error'
    blockReason?: 'no-change' | 'target-exists' | 'duplicate-target'
    error?: string
}

function getBlockReasonLabel(reason?: ReplaceResult['blockReason']) {
    if (reason === 'no-change') return 'No URL change'
    if (reason === 'target-exists') return 'Already exists'
    if (reason === 'duplicate-target') return 'Same new link'
    return null
}

export function BulkUrlReplaceDialog({ open, onOpenChange }: BulkUrlReplaceDialogProps) {
    const library = useAddonStore(s => s.library)
    const [findText, setFindText] = useState('')
    const [replaceText, setReplaceText] = useState('')
    const [results, setResults] = useState<ReplaceResult[]>([])
    const [isExecuting, setIsExecuting] = useState(false)

    // Calculate dry-run output from full library. This is local-only and does not
    // fetch manifests or mutate accounts until the user runs the replacement.
    const previewItems = useMemo<ReplaceResult[]>(() => {
        if (!findText.trim()) return []
        const addons = Object.values(library)
        const rawMatches = addons.filter(addon =>
            addon.installUrl.toLowerCase().includes(findText.toLowerCase())
        )

        const existingIdsByUrl = new Map<string, string[]>()
        for (const addon of addons) {
            const key = normalizeAddonUrl(addon.installUrl)
            const ids = existingIdsByUrl.get(key)
            if (ids) ids.push(addon.id)
            else existingIdsByUrl.set(key, [addon.id])
        }

        const movingIds = new Set<string>()
        for (const addon of rawMatches) {
            const newUrl = replaceAllCaseInsensitive(addon.installUrl, findText, replaceText)
            const oldKey = normalizeAddonUrl(addon.installUrl)
            const newKey = normalizeAddonUrl(newUrl)
            if (oldKey === newKey) continue
            movingIds.add(addon.id)
        }

        const claimedTargetKeys = new Set<string>()
        return rawMatches.map(addon => {
            const newUrl = replaceAllCaseInsensitive(addon.installUrl, findText, replaceText)
            const oldKey = normalizeAddonUrl(addon.installUrl)
            const newKey = normalizeAddonUrl(newUrl)
            const existingTargetIds = existingIdsByUrl.get(newKey)?.filter(id => id !== addon.id && !movingIds.has(id)) ?? []

            let blockReason: ReplaceResult['blockReason'] | undefined
            if (oldKey === newKey) {
                blockReason = 'no-change'
            } else if (existingTargetIds.length > 0) {
                blockReason = 'target-exists'
            } else if (claimedTargetKeys.has(newKey)) {
                blockReason = 'duplicate-target'
            }

            if (oldKey !== newKey && !blockReason) {
                claimedTargetKeys.add(newKey)
            }

            return {
                id: addon.id,
                name: addon.name,
                logo: addon.metadata?.customLogo || addon.manifest?.logo,
                manifestId: addon.manifest?.id || 'unknown',
                oldUrl: addon.installUrl,
                newUrl,
                status: blockReason ? 'skipped' : 'idle',
                blockReason,
            }
        })
    }, [library, findText, replaceText])

    const runnableItems = useMemo(
        () => previewItems.filter(item => !item.blockReason),
        [previewItems]
    )
    const blockedCount = previewItems.length - runnableItems.length
    const resultsById = useMemo(
        () => new Map(results.map(result => [result.id, result])),
        [results]
    )

    // Reset when opening
    useEffect(() => {
        if (open) {
            setFindText('')
            setReplaceText('')
            setResults([])
            setIsExecuting(false)
        }
    }, [open])

    const handleRun = async () => {
        if (runnableItems.length === 0 || isExecuting) return

        setIsExecuting(true)
        setResults(previewItems)

        const addonStore = useAddonStore.getState()

        for (const item of runnableItems) {
            setResults(prev => prev.map(r => r.id === item.id ? { ...r, status: 'running' } : r))

            try {
                // Use the universal replacement logic which handles library, accounts, and rules
                const result = await addonStore.replaceTransportUrlUniversally(item.id, item.oldUrl, item.newUrl)
                const warning = result.failedAccounts.length
                    ? `Updated locally, but failed to sync ${result.failedAccounts.length} account(s): ${result.failedAccounts.join(', ')}`
                    : undefined

                setResults(prev => prev.map(r => r.id === item.id ? { ...r, status: warning ? 'error' : 'success', error: warning } : r))
            } catch (err) {
                if (import.meta.env.DEV) console.error(`[BulkReplace] Failed for ${item.name}:`, err)
                setResults(prev => prev.map(r => r.id === item.id ? { ...r, status: 'error', error: err instanceof Error ? err.message : 'Replacement failed' } : r))
            }
        }

        setIsExecuting(false)
    }

    const renderUrlWithHighlight = (url: string, fragment: string) => {
        if (!fragment) return url
        const parts = url.split(new RegExp(`(${escapeRegExp(fragment)})`, 'gi'))
        return (
            <span className="break-all font-mono text-xs leading-tight">
                {parts.map((part, i) => (
                    i % 2 === 1 ? (
                        <span key={i} className="bg-primary/20 text-primary font-bold rounded px-0.5 border border-primary/25">
                            {part}
                        </span>
                    ) : (
                        <span key={i} className="text-muted-foreground">{part}</span>
                    )
                ))}
            </span>
        )
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
                <DialogHeader className="p-6 pb-4">
                    <DialogTitle className="flex items-center gap-2">
                        <Wand2 className="h-5 w-5 text-primary" />
                        Bulk URL Fragment Replace
                    </DialogTitle>
                    <DialogDescription>
                        Search and replace strings across your entire library. Useful for domain migrations or proxy updates.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="p-6 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="find" className="text-xs font-medium uppercase text-muted-foreground">Find Fragment</Label>
                                <Input
                                    id="find"
                                    placeholder="e.g. old-domain.com"
                                    value={findText}
                                    onChange={(e) => {
                                        setFindText(e.target.value)
                                        setResults([])
                                    }}
                                    disabled={isExecuting}
                                    className="h-10 font-mono text-sm"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="replace" className="text-xs font-medium uppercase text-muted-foreground">Replace With</Label>
                                <Input
                                    id="replace"
                                    placeholder="e.g. new-domain.com"
                                    value={replaceText}
                                    onChange={(e) => {
                                        setReplaceText(e.target.value)
                                        setResults([])
                                    }}
                                    disabled={isExecuting}
                                    className="h-10 font-mono text-sm"
                                />
                            </div>
                        </div>


                        <div className="space-y-3 pt-2">
                            <div className="flex items-center justify-between px-1">
                                <h4 className="text-xs font-medium uppercase text-muted-foreground flex items-center gap-2">
                                    {isExecuting ? 'Running Changes' : 'Before You Run This'}
                                    {previewItems.length > 0 && (
                                        <span className="bg-primary/12 text-primary px-1.5 py-0.5 rounded-full text-xs">
                                            {previewItems.length} matches
                                        </span>
                                    )}
                                    {blockedCount > 0 && (
                                        <span className="bg-warning/10 text-warning px-1.5 py-0.5 rounded-full text-xs">
                                            {blockedCount} cannot run
                                        </span>
                                    )}
                                </h4>
                            </div>

                            <ScrollArea className="h-[300px] w-full rounded-xl border bg-muted/20">
                                <div className="p-4 space-y-4">
                                    {previewItems.length === 0 ? (
                                        <div className="h-[260px] flex flex-col items-center justify-center text-center space-y-2 opacity-60">
                                            <div className="p-4 rounded-full bg-muted">
                                                <X className="h-8 w-8 text-muted-foreground" />
                                            </div>
                                            <p className="text-sm font-medium">No add-ons match this pattern</p>
                                            <p className="text-xs text-muted-foreground">Enter text in Find to preview matching add-ons.</p>
                                        </div>
                                    ) : (
                                        previewItems.map((item) => {
                                            const executionState = resultsById.get(item.id) ?? item
                                            const blockReasonLabel = getBlockReasonLabel(item.blockReason)

                                            return (
                                                <div key={item.id} className={cn(
                                                    "group p-3 rounded-lg border bg-card transition-[transform,opacity,box-shadow] relative overflow-hidden",
                                                    item.blockReason && "border-warning/30 bg-warning/5",
                                                    executionState?.status === 'success' && "border-success/30 bg-success/5",
                                                    executionState?.status === 'error' && "border-destructive/30 bg-destructive/5"
                                                )}>

                                                    <div className="absolute right-3 top-3">
                                                        {executionState?.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                                                        {executionState?.status === 'success' && <Check className="h-4 w-4 text-success" />}
                                                        {blockReasonLabel && executionState?.status !== 'success' && executionState?.status !== 'running' && executionState?.status !== 'error' && (
                                                            <div className="flex items-center gap-1.5 text-warning">
                                                                <span className="text-xs font-medium">{blockReasonLabel}</span>
                                                                <AlertTriangle className="h-4 w-4" />
                                                            </div>
                                                        )}
                                                        {executionState?.status === 'error' && (
                                                            <div className="flex items-center gap-2 text-destructive">
                                                                <span className="text-xs font-medium">{executionState.error}</span>
                                                                <X className="h-4 w-4" />
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="space-y-3">
                                                        <div className="flex items-center gap-2 pr-24">
                                                            <SavedAddonIcon
                                                                name={item.name}
                                                                logo={item.logo}
                                                                className="h-8 w-8"
                                                                textClassName="text-[11px]"
                                                            />
                                                            <div className="min-w-0">
                                                                <span className="block truncate text-xs font-bold leading-none mb-1">{item.name}</span>
                                                                <span className="block truncate text-xs text-muted-foreground uppercase font-bold tracking-tighter">
                                                                    {item.manifestId}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        <div className="space-y-2 pt-1 border-t border-dashed">
                                                            <div className="flex flex-col gap-1">
                                                                <span className="text-xs font-bold text-muted-foreground uppercase opacity-50">Old URL</span>
                                                                {renderUrlWithHighlight(item.oldUrl, findText)}
                                                            </div>

                                                            <div className="flex justify-center -my-1">
                                                                <ArrowRight className="h-3 w-3 text-muted-foreground/60" />
                                                            </div>

                                                            <div className="flex flex-col gap-1">
                                                                <span className="text-xs font-bold text-primary/70 uppercase">New URL</span>
                                                                <span className="break-all font-mono text-xs leading-tight text-primary/80 italic">
                                                                    {item.newUrl}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            </ScrollArea>
                        </div>
                    </div>
                </div>

                <DialogFooter className="gap-3 px-4 pb-4 pt-0">
                    <Button variant="subtle" onClick={() => onOpenChange(false)} disabled={isExecuting}>
                        {results.some(r => r.status === 'success') ? 'Close' : 'Cancel'}
                    </Button>
                    <Button
                        onClick={handleRun}
                        disabled={runnableItems.length === 0 || isExecuting || !findText.trim()}
                        className="bg-primary hover:bg-primary/90 gap-2"
                    >
                        {isExecuting ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Running...
                            </>
                        ) : (
                            <>
                                Run {runnableItems.length} Replacement{runnableItems.length !== 1 ? 's' : ''}
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
