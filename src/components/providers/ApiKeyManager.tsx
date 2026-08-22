import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CopyButton } from '@/components/ui/copy-button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { StatusChip } from '@/components/ui/status-chip'
import { Account } from '@/types/account'
import { useAccountStore, persistAccounts, getStremioAuthKey } from '@/store/accountStore'
import { useSyncStore } from '@/store/syncStore'
import { isSplitBrainAccount } from '@/lib/canonical-visibility'
import { triggerSync } from '@/lib/sync-trigger'
import { toast } from '@/hooks/use-toast'
import { useState, memo, useEffect } from 'react'
import { Key, RefreshCw, Eye, EyeOff } from 'lucide-react'

interface ApiKeyManagerProps {
    account: Account
}

export const ApiKeyManager = memo(function ApiKeyManager({ account }: ApiKeyManagerProps) {
    const [showKey, setShowKey] = useState(false)
    const [confirmRegenerate, setConfirmRegenerate] = useState(false)
    const apiKey = account.apiKey
    const serverStremioCredentialedAccounts = useSyncStore(s => s.serverStremioCredentialedAccounts)
    const isSplitBrain = isSplitBrainAccount(account, !!getStremioAuthKey(account), serverStremioCredentialedAccounts)

    useEffect(() => {
        if (isSplitBrain) {
            console.warn(`[ApiKeyManager] Account ${account.id} is split-brain: API key active but no server-side Stremio credential — external Hydra writes only reach the server store until an AIOManager client syncs.`)
        }
    }, [isSplitBrain, account.id])

    const handleGenerateKey = () => {
        const newKey = crypto.randomUUID()
        const { accounts } = useAccountStore.getState()
        const updated = accounts.map(a =>
            a.id === account.id ? { ...a, apiKey: newKey } : a
        )
        useAccountStore.setState({ accounts: updated })
        persistAccounts(updated)
        triggerSync()
        toast({ title: 'API key created', description: 'Use it with your AIOManager URL to connect external services via the Hydra API.' })
    }

    if (!apiKey) {
        return (
            <div className="bg-card/50 border border-border/40 rounded-2xl p-5 space-y-4 shadow-sm">
                <div>
                    <h3 className="flex items-center gap-2 text-lg font-bold">
                        <Key className="w-5 h-5 text-primary" />
                        API Key
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                        This account doesn't have an API key yet. Generate one to connect external services via the Hydra API.
                    </p>
                </div>
                <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={handleGenerateKey}
                >
                    <Key className="h-3.5 w-3.5" />
                    Generate API Key
                </Button>
            </div>
        )
    }

    const handleRegenerateKey = () => {
        const newKey = crypto.randomUUID()
        const { accounts } = useAccountStore.getState()
        const updated = accounts.map(a =>
            a.id === account.id ? { ...a, apiKey: newKey } : a
        )
        useAccountStore.setState({ accounts: updated })
        persistAccounts(updated)
        triggerSync()
        setConfirmRegenerate(false)
        toast({ title: 'API key regenerated', description: 'Update any services using the old key.' })
    }

    const maskedKey = `${apiKey.slice(0, 8)}${'\u00B7'.repeat(24)}${apiKey.slice(-4)}`

    return (
        <div className="bg-card/50 border border-border/40 rounded-2xl p-5 space-y-4 shadow-sm">
            <div>
                <h3 className="flex items-center gap-2 text-lg font-bold">
                    <Key className="w-5 h-5 text-primary" />
                    API Key
                </h3>
                <div className="flex items-center gap-2 mt-2">
                    <StatusChip variant="success" size="sm">
                        <span className="h-1.5 w-1.5 rounded-full bg-success" />
                        Active
                    </StatusChip>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                    Use this key with your AIOManager URL to connect external services via the Hydra API.
                </p>
            </div>

            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Input
                        readOnly
                        value={showKey ? apiKey : maskedKey}
                        className="h-9 font-mono text-xs bg-muted/30 border-border pr-10"
                    />
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center"
                        onClick={() => setShowKey(!showKey)}
                    >
                        {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                </div>
                <CopyButton value={apiKey} className="h-9 w-9 shrink-0" />
            </div>

            <div className="flex items-center gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs text-destructive hover:text-destructive"
                    onClick={() => setConfirmRegenerate(true)}
                >
                    <RefreshCw className="h-3 w-3" />
                    Regenerate Key
                </Button>
            </div>

            <ConfirmationDialog
                open={confirmRegenerate}
                onOpenChange={setConfirmRegenerate}
                title="Regenerate API Key?"
                description="This will invalidate the current key. Any services using it will lose access until updated with the new key."
                confirmText="Regenerate"
                isDestructive
                onConfirm={handleRegenerateKey}
            />
        </div>
    )
})
