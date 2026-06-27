import { useEffect, useState } from 'react'
import { MonitorDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SquircleOverlay } from '@/components/ui/squircle-overlay'
import { canInstall, subscribeInstall, promptInstall } from '@/lib/pwa'

export function InstallAppCard() {
    const [installable, setInstallable] = useState(canInstall())

    useEffect(() => subscribeInstall(setInstallable), [])

    if (!installable) return null

    return (
        <div className="flex flex-col gap-3 sm:gap-4 rounded-[1.75rem] border border-border/45 bg-card/80 p-4 sm:p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
                <div className="relative flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-2xl border border-border/35 bg-muted/25">
                    <SquircleOverlay />
                    <MonitorDown className="relative z-10 h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                    <Label className="text-sm sm:text-base font-medium">Install App</Label>
                    <p className="text-xs sm:text-sm text-muted-foreground">Add AIOManager to your device for an app-like window</p>
                </div>
            </div>
            <Button variant="outline" onClick={() => { promptInstall() }} className="gap-2 self-start sm:self-auto">
                <MonitorDown className="h-4 w-4" />
                Install
            </Button>
        </div>
    )
}
