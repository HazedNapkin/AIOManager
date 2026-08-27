import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { resolveDeviceName, subscribeDeviceNameRequest } from '@/lib/device-session'

// Mounted at the app root so the prompt survives the post-login navigation away from the login page.
export function DeviceNameDialog() {
    const [request, setRequest] = useState<{ defaultLabel: string } | null>(null)
    const [value, setValue] = useState('')
    const [busy, setBusy] = useState(false)

    useEffect(() => subscribeDeviceNameRequest(req => {
        setRequest(req ? { defaultLabel: req.defaultLabel } : null)
        setValue(req ? req.defaultLabel : '')
    }), [])

    const finish = (label: string | null) => {
        setBusy(true)
        resolveDeviceName(label)
        setBusy(false)
    }

    return (
        <Dialog open={!!request} onOpenChange={(open) => { if (!open && !busy) finish(null) }}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>Name this device</DialogTitle>
                    <DialogDescription>
                        Shows on the sign-in screen and in Settings under Remembered devices.
                    </DialogDescription>
                </DialogHeader>
                <Input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    maxLength={100}
                    placeholder="Chrome on Windows"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter' && value.trim() && !busy) { e.preventDefault(); finish(value) } }}
                />
                <div className="flex justify-end gap-2">
                    <Button variant="subtle" size="sm" onClick={() => finish(null)} disabled={busy}>
                        Skip
                    </Button>
                    <Button size="sm" onClick={() => finish(value)} disabled={busy || !value.trim()}>
                        {busy ? 'Saving' : 'Save and remember'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
