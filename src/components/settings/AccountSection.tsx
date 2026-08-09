import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Check, User, Clock, RefreshCw, Upload, Download } from 'lucide-react'
import { useSyncStore } from '@/store/syncStore'
import { getTimeAgo } from '@/lib/utils'
import { CopyButton } from '@/components/ui/copy-button'

export function AccountSection() {
    const auth = useSyncStore(s => s.auth)
    const syncToRemote = useSyncStore(s => s.syncToRemote)
    const syncFromRemote = useSyncStore(s => s.syncFromRemote)
    const isSyncing = useSyncStore(s => s.isSyncing)
    const lastSyncedAt = useSyncStore(s => s.lastSyncedAt)
    const setDisplayName = useSyncStore(s => s.setDisplayName)

    if (!auth.isAuthenticated) {
        return (
            <section>
                <div className="rounded-[1.75rem] border border-dashed border-border/50 bg-card/60 p-8 text-center text-sm text-muted-foreground shadow-sm">
                    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl border border-border/40 bg-muted/30">
                        <User className="h-4 w-4" />
                    </div>
                    Cloud Sync is not connected. Log in to manage your account.
                </div>
            </section>
        )
    }

    return (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="rounded-[1.75rem] border border-border/45 bg-card/80 p-5 shadow-sm">
                <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cloud account</p>
                        <h3 className="mt-1 text-xl font-semibold tracking-tight">Sync Identity</h3>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
                        <Check className="h-3.5 w-3.5" />
                        Authenticated
                    </span>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Display Name</Label>
                        <div className="relative">
                            <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="Your Name"
                                className="h-10 border-border/45 bg-background/60 pl-10 focus:bg-background"
                                value={auth.name}
                                onChange={(e) => setDisplayName(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">UUID</Label>
                        <div className="flex gap-2">
                            <Input value={auth.id} readOnly className="h-10 bg-background/60 font-mono text-xs" />
                            <CopyButton value={auth.id} variant="outline" className="h-10 w-10" iconSize={16} />
                        </div>
                    </div>
                </div>

                <p className="mt-3 text-xs leading-relaxed text-muted-foreground/70">
                    Avoid using AIOManager on two devices simultaneously with the same sync ID; both devices can compete to push state.
                </p>
            </div>

            <div className="rounded-[1.75rem] border border-primary/20 bg-primary/10 p-5 shadow-sm">
                <div className="flex h-full flex-col justify-between gap-5">
                    <div>
                        <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-primary/25 bg-background/70 text-primary">
                            <Clock className="h-4 w-4" />
                        </div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Last Sync</p>
                        <p className="mt-1 text-2xl font-semibold tracking-tight">
                            {lastSyncedAt ? getTimeAgo(new Date(lastSyncedAt)) : 'Never'}
                        </p>
                    </div>

                    <div className="grid gap-2">
                        <Button variant="default" className="gap-2" onClick={() => syncToRemote()} disabled={isSyncing}>
                            {isSyncing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                            Push to Cloud
                        </Button>
                        <Button variant="outline" className="gap-2" onClick={() => syncFromRemote()} disabled={isSyncing}>
                            {isSyncing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            Pull from Cloud
                        </Button>
                    </div>
                </div>
            </div>
        </section>
    )
}
