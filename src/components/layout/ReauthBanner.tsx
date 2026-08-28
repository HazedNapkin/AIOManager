import { CloudOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/store/authStore'
import { useSyncStore } from '@/store/syncStore'

export function ReauthBanner() {
    const needsReauth = useSyncStore(s => s.needsReauth)
    const isAuthenticated = useSyncStore(s => s.auth.isAuthenticated)
    if (!needsReauth || !isAuthenticated) return null

    const reconnect = () => {
        useAuthStore.getState().lock()
    }

    return (
        <div className="bg-destructive/12 border-b border-destructive/30">
            <div className="max-w-[1800px] mx-auto w-full px-4 py-3 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-destructive/15 flex items-center justify-center shrink-0">
                        <CloudOff className="h-5 w-5 text-destructive" />
                    </div>
                    <div className="space-y-0.5">
                        <p className="text-sm font-semibold">
                            Sync is paused
                        </p>
                        <p className="text-xs text-muted-foreground leading-tight max-w-md">
                            This device lost its secure session, so changes are no longer syncing to the cloud. Your data is safe locally. Reconnect to resume syncing.
                        </p>
                    </div>
                </div>

                <Button size="sm" variant="destructive" onClick={reconnect} className="shrink-0">
                    Reconnect
                </Button>
            </div>
        </div>
    )
}
