import { Bell } from 'lucide-react'
import { SquircleOverlay } from '@/components/ui/squircle-overlay'

export function NotificationsSection() {
    return (
        <section className="space-y-4">
            <div className="space-y-5 rounded-[1.75rem] border border-border/45 bg-card/80 p-5 shadow-sm">
                <div className="flex items-start gap-4">
                    <div className="relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/35 bg-muted/25">
                        <SquircleOverlay />
                        <Bell className="relative z-10 h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                        <h2 className="text-base font-bold">Monitoring & Alerts</h2>
                        <p className="text-sm text-muted-foreground">
                            Webhook notifications are configured per Autopilot rule.
                        </p>
                    </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-border/35 bg-background/35 p-4">
                        <p className="text-sm font-semibold">Autopilot webhooks</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            Open an account, go to <span className="font-semibold text-foreground/80">Autopilot</span>, then configure the default webhook or per-rule overrides in the <span className="font-semibold text-foreground/80">Failover Manager</span>.
                        </p>
                    </div>
                    <div className="rounded-2xl border border-border/35 bg-background/35 p-4">
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
