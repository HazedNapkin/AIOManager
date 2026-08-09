import { useState } from 'react'
import { Wrench, KeyRound, PlugZap, ClipboardCopy, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SquircleOverlay } from '@/components/ui/squircle-overlay'
import { toast } from '@/hooks/use-toast'
import { maskEmail, normalizeAddonUrl } from '@/lib/utils'
import { useAccountStore } from '@/store/accountStore'
import { useAddonStore } from '@/store/addonStore'
import { useConnectionStore } from '@/store/connectionStore'
import { useSyncStore } from '@/store/syncStore'

type ActionKey = 'repair' | 'reauth' | 'connections' | 'diagnostics'

function urlFingerprint(url: string): string {
    const s = normalizeAddonUrl(url)
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16).padStart(8, '0')
}

function ActionRow({
    icon,
    title,
    description,
    cta,
    busy,
    busyLabel,
    disabled,
    onClick,
}: {
    icon: React.ReactNode
    title: string
    description: string
    cta: string
    busy: boolean
    busyLabel?: string
    disabled: boolean
    onClick: () => void
}) {
    return (
        <div className="flex flex-col gap-3 rounded-2xl border border-border/35 bg-background/35 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
                <div className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-border/35 bg-muted/25">
                    <SquircleOverlay />
                    <span className="relative z-10 text-muted-foreground">{icon}</span>
                </div>
                <div className="space-y-0.5">
                    <h4 className="text-sm font-semibold">{title}</h4>
                    <p className="max-w-xl text-xs text-muted-foreground">{description}</p>
                </div>
            </div>
            <Button
                variant="outline"
                onClick={onClick}
                disabled={disabled || busy}
                className="h-9 shrink-0 gap-2 self-start text-xs tabular-nums sm:self-auto"
            >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {busy ? (busyLabel || 'Working...') : cta}
            </Button>
        </div>
    )
}

export function RepairTools() {
    const accounts = useAccountStore(s => s.accounts)
    const repairAccount = useAccountStore(s => s.repairAccount)
    const syncAccount = useAccountStore(s => s.syncAccount)

    const [running, setRunning] = useState<ActionKey | null>(null)
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

    const expiredCount = accounts.filter(a => a.status === 'expired').length
    const connectionAccountCount = accounts.filter(a => a.connections?.some(c => c.enabled)).length

    const handleRepairAll = async () => {
        if (accounts.length === 0) return
        setRunning('repair')
        setProgress({ done: 0, total: accounts.length })
        let ok = 0
        let failed = 0
        for (const account of accounts) {
            try {
                await repairAccount(account.id)
                ok++
            } catch {
                failed++
            }
            setProgress(p => (p ? { ...p, done: p.done + 1 } : p))
        }
        setProgress(null)
        setRunning(null)
        toast({
            title: 'Repair Complete',
            description: `Refreshed ${ok} account${ok !== 1 ? 's' : ''}${failed > 0 ? `, ${failed} failed` : ''}.`,
            variant: failed > 0 ? 'destructive' : undefined,
        })
    }

    const handleReauth = async () => {
        const expired = accounts.filter(a => a.status === 'expired')
        if (expired.length === 0) {
            toast({ title: 'Nothing to re-authenticate', description: 'No accounts are currently expired.' })
            return
        }
        setRunning('reauth')
        setProgress({ done: 0, total: expired.length })
        for (const account of expired) {
            try { await syncAccount(account.id) } catch {}
            setProgress(p => (p ? { ...p, done: p.done + 1 } : p))
        }
        const after = useAccountStore.getState().accounts
        const recovered = expired.filter(e => after.find(a => a.id === e.id)?.status === 'active').length
        const remaining = expired.length - recovered
        setProgress(null)
        setRunning(null)
        toast({
            title: 'Re-authentication Complete',
            description: `${recovered} of ${expired.length} recovered${remaining > 0 ? `; ${remaining} still need a manual sign-in (no saved password).` : '.'}`,
            variant: remaining > 0 ? 'destructive' : undefined,
        })
    }

    const handleRecheckConnections = async () => {
        const targets = accounts.filter(a => a.connections?.some(c => c.enabled))
        if (targets.length === 0) {
            toast({ title: 'No connections', description: 'No accounts have active native connections.' })
            return
        }
        setRunning('connections')
        setProgress({ done: 0, total: targets.length })
        const { refreshConnectionStates } = useConnectionStore.getState()
        for (const account of targets) {
            try { await refreshConnectionStates(account.id) } catch {}
            setProgress(p => (p ? { ...p, done: p.done + 1 } : p))
        }
        setProgress(null)
        setRunning(null)
        toast({ title: 'Connections Re-checked', description: `Refreshed status for ${targets.length} account${targets.length !== 1 ? 's' : ''}.` })
    }

    const handleCopyDiagnostics = async () => {
        setRunning('diagnostics')
        try {
            const sync = useSyncStore.getState()
            const library = useAddonStore.getState().library
            const L: string[] = []
            L.push('AIOManager Diagnostics')
            L.push(`Generated: ${new Date().toISOString()}`)
            L.push(`Version (last seen): ${sync.lastSeenVersion || 'unknown'}`)
            L.push(`Display: ${window.matchMedia('(display-mode: standalone)').matches ? 'installed (standalone)' : 'browser tab'} | Online: ${navigator.onLine}`)
            L.push(`Cloud sync: ${sync.auth.isAuthenticated ? 'linked' : 'off'} | initialPullDone: ${sync.isInitialSyncCompleted} | lastSave: ${sync.lastSyncedAt || 'never'}`)
            L.push(`Saved library entries: ${Object.keys(library).length}`)
            L.push(`Accounts: ${accounts.length}`)

            for (const a of accounts) {
                const addons = a.addons || []
                const enabled = addons.filter(x => x.flags?.enabled !== false).length
                const protectedCount = addons.filter(x => x.flags?.protected).length
                const profiles = a.profiles || []
                const defaultCount = profiles.filter(p => p?.id === 'default').length
                const label = a.name || (a.email ? maskEmail(a.email) : a.id)
                L.push('')
                L.push(`- ${label}: status=${a.status || 'unknown'}`)
                L.push(`    addons: ${addons.length} (enabled ${enabled}, disabled ${addons.length - enabled}, protected ${protectedCount}), deletionMarkers: ${Object.keys(a.deletedAddons || {}).length}`)
                L.push(`    profiles: ${profiles.length} [${profiles.map(p => p?.id).join(', ') || 'none'}], active: ${a.activeProfileId ?? 'default'}, duplicateDefault: ${defaultCount > 1 ? `YES (${defaultCount})` : 'no'}`)
                const conns = a.connections || []
                if (conns.length) {
                    L.push(`    connections: ${conns.map(c => `${c.platform}{${c.enabled ? 'on' : 'off'},${c.status || '?'},fails=${c.consecutiveFailures ?? 0}}`).join(', ')}`)
                }
                for (const ad of addons) {
                    const id = ad.manifest?.id || '?'
                    const name = ad.manifest?.name || '?'
                    const ver = ad.manifest?.version || '?'
                    let host = '?'
                    try { host = new URL(ad.transportUrl).host } catch {}
                    L.push(`      * ${host} id=${id} "${name}" v${ver} ${ad.flags?.enabled === false ? 'disabled' : 'enabled'} url#${urlFingerprint(ad.transportUrl)}`)
                }
            }

            L.push('')
            L.push('Recent sync log:')
            for (const entry of sync.history.slice(0, 20)) {
                L.push(`  [${entry.status}] ${entry.type}${entry.isAuto ? ' (auto)' : ''} - ${entry.message} @ ${entry.timestamp}`)
            }
            L.push(`UserAgent: ${navigator.userAgent}`)

            await navigator.clipboard.writeText(L.join('\n'))
            toast({ title: 'Diagnostics Copied', description: 'A debug summary is on your clipboard. No credentials or URLs are included.' })
        } catch {
            toast({ variant: 'destructive', title: 'Copy Failed', description: 'Could not access the clipboard.' })
        } finally {
            setRunning(null)
        }
    }

    const pct = progress ? ` ${progress.done}/${progress.total}` : ''

    return (
        <div className="overflow-hidden rounded-[1.75rem] border border-border/45 bg-card/80 shadow-sm">
            <div className="flex items-center gap-3 p-4">
                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/35 bg-muted/25">
                    <SquircleOverlay />
                    <Wrench className="relative z-10 h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                    <h3 className="text-sm font-semibold">Repair & Recovery</h3>
                    <p className="text-xs text-muted-foreground">Safe fixes for common issues</p>
                </div>
            </div>

            <div className="space-y-2 border-t border-border/40 p-4">
                <ActionRow
                    icon={<Wrench className="h-4 w-4" />}
                    title="Repair All Accounts"
                    description="Re-fetch every addon manifest and rebuild broken entries (Unknown Addon, missing icons or catalogs, 0.0.0 versions) across all accounts, then re-sync each."
                    cta="Repair All"
                    busy={running === 'repair'}
                    busyLabel={`Repairing${pct}`}
                    disabled={running !== null || accounts.length === 0}
                    onClick={handleRepairAll}
                />
                <ActionRow
                    icon={<KeyRound className="h-4 w-4" />}
                    title="Re-authenticate Expired Accounts"
                    description="Sign expired accounts back in using their saved passwords, in one pass instead of one at a time."
                    cta={expiredCount > 0 ? `Re-auth (${expiredCount})` : 'Re-auth'}
                    busy={running === 'reauth'}
                    busyLabel={`Signing in${pct}`}
                    disabled={running !== null || accounts.length === 0}
                    onClick={handleReauth}
                />
                <ActionRow
                    icon={<PlugZap className="h-4 w-4" />}
                    title="Re-check Connections"
                    description="Re-validate native Nuvio / RealStream connection tokens and refresh their health status."
                    cta={connectionAccountCount > 0 ? `Re-check (${connectionAccountCount})` : 'Re-check'}
                    busy={running === 'connections'}
                    busyLabel={`Checking${pct}`}
                    disabled={running !== null || connectionAccountCount === 0}
                    onClick={handleRecheckConnections}
                />
                <ActionRow
                    icon={<ClipboardCopy className="h-4 w-4" />}
                    title="Copy Diagnostics"
                    description="Copy a detailed debug summary (per-account addon/profile/connection state, URL fingerprints, recent sync log) to your clipboard. No credentials or URLs included."
                    cta="Copy"
                    busy={running === 'diagnostics'}
                    disabled={running !== null}
                    onClick={handleCopyDiagnostics}
                />
            </div>
        </div>
    )
}
