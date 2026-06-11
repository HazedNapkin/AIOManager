import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CopyButton } from '@/components/ui/copy-button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { StatusChip } from '@/components/ui/status-chip'
import { StremioAccount } from '@/types/account'
import { useAccountStore, persistAccounts } from '@/store/accountStore'
import { toast } from '@/hooks/use-toast'
import { useState, memo } from 'react'
import { Key, RefreshCw, Eye, EyeOff } from 'lucide-react'

interface ApiKeyManagerProps {
    account: StremioAccount
}

export const ApiKeyManager = memo(function ApiKeyManager({ account }: ApiKeyManagerProps) {
    const [showKey, setShowKey] = useState(false)
    const [confirmRegenerate, setConfirmRegenerate] = useState(false)
    const apiKey = account.apiKey

    const handleRegenerateKey = () => {
        const newKey = crypto.randomUUID()
        const { accounts } = useAccountStore.getState()
        const updated = accounts.map(a =>
            a.id === account.id ? { ...a, apiKey: newKey } : a
        )
        useAccountStore.setState({ accounts: updated })
        persistAccounts(updated)
        setConfirmRegenerate(false)
        toast({ title: 'API key regenerated', description: 'Update any services using the old key.' })
    }

    if (!apiKey) return null

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
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
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
