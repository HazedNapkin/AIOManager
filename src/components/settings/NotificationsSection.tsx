import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, Bell } from 'lucide-react'
import { SquircleOverlay } from '@/components/ui/squircle-overlay'
import { Button } from '@/components/ui/button'
import { AccountSwitcher } from '@/components/common/AccountSwitcher'
import { getAccountEmail, useAccountStore } from '@/store/accountStore'

export function NotificationsSection() {
    const accounts = useAccountStore(state => state.accounts)
    const [accountId, setAccountId] = useState('')
    const navigate = useNavigate()
    const selectedAccount = accounts.length === 1 ? accounts[0] : accounts.find(account => account.id === accountId)

    return (
        <section className="space-y-4">
            <div data-theme-part="panel" className="space-y-5 rounded-[1.75rem] border border-border/45 bg-card/80 p-5 shadow-sm">
                <div className="flex items-start gap-4">
                    <div className="relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/35 bg-muted/25">
                        <SquircleOverlay />
                        <Bell className="relative z-10 h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                        <h2 className="text-base font-bold">Monitoring & Alerts</h2>
                        <p className="text-sm text-muted-foreground">Webhook notifications are configured per Autopilot rule.</p>
                    </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                    <div data-theme-part="card" className="rounded-2xl border border-border/35 bg-background/35 p-4">
                        <p className="text-sm font-semibold">Autopilot webhooks</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Set an account's default webhook or a notification for a specific rule.</p>
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                            {accounts.length > 1 && (
                                <div className="min-w-0 flex-1 [&>div>button]:w-full [&_button]:max-w-full">
                                    <AccountSwitcher
                                        mode="filter"
                                        accounts={accounts.map(account => ({ ...account, name: account.name || getAccountEmail(account) || 'Unnamed account', email: getAccountEmail(account) }))}
                                        selectedId={selectedAccount?.id ?? ''}
                                        onSelect={setAccountId}
                                        emptyLabel="Choose an account"
                                        ariaLabel="Account for Autopilot"
                                    />
                                </div>
                            )}
                            <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 text-xs" disabled={!selectedAccount} onClick={() => {
                                if (selectedAccount) navigate('/account/' + encodeURIComponent(selectedAccount.id) + '?tab=failover')
                            }}>
                                Open Autopilot<ArrowUpRight className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                        {accounts.length === 0 && <p className="mt-2 text-xs text-muted-foreground">Add an account to configure notifications.</p>}
                    </div>
                    <div data-theme-part="card" className="rounded-2xl border border-border/35 bg-background/35 p-4">
                        <p className="text-sm font-semibold">Auto-update addons</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            Addons update to the latest version when you return to the app, capped at once every 6 hours.
                        </p>
                    </div>
                </div>
            </div>
        </section>
    )
}
