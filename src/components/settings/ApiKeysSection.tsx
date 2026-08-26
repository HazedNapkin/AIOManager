import { memo, useState } from 'react'
import { Key, RefreshCw, Eye, EyeOff, AlertCircle, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { StatusChip } from '@/components/ui/status-chip'
import { SquircleOverlay } from '@/components/ui/squircle-overlay'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { Account } from '@/types/account'
import { useAccountStore, getAccountEmail, getStremioAuthKey } from '@/store/accountStore'
import { useSyncStore } from '@/store/syncStore'
import { useUIStore } from '@/store/uiStore'
import { isSplitBrainAccount } from '@/lib/canonical-visibility'
import { generateAccountApiKey, regenerateAccountApiKey } from '@/lib/account-api-key'
import { maskEmailLevel, maskNameLevel } from '@/lib/utils'

interface ApiKeyRowProps {
    account: Account
    isSplitBrain: boolean
}

const MASKED_BULLETS = '\u2022'.repeat(12)

const ApiKeyRow = memo(function ApiKeyRow({ account, isSplitBrain }: ApiKeyRowProps) {
    const [showKey, setShowKey] = useState(false)
    const [confirmRegenerate, setConfirmRegenerate] = useState(false)
    const isPrivacyMode = useUIStore(s => s.isPrivacyModeEnabled)
    const privacyLevelNames = useUIStore(s => s.privacyLevelNames)

    const apiKey = account.apiKey

    // Same identity rendering as AccountListRow: honor privacy masking levels.
    const accountEmail = getAccountEmail(account)
    const privacyLevel = isPrivacyMode ? privacyLevelNames : 0
    const isNameCustomized = account.name !== accountEmail && account.name !== 'Account' && account.name !== 'Stremio Account'
    const displayName = isNameCustomized
        ? maskNameLevel(account.name, privacyLevel)
        : account.name && account.name.includes('@')
            ? maskEmailLevel(account.name, privacyLevel)
            : maskNameLevel(account.name || accountEmail || 'Unnamed Account', privacyLevel)

    return (
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
                        onClick={() => generateAccountApiKey(account.id)}
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
                        onConfirm={() => {
                            regenerateAccountApiKey(account.id)
                            setConfirmRegenerate(false)
                        }}
                    />
                </>
            )}
        </div>
    )
})

export function ApiKeysSection() {
    const accounts = useAccountStore(s => s.accounts)
    const serverStremioCredentialedAccounts = useSyncStore(s => s.serverStremioCredentialedAccounts)
    const activeKeyCount = accounts.filter(a => a.apiKey).length

    return (
        <section className="space-y-4">
            <div className="space-y-4 sm:space-y-5 rounded-[1.5rem] sm:rounded-[1.75rem] border border-border/45 bg-card/80 p-3 sm:p-4 md:p-5 shadow-sm">
                <div className="flex items-start gap-3">
                    <div className="relative mt-0.5 flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-2xl border border-border/35 bg-muted/25">
                        <SquircleOverlay />
                        <Key className="relative z-10 h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-sm sm:text-base font-semibold">API Keys</h3>
                        <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
                            Per-account keys external services use with your AIOManager URL via the Hydra API.
                        </p>
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Accounts</p>
                        {activeKeyCount > 0 && (
                            <span className="rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-tighter text-primary">
                                {activeKeyCount} active
                            </span>
                        )}
                    </div>

                    {accounts.length === 0 ? (
                        <div className="flex items-start gap-2 rounded-2xl border border-dashed border-border/40 bg-background/30 p-3 text-xs text-muted-foreground">
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                            <span>No accounts yet. Add an account to generate its API key here.</span>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                            {accounts.map(account => (
                                <ApiKeyRow
                                    key={account.id}
                                    account={account}
                                    isSplitBrain={isSplitBrainAccount(account, !!getStremioAuthKey(account), serverStremioCredentialedAccounts)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </section>
    )
}
