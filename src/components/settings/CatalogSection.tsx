import { useState, useEffect, useCallback } from 'react'
import { Copy, Check, ExternalLink, Home, User, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToolbarShell } from '@/components/ui/toolbar-shell'
import { getAllCatalogUrls } from '@/lib/catalog-sync'
import { useAccountStore } from '@/store/accountStore'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { toast } from '@/hooks/use-toast'

interface CatalogUrlEntry {
    label: string
    url: string
    scope: 'household' | 'account'
    accountId?: string
}

export function CatalogSection() {
    const [loading, setLoading] = useState(true)
    const [householdUrl, setHouseholdUrl] = useState<string | null>(null)
    const [accountUrls, setAccountUrls] = useState<Array<{ accountId: string; accountName?: string; url: string }>>([])
    const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
    const accounts = useAccountStore(s => s.accounts)

    const fetchUrls = useCallback(async () => {
        setLoading(true)
        const result = await getAllCatalogUrls()
        if (result) {
            setHouseholdUrl(result.household)
            setAccountUrls(result.accounts)
        }
        setLoading(false)
    }, [])

    useEffect(() => { fetchUrls() }, [fetchUrls])

    const handleCopy = useCallback((url: string) => {
        navigator.clipboard.writeText(url)
        setCopiedUrl(url)
        setTimeout(() => setCopiedUrl(null), 2000)
        toast({ title: 'URL copied to clipboard' })
    }, [])

    const accountName = useCallback((accountId: string) => {
        const acc = accounts.find(a => a.id === accountId)
        return acc?.name || acc?.email?.split('@')[0] || 'Account'
    }, [accounts])

    const entries: CatalogUrlEntry[] = []
    if (householdUrl) {
        entries.push({ label: 'Household (All Accounts)', url: householdUrl, scope: 'household' })
    }
    for (const entry of accountUrls) {
        entries.push({
            label: entry.accountName || accountName(entry.accountId),
            url: entry.url,
            scope: 'account',
            accountId: entry.accountId,
        })
    }

    return (
        <div className="space-y-4">
            <ToolbarShell>
                <div className="flex items-center gap-2">
                    <Home className="h-4 w-4 text-primary" />
                    <div>
                        <p className="text-sm font-semibold">Catalog Addon URLs</p>
                        <p className="text-xs text-muted-foreground">
                            Install these in Stremio, Nuvio, AIOMetadata, or AIOStreams
                        </p>
                    </div>
                </div>
            </ToolbarShell>

            {loading ? (
                <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
            ) : entries.length === 0 ? (
                <div className="rounded-lg border border-border/40 bg-muted/20 p-6 text-center">
                    <p className="text-sm text-muted-foreground">
                        No catalog URLs yet. Activity data from your managed accounts will appear here once the activity engine runs.
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {entries.map((entry) => (
                        <div
                            key={entry.url}
                            className="flex items-center gap-3 rounded-lg border border-border/40 bg-card/50 p-3"
                        >
                            {entry.scope === 'household' ? (
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                                    <Home className="h-4 w-4 text-primary" />
                                </div>
                            ) : entry.accountId ? (
                                (() => {
                                    const acc = accounts.find(a => a.id === entry.accountId)
                                    return acc ? (
                                        <AccountAvatar account={acc} size="sm" />
                                    ) : (
                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                                            <User className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                    )
                                })()
                            ) : (
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                                    <User className="h-4 w-4 text-muted-foreground" />
                                </div>
                            )}

                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{entry.label}</p>
                                <code className="block truncate text-xs text-muted-foreground">{entry.url}</code>
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleCopy(entry.url)}
                                >
                                    {copiedUrl === entry.url ? (
                                        <Check className="h-3.5 w-3.5 text-green-500" />
                                    ) : (
                                        <Copy className="h-3.5 w-3.5" />
                                    )}
                                </Button>
                                <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                                    <a href={entry.url} target="_blank" rel="noopener noreferrer">
                                        <ExternalLink className="h-3.5 w-3.5" />
                                    </a>
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
