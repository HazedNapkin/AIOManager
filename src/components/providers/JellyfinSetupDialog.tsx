import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { JellyfinClient, type JellyfinSession } from '@/lib/jellyfin/session'

interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    onComplete: (session: JellyfinSession) => Promise<void>
}

// Fictitious sample values only — never a real user's name, password or server.
function Example({ children }: { children: string }) {
    return <span className="rounded border border-border/40 bg-muted px-1 py-0.5 font-mono text-[10px]">{children}</span>
}

function CredentialHelp() {
    const [open, setOpen] = useState(true)
    return (
        <div data-theme-part="panel" className="rounded-xl border border-border/30 bg-muted/20">
            <button
                type="button"
                data-theme-part="button"
                aria-expanded={open}
                onClick={() => setOpen(value => !value)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
            >
                <span className="text-xs font-semibold">Which username and password?</span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    Examples for each app
                    <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
                </span>
            </button>
            {open && (
                <div className="space-y-2.5 border-t border-border/30 px-3 py-3">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        Use the credentials for your media server, not your AIOManager vault password. The examples below are fictitious. Saving links the verified server user to the AIOManager account you are editing. Only the server address and session token are saved encrypted; your password is never saved.
                    </p>
                    <ul className="space-y-2 text-xs leading-relaxed text-muted-foreground">
                        <li>
                            <span className="font-medium text-foreground">Jellyfin server:</span> a user account created in your server's dashboard under Users. Example: username <Example>sam</Example>, password <Example>matinee-tuesday-52</Example>. Leave the password blank only if that Jellyfin user has none. <a href="https://jellyfin.org/docs/general/server/users/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Official user guide</a>
                        </li>
                        <li>
                            <span className="font-medium text-foreground">AIOStreams:</span> open <strong className="font-medium text-foreground">Save &amp; Install → Jellyfin apps → Connect</strong>. With its plain Server address, such as <Example>https://aiostreams.example.com/jellyfin</Example>, enter the displayed configuration UUID or alias, for example <Example>media-room</Example>, or <Example>media-room/sam</Example> for a household user. If you copied the full sign-in-picker address instead, keep it intact and enter the user's name, for example <Example>sam</Example>. Use your configuration password, adding <Example>/PIN</Example> for a user with a PIN, for example <Example>bright-falcon-77/4821</Example>. <a href="https://docs.aiostreams.viren070.me/apps/jellyfin/#what-to-type-at-a-glance" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">What to type, at a glance</a>
                        </li>
                        <li>
                            <span className="font-medium text-foreground">AIOMetadata:</span> open your configuration, save, then click <strong className="font-medium text-foreground">Jellyfin</strong> next to Install. Copy its full server address, such as <Example>https://aiometa.example.com/jellyfin/1a2b3c</Example>. Enter a username from that configuration's client sign-in list — example <Example>alex</Example> — and your configuration password or the separate client password from the Jellyfin dialog, for example <Example>quiet-orbit-64</Example>. <a href="https://github.com/cedya77/aiometadata/blob/dev/docs/jellyfin.md" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Official Jellyfin guide</a>
                        </li>
                    </ul>
                </div>
            )}
        </div>
    )
}

export function JellyfinSetupDialog({ open, onOpenChange, onComplete }: Props) {
    const [baseUrl, setBaseUrl] = useState('')
    const [method, setMethod] = useState<'password' | 'token'>('password')
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [accessToken, setAccessToken] = useState('')
    const [userId, setUserId] = useState('')
    const [session, setSession] = useState<JellyfinSession | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const running = useRef(false)
    const request = useRef<AbortController | null>(null)
    useEffect(() => () => { request.current?.abort() }, [])

    const close = (value: boolean) => {
        if (running.current) return
        if (!value) {
            setBaseUrl(''); setUsername(''); setPassword(''); setAccessToken(''); setUserId('')
            setSession(null); setError(''); setMethod('password')
        }
        onOpenChange(value)
    }
    const submit = async () => {
        if (running.current) return
        running.current = true; setBusy(true); setError('')
        const controller = new AbortController()
        request.current = controller
        try {
            if (session) {
                await onComplete(session)
                running.current = false
                close(false)
            } else {
                const result = await new JellyfinClient(baseUrl, crypto.randomUUID()).signIn({ baseUrl, method, username, password, accessToken, userId }, controller.signal)
                controller.signal.throwIfAborted()
                setPassword(''); setAccessToken(''); setSession(result)
            }
        } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not connect') }
        finally { request.current = null; running.current = false; if (!controller.signal.aborted) setBusy(false) }
    }

    const verifiedServerName = session?.identity.serverName?.trim()
    const distinctVerifiedServerName = verifiedServerName && verifiedServerName !== session?.identity.productName ? verifiedServerName : ''

    return <Dialog open={open} onOpenChange={close}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Jellyfin, AIOStreams, AIOMetadata &amp; more</DialogTitle>
                <DialogDescription>Connect a server that supports the Jellyfin API. Available features depend on the server.</DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit() }}>
                {session ? <div className="space-y-2 text-sm">
                    <p className="font-medium">{session.identity.productName}</p>
                    {distinctVerifiedServerName && <p className="break-words text-muted-foreground">{distinctVerifiedServerName}</p>}
                    <p>Remote user: {session.identity.userName}</p>
                    <p className="break-all font-mono text-xs text-muted-foreground">User ID: {session.identity.userId}</p>
                    <p className="text-muted-foreground">Confirm this is the user whose media you want to read. The server address and token are saved encrypted. Your password is never saved.</p>
                </div> : <fieldset disabled={busy} className="space-y-3">
                    <div className="space-y-1"><Label htmlFor="jf-address">Full server address</Label><Input id="jf-address" type="url" required value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://server.example/jellyfin" autoComplete="off" /></div>
                    <p className="text-xs text-muted-foreground">Keep the complete configuration path supplied by your server. Sign-in runs directly in your browser.</p>
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Sign-in method">
                        <Button type="button" variant={method === 'password' ? 'default' : 'outline'} onClick={() => setMethod('password')}>Username &amp; password</Button>
                        <Button type="button" variant={method === 'token' ? 'default' : 'outline'} onClick={() => setMethod('token')}>Token / API key</Button>
                    </div>
                    {method === 'password' ? <>
                        <div className="space-y-1"><Label htmlFor="jf-username">Server username</Label><Input id="jf-username" required value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. sam, media-room or media-room/sam" autoComplete="username" /></div>
                        <div className="space-y-1"><Label htmlFor="jf-password">Password</Label><Input id="jf-password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Blank if this user has none" autoComplete="current-password" /></div>
                    </> : <>
                        <div className="space-y-1"><Label htmlFor="jf-token">Session token or API key</Label><Input id="jf-token" type="password" required value={accessToken} onChange={e => setAccessToken(e.target.value)} autoComplete="off" /></div>
                        <div className="space-y-1"><Label htmlFor="jf-userid">Remote user ID (required for API keys)</Label><Input id="jf-userid" value={userId} onChange={e => setUserId(e.target.value)} autoComplete="off" /></div>
                        <p className="text-xs text-muted-foreground">Session tokens can identify their user automatically. For an API key, select a specific user by ID; AIOManager verifies that user before saving.</p>
                    </>}
                </fieldset>}
                {!session && <CredentialHelp />}
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <div className="flex justify-end gap-2">
                    {session && <Button type="button" variant="outline" disabled={busy} onClick={() => setSession(null)}>Back</Button>}
                    <Button type="button" variant="subtle" disabled={busy} onClick={() => close(false)}>Cancel</Button>
                    <Button type="submit" disabled={busy}>{busy ? session ? 'Saving…' : 'Connecting…' : session ? 'Save connection' : 'Verify sign-in'}</Button>
                </div>
            </form>
        </DialogContent>
    </Dialog>
}
