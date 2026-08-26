import { useState, memo, useEffect } from 'react'
import { Key, RefreshCw, Eye, EyeOff, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { StatusChip } from '@/components/ui/status-chip'
import { SquircleOverlay } from '@/components/ui/squircle-overlay'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { Account } from '@/types/account'
import { getAccountEmail, getStremioAuthKey } from '@/store/accountStore'
import { useSyncStore } from '@/store/syncStore'
import { useUIStore } from '@/store/uiStore'
import { isSplitBrainAccount } from '@/lib/canonical-visibility'
import { generateAccountApiKey, regenerateAccountApiKey } from '@/lib/account-api-key'
import { maskEmailLevel, maskNameLevel } from '@/lib/utils'

interface ApiKeyManagerProps {
    account: Account
}

const MASKED_BULLETS = '\u2022'.repeat(12)

export const ApiKeyManager = memo(function ApiKeyManager({ account }: ApiKeyManagerProps) {
    const [showKey, setShowKey] = useState(false)
    const [confirmRegenerate, setConfirmRegenerate] = useState(false)
    const apiKey = account.apiKey
    const serverStremioCredentialedAccounts = useSyncStore(s => s.serverStremioCredentialedAccounts)
    const isSplitBrain = isSplitBrainAccount(account, !!getStremioAuthKey(account), serverStremioCredentialedAccounts)
    const isPrivacyMode = useUIStore(s => s.isPrivacyModeEnabled)
    const privacyLevelNames = useUIStore(s => s.privacyLevelNames)

    useEffect(() => {
        if (isSplitBrain) {
            console.warn(`[ApiKeyManager] Account ${account.id} is split-brain: API key active but no server-side Stremio credential — external Hydra writes only reach the server store until an AIOManager client syncs.`)
        }
    }, [isSplitBrain, account.id])

    const handleGenerateKey = () => {
        generateAccountApiKey(account.id)
    }

    const handleRegenerateKey = () => {
        regenerateAccountApiKey(account.id)
        setConfirmRegenerate(false)
    }

    // Same identity rendering as ApiKeysSection: honor privacy masking levels.
    const accountEmail = getAccountEmail(account)
    const privacyLevel = isPrivacyMode ? privacyLevelNames : 0
    const isNameCustomized = account.name !== accountEmail && account.name !== 'Account' && account.name !== 'Stremio Account'
    const displayName = isNameCustomized
        ? maskNameLevel(account.name, privacyLevel)
        : account.name && account.name.includes('@')
            ? maskEmailLevel(account.name, privacyLevel)
            : maskNameLevel(account.name || accountEmail || 'Unnamed Account', privacyLevel)

    return (
        <div className="space-y-3 sm:space-y-4 rounded-[1.5rem] sm:rounded-[1.75rem] border border-border/45 bg-card/80 p-3 sm:p-4 md:p-5 shadow-sm">
            <div className="flex items-start gap-3">
                <div className="relative mt-0.5 flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-2xl border border-border/35 bg-muted/25">
                    <SquircleOverlay />
                    <Key className="relative z-10 h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="text-sm sm:text-base font-semibold">API Key</h3>
                    <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
                        Backendless apps (e.g. Fusion) pull this account's addons using your AIOManager URL + API key via the Hydra API.
                    </p>
                </div>
            </div>

            <div className="rounded-2xl border border-border/35 bg-background/35 p-2.5 sm:p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                    <AccountAvatar account={account} size="sm" showStatus={false} />
                    <span className="min-w-0 flex-1 truncate text-xs font-bold">{displayName}</span>
                    {apiKey ? (
                        <StatusChip variant="success" size="sm">
                            <span className="h-1.5 w-1.5 rounded-full bg-success" />
                            Active
                        </StatusChip>
                    ) : (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 shrink-0 gap-1.5 text-xs font-semibold"
                            onClick={handleGenerateKey}
                        >
                            <Key className="h-3 w-3" />
                            Generate API Key
                        </Button>
                    )}
                </div>

                {apiKey && (
                    <>
                        <div className="flex items-center gap-1.5">
                            <div className="flex h-8 min-w-0 flex-1 items-center truncate rounded-lg border border-border/30 bg-muted/20 px-2 font-mono text-xs text-muted-foreground">
                                {showKey ? apiKey : `${MASKED_BULLETS}${apiKey.slice(-4)}`}
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                                onClick={() => setShowKey(!showKey)}
                                aria-label={showKey ? 'Hide API key' : 'Show API key'}
                            >
                                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </Button>
                            <CopyButton value={apiKey} className="h-8 w-8" />
                        </div>

                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-[10px] text-muted-foreground/70">
                                Use with your AIOManager URL to connect external services (Hydra API).
                            </p>
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full shrink-0 gap-1.5 text-xs text-destructive hover:text-destructive sm:w-auto"
                                onClick={() => setConfirmRegenerate(true)}
                            >
                                <RefreshCw className="h-3 w-3" />
                                Regenerate
                            </Button>
                        </div>

                        {isSplitBrain && (
                            <p className="flex items-start gap-1 text-[10px] font-medium text-destructive">
                                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                API key active but no server-side Stremio credential — external Hydra writes only reach the server store until an AIOManager client syncs.
                            </p>
                        )}

                        <ConfirmationDialog
                            open={confirmRegenerate}
                            onOpenChange={setConfirmRegenerate}
                            title="Regenerate API Key?"
                            description="This will invalidate the current key. Any services using it will lose access until updated with the new key."
                            confirmText="Regenerate"
                            isDestructive
                            onConfirm={handleRegenerateKey}
                        />
                    </>
                )}
            </div>
        </div>
    )
})
