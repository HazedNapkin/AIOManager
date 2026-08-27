import { useEffect, useMemo, useState } from 'react'
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { useUIStore } from '@/store/uiStore'
import { useAccountStore } from '@/store/accountStore'
import { addNuvioProfiles } from '@/store/account/profileQuickAdd'
import type { ProfileQuickAddEntry, ProfileQuickAddResult } from '@/store/account/profileQuickAdd'
import type { Account } from '@/types/account'
import { cn } from '@/lib/utils'

type Phase = 'review' | 'done'

interface ProfileQuickAddReviewProps {
    open: boolean
    sourceAccountId: string
    /** Login email carried by the current Nuvio credentials; undefined lets the user type it. */
    email?: string
    entries: ProfileQuickAddEntry[]
    onClose: () => void
}

function ColorDot({ colorHex }: { colorHex?: string }) {
    return (
        <span
            className={cn('h-3 w-3 shrink-0 rounded-full', !colorHex && 'bg-muted-foreground/40')}
            style={colorHex ? { backgroundColor: colorHex } : undefined}
        />
    )
}

/**
 * Shared confirm + done screens for Profile Quick-Add (Nuvio roster).
 * Tier 1 path: zero decisions beyond the one-time password; names default
 * from the platform profiles. Batch adds always land here for the
 * count-confirm, never straight from the tab.
 */
export function ProfileQuickAddReview({ open, sourceAccountId, email, entries, onClose }: ProfileQuickAddReviewProps) {
    const [phase, setPhase] = useState<Phase>('review')
    const [rows, setRows] = useState<ProfileQuickAddEntry[]>(entries)
    const [password, setPassword] = useState('')
    const [manualEmail, setManualEmail] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [added, setAdded] = useState<ProfileQuickAddResult[]>([])
    const [failed, setFailed] = useState<ProfileQuickAddResult[]>([])
    const [skipped, setSkipped] = useState<ProfileQuickAddResult[]>([])
    const accountsVersion = useAccountStore(s => s.accounts.length)

    // Reset per invocation so repeated opens always reflect the current roster.
    useEffect(() => {
        if (!open) return
        setPhase('review')
        setRows(entries)
        setPassword('')
        setManualEmail('')
        setAdded([])
        setFailed([])
        setSkipped([])
        setSubmitting(false)
    }, [open, entries])

    const effectiveEmail = (email || manualEmail).trim()
    const canConfirm = !submitting && !!effectiveEmail && password.length > 0 && rows.length > 0 &&
        rows.every(r => r.name.trim().length > 0)

    const createdAccounts = useMemo(() => (
        added.map(result => ({
            result,
            account: useAccountStore.getState().accounts.find(a => a.id === result.accountId),
        })).filter((pair): pair is { result: ProfileQuickAddResult; account: Account } => !!pair.account)
    ), [added, accountsVersion])

    const runBatch = async (batch: ProfileQuickAddEntry[]) => {
        setSubmitting(true)
        try {
            const outcome = await addNuvioProfiles(
                sourceAccountId,
                effectiveEmail,
                password,
                batch,
            )
            if (phase === 'done') {
                setFailed(prev => prev.filter(f => !batch.some(b =>
                    b.profileIndex === f.entry.profileIndex && b.name === f.entry.name)))
                setAdded(prev => [...prev, ...outcome.results.filter(r => r.ok)])
                setSkipped(prev => [...prev, ...outcome.results.filter(r => r.skipped)])
                setFailed(prev => [...prev, ...outcome.results.filter(r => !r.ok && !r.skipped)])
            } else {
                setAdded(outcome.results.filter(r => r.ok))
                setSkipped(outcome.results.filter(r => r.skipped))
                setFailed(outcome.results.filter(r => !r.ok && !r.skipped))
                setPhase('done')
            }
        } finally {
            setSubmitting(false)
        }
    }

    const handleConfirm = () => {
        if (!canConfirm) return
        void runBatch(rows.map((r, i) => ({ ...r, name: r.name.trim() || entries[i]?.name || r.name })))
    }

    const openAccount = (accountId: string) => {
        const account = useAccountStore.getState().accounts.find(a => a.id === accountId)
        if (!account) return
        onClose()
        setTimeout(() => useUIStore.getState().openAddAccountDialog(account), 0)
    }

    const hasBatch = entries.length > 1

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next && !submitting) onClose() }}>
            <DialogContent className="max-w-md">
                {phase === 'review' ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>Add profiles as accounts</DialogTitle>
                            <DialogDescription>
                                Each profile gets its own account: separate addons, separate watch history.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4">
                            <p className="text-xs leading-relaxed text-muted-foreground">
                                {hasBatch ? `Creates ${rows.length} accounts connected to this Nuvio login.` : 'Creates 1 account connected to this Nuvio login.'}
                                {' '}Nothing changes on Nuvio. Delete any account anytime.
                            </p>

                            <div className="space-y-2">
                                {rows.map((row, i) => (
                                    <div key={`${row.profileIndex}-${i}`} className="flex items-center gap-2.5">
                                        <ColorDot colorHex={row.avatarColorHex} />
                                        <Input
                                            value={row.name}
                                            onChange={e => setRows(prev => prev.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
                                            className="h-8 flex-1 text-xs"
                                            aria-label={`Account name for ${entries[i]?.name || 'profile'}`}
                                        />
                                        {hasBatch && (
                                            <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground">#{row.profileIndex}</span>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <div className="space-y-2">
                                {!email && (
                                    <div className="space-y-1.5">
                                        <Label htmlFor="quick-add-email" className="text-xs">Nuvio email</Label>
                                        <Input
                                            id="quick-add-email"
                                            value={manualEmail}
                                            onChange={e => setManualEmail(e.target.value)}
                                            type="email"
                                            autoComplete="off"
                                            className="h-8 text-xs"
                                            placeholder="you@example.com"
                                        />
                                    </div>
                                )}
                                {email && (
                                    <div className="flex items-center justify-between gap-2 rounded-xl border border-border/40 bg-muted/20 px-3 py-2">
                                        <span className="min-w-0 truncate text-xs text-muted-foreground">{email}</span>
                                        <span className="shrink-0 text-[11px] text-muted-foreground/70">login</span>
                                    </div>
                                )}
                                <div className="space-y-1.5">
                                    <Label htmlFor="quick-add-password" className="text-xs">Nuvio password</Label>
                                    <Input
                                        id="quick-add-password"
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        type="password"
                                        autoComplete="new-password"
                                        className="h-8 text-xs"
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleConfirm() } }}
                                    />
                                    <p className="text-[11px] text-muted-foreground">Used once now, never stored.</p>
                                </div>
                            </div>

                            <div className="flex gap-2 pt-1">
                                <Button variant="subtle" className="h-8 flex-1 text-xs" onClick={onClose} disabled={submitting}>
                                    Cancel
                                </Button>
                                <Button className="h-8 flex-1 text-xs font-medium" onClick={handleConfirm} disabled={!canConfirm}>
                                    {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                                    {rows.length === 1 ? 'Create account' : `Create ${rows.length} accounts`}
                                </Button>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle>
                                {failed.length === 0
                                    ? `${added.length} account${added.length === 1 ? '' : 's'} created`
                                    : 'Finished with some misses'}
                            </DialogTitle>
                            <DialogDescription>
                                Nothing changes on Nuvio. You can delete any of these accounts anytime.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                            {createdAccounts.map(({ result, account }) => (
                                <div key={result.accountId} className="flex items-center gap-3 rounded-2xl border border-border/40 bg-card px-3 py-2 shadow-sm">
                                    <AccountAvatar size="sm" showStatus={false} account={account!} />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">{account!.name}</p>
                                        <p className="mt-0.5 text-[11px] text-muted-foreground">Ready. Addons and history arrive with the first sync.</p>
                                    </div>
                                    <Button variant="outline" size="sm" className="h-7 shrink-0 px-2.5 text-xs" onClick={() => openAccount(result.accountId!)}>
                                        Open
                                    </Button>
                                </div>
                            ))}

                            {[...skipped, ...failed].map((result, i) => (
                                <div key={`miss-${i}`} className="flex items-start gap-2.5 rounded-2xl border border-warning/30 bg-warning/8 px-3 py-2.5">
                                    <AlertCircle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-xs font-medium">{result.entry.name}</p>
                                        <p className="mt-0.5 text-[11px] text-muted-foreground">{result.error || 'Could not create'}</p>
                                    </div>
                                    {!result.skipped && (
                                        <Button variant="outline" size="sm" className="h-7 shrink-0 gap-1 px-2.5 text-xs" onClick={() => void runBatch([result.entry])} disabled={submitting}>
                                            <RefreshCw className="h-3 w-3" />
                                            Retry
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>

                        <p className="text-[11px] text-muted-foreground">
                            The first sync pulls addons and watch history automatically, usually within a minute.
                        </p>

                        <div className="flex gap-2">
                            <Button variant="subtle" className="h-8 flex-1 text-xs" onClick={onClose}>
                                Close
                            </Button>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}
