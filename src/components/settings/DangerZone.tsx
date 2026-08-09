import { triggerSync } from '@/lib/sync-trigger'
import { apiFetch } from '@/lib/http-client'
import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { ShieldAlert, Trash2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import localforage from 'localforage'
import { useAccountStore } from '@/store/accountStore'
import { useAddonStore } from '@/store/addonStore'
import { useFailoverStore } from '@/store/failoverStore'
import { useSyncStore } from '@/store/syncStore'
import { useTheme } from '@/contexts/ThemeContext'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'

type DangerAction = {
    title: string
    description: string
    confirmText: string
    action: () => Promise<void>
}

export function DangerZone() {
    const accounts = useAccountStore(s => s.accounts)
    const resetAccounts = useAccountStore(s => s.reset)
    const library = useAddonStore(s => s.library)
    const resetAddons = useAddonStore(s => s.reset)
    const auth = useSyncStore(s => s.auth)
    const deleteRemoteAccount = useSyncStore(s => s.deleteRemoteAccount)
    const { setTheme } = useTheme()

    const savedAddonsCount = Object.keys(library).length
    const failoverRulesCount = useFailoverStore((s) => s.rules.length)

    const [unsafeMode, setUnsafeMode] = useState(false)
    const [pendingAction, setPendingAction] = useState<DangerAction | null>(null)
    const [isRunning, setIsRunning] = useState(false)

    const executeDeleteAllAccounts = async () => {
        await resetAccounts()
        toast({ title: 'Accounts Deleted', description: 'All accounts have been removed.' })
    }

    const executeDeleteAllAddons = async () => {
        await resetAddons()
        toast({ title: 'Saved Addons Deleted', description: 'All saved addons have been removed.' })
    }

    const executePurgeAutopilot = async () => {
        try {
            const failoverState = useFailoverStore.getState()
            const accountIds = [...new Set(failoverState.rules.map(r => r.accountId))]
            for (const accountId of accountIds) {
                try {
                    const { useSyncStore } = await import('@/store/syncStore')
                    const { auth: syncAuth, serverUrl } = useSyncStore.getState()
                    if (syncAuth.isAuthenticated) {
                        const baseUrl = serverUrl || ''
                        await apiFetch(`/autopilot/account/${accountId}`, {
                            method: 'DELETE',
                            baseUrl: baseUrl.startsWith('http') ? baseUrl : undefined,
                        })
                    }
                } catch (e) {
                    if (import.meta.env.DEV) console.warn(`[Settings] Failed to purge server rules for ${accountId}:`, e)
                }
            }
            useFailoverStore.setState({ rules: [] })
            const localforageModule = await import('localforage')
            await localforageModule.default.setItem('aioman:failover-rules', [])
            triggerSync()
            toast({ title: 'Autopilot Purged', description: 'All rules have been deleted from local and server.' })
        } catch (e) {
            if (import.meta.env.DEV) console.error('Purge failed:', e)
            toast({ variant: 'destructive', title: 'Purge Failed', description: 'Could not purge all autopilot rules.' })
        }
    }

    const executeResetAll = async () => {
        try {
            if (auth.isAuthenticated) {
                try {
                    await deleteRemoteAccount()
                    toast({ title: 'Cloud Data Deleted', description: 'Sync account removed from server.' })
                } catch (e) {
                    if (import.meta.env.DEV) console.error('Remote delete failed', e)
                    toast({ variant: 'destructive', title: 'Remote Delete Failed', description: 'Could not delete cloud account, but proceeding with local wipe.' })
                }
            }
            await localforage.clear()
            localStorage.clear()
            setTheme('dark')
            toast({ title: 'Reset Complete', description: 'Application has been reset.' })
            setTimeout(() => { window.location.href = '/' }, 500)
        } catch (e) {
            if (import.meta.env.DEV) console.error('Reset failed', e)
            toast({ variant: "destructive", title: "Reset Failed", description: "Could not clear database." })
        }
    }

    const requestDangerAction = (action: DangerAction) => {
        if (!unsafeMode) {
            toast({ variant: 'destructive', title: 'Enable Unsafe Mode', description: 'You must enable Unsafe Mode first.' })
            return
        }
        setPendingAction(action)
    }

    const confirmDangerAction = async () => {
        if (!pendingAction) return
        setIsRunning(true)
        try {
            await pendingAction.action()
            setPendingAction(null)
            setUnsafeMode(false)
        } finally {
            setIsRunning(false)
        }
    }

    return (
        <>
            <div className="overflow-hidden rounded-[1.75rem] border border-destructive/30 bg-destructive/10 p-1">
                <div className="space-y-6 rounded-[1.55rem] bg-card/90 p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-2.5">
                            <ShieldAlert className="h-5 w-5 text-destructive" />
                        </div>
                        <div>
                            <h3 className="font-medium text-destructive uppercase text-xs">Irreversible Actions</h3>
                            <p className="text-sm text-muted-foreground">Actions below will permanently delete data.</p>
                        </div>
                    </div>
                    <div className="flex w-fit self-start items-center gap-2 rounded-full border border-destructive/20 bg-destructive/5 px-3 py-2 sm:self-auto">
                        <Label htmlFor="unsafe-mode" className="text-xs font-bold text-destructive/70 uppercase">Unlock Actions</Label>
                        <Switch
                            id="unsafe-mode"
                            checked={unsafeMode}
                            onCheckedChange={setUnsafeMode}
                            className="data-[state=checked]:bg-destructive"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-10 gap-2 rounded-xl border-destructive/40 bg-background/40 text-destructive transition-[transform,opacity,box-shadow] hover:bg-destructive hover:text-white disabled:opacity-40"
                        onClick={() => requestDangerAction({
                            title: 'Wipe all accounts?',
                            description: `This permanently removes ${accounts.length} local account${accounts.length !== 1 ? 's' : ''} and their installed addon state from AIOManager. It does not delete the connected accounts themselves.`,
                            confirmText: 'Wipe Accounts',
                            action: executeDeleteAllAccounts,
                        })}
                        disabled={accounts.length === 0 || !unsafeMode || isRunning}
                    >
                        <Trash2 className="h-4 w-4" />
                        Wipe Accounts ({accounts.length})
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-10 gap-2 rounded-xl border-destructive/40 bg-background/40 text-destructive transition-[transform,opacity,box-shadow] hover:bg-destructive hover:text-white disabled:opacity-40"
                        onClick={() => requestDangerAction({
                            title: 'Wipe saved addon library?',
                            description: `This permanently removes ${savedAddonsCount} saved addon${savedAddonsCount !== 1 ? 's' : ''}, tags, and reusable library entries from this device.`,
                            confirmText: 'Wipe Library',
                            action: executeDeleteAllAddons,
                        })}
                        disabled={savedAddonsCount === 0 || !unsafeMode || isRunning}
                    >
                        <Trash2 className="h-4 w-4" />
                        Wipe Library ({savedAddonsCount})
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-10 gap-2 rounded-xl border-destructive/40 bg-background/40 text-destructive transition-[transform,opacity,box-shadow] hover:bg-destructive hover:text-white disabled:opacity-40"
                        onClick={() => requestDangerAction({
                            title: 'Purge all Autopilot rules?',
                            description: `This deletes ${failoverRulesCount} local/server Autopilot rule${failoverRulesCount !== 1 ? 's' : ''} and disables failover automation until rules are recreated.`,
                            confirmText: 'Purge Autopilot',
                            action: executePurgeAutopilot,
                        })}
                        disabled={failoverRulesCount === 0 || !unsafeMode || isRunning}
                    >
                        <Trash2 className="h-4 w-4" />
                        Purge Autopilot ({failoverRulesCount})
                    </Button>
                    <Button
                        variant="destructive"
                        size="sm"
                        className="h-10 gap-2 rounded-xl font-bold"
                        onClick={() => requestDangerAction({
                            title: 'Delete all AIOManager data?',
                            description: 'This clears local storage, IndexedDB, accounts, saved addons, vault keys, settings, and attempts to remove the sync account from the server before reloading the app.',
                            confirmText: 'Delete All Data',
                            action: executeResetAll,
                        })}
                        disabled={!unsafeMode || isRunning}
                    >
                        <ShieldAlert className="h-4 w-4" />
                        Delete All Data
                    </Button>
                </div>
            </div>
            </div>
            <ConfirmationDialog
                open={!!pendingAction}
                onOpenChange={(open) => {
                    if (!open && !isRunning) setPendingAction(null)
                }}
                title={pendingAction?.title || 'Confirm destructive action'}
                description={pendingAction?.description || ''}
                confirmText={pendingAction?.confirmText || 'Confirm'}
                cancelText="Keep Data"
                isDestructive
                isLoading={isRunning}
                onConfirm={confirmDangerAction}
            />
        </>
    )
}
