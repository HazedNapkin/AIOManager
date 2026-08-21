import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, ExternalLink, AlertCircle, Facebook } from 'lucide-react'

function AppleLogo({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 384 512" fill="currentColor" className={className} aria-hidden="true">
            <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
        </svg>
    )
}
import { stremioClient } from '@/api/stremio-client'
import { generateRelayState, facebookRelayUrl, appleRelayUrl, pollFacebookRelay, pollAppleRelay } from '@/api/stremio-relay'

type SocialProvider = 'facebook' | 'apple'

interface StremioSocialAuthProps {
    onAuthKey: (authKey: string, user?: { email?: string; name?: string }) => void
    onError?: (message: string) => void
    disabled?: boolean
}

export function StremioSocialAuth({ onAuthKey, onError, disabled }: StremioSocialAuthProps) {
    const [pending, setPending] = useState<SocialProvider | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [manualUrl, setManualUrl] = useState<string | null>(null)
    const abortRef = useRef<AbortController | null>(null)

    useEffect(() => () => abortRef.current?.abort(), [])

    const stop = useCallback(() => {
        abortRef.current?.abort()
        abortRef.current = null
        setPending(null)
        setManualUrl(null)
        setError(null)
    }, [])

    const start = useCallback(async (provider: SocialProvider) => {
        if (disabled || pending) return
        const state = generateRelayState()
        const relayUrl = provider === 'facebook' ? facebookRelayUrl(state) : appleRelayUrl(state)
        setError(null)
        setManualUrl(null)

        const controller = new AbortController()
        abortRef.current = controller

        const popup = window.open(relayUrl, '_blank')
        if (popup) {
            try { popup.opener = null } catch { /* cross-origin opener cut is best-effort */ }
        } else {
            setManualUrl(relayUrl)
        }
        setPending(provider)

        try {
            let authKey: string
            let email: string | undefined
            let name: string | undefined
            if (provider === 'facebook') {
                const account = await pollFacebookRelay(state, { signal: controller.signal })
                const login = await stremioClient.authWithFacebook(account.fbLoginToken)
                authKey = login.authKey
                email = account.email || login.user.email || undefined
            } else {
                const account = await pollAppleRelay(state, { signal: controller.signal })
                const login = await stremioClient.authWithApple({ token: account.token, sub: account.sub, email: account.email, name: account.name })
                authKey = login.authKey
                email = account.email || login.user.email || undefined
                name = account.name || undefined
            }
            if (controller.signal.aborted) return
            abortRef.current = null
            setPending(null)
            setManualUrl(null)
            onAuthKey(authKey, { email, name })
        } catch (err) {
            if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
                if (abortRef.current === controller) {
                    abortRef.current = null
                    setPending(null)
                    setManualUrl(null)
                    setError(null)
                }
                return
            }
            const message = err instanceof Error ? err.message : 'Login failed'
            setError(message)
            onError?.(message)
            setPending(null)
        }
    }, [disabled, pending, onAuthKey, onError])

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border/60" />
                <span className="text-xs text-muted-foreground">or continue with</span>
                <div className="h-px flex-1 bg-border/60" />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
                <Button
                    type="button"
                    onClick={() => start('facebook')}
                    disabled={disabled || !!pending}
                    className="h-11 gap-2 rounded-xl bg-[#1877F2] text-white shadow-sm hover:bg-[#1877F2]/90 hover:text-white"
                >
                    {pending === 'facebook' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Facebook className="h-4 w-4" />}
                    {pending === 'facebook' ? 'Waiting for Facebook...' : 'Continue with Facebook'}
                </Button>
                <Button
                    type="button"
                    onClick={() => start('apple')}
                    disabled={disabled || !!pending}
                    className="h-11 gap-2 rounded-xl bg-foreground text-background shadow-sm hover:bg-foreground/90 hover:text-background"
                >
                    {pending === 'apple' ? <Loader2 className="h-4 w-4 animate-spin" /> : <AppleLogo className="h-4 w-4" />}
                    {pending === 'apple' ? 'Waiting for Apple...' : 'Continue with Apple'}
                </Button>
            </div>

            {pending && (
                <div className="flex flex-col items-center gap-1.5 py-1">
                    <span className="text-xs text-muted-foreground italic">
                        Complete the {pending === 'facebook' ? 'Facebook' : 'Apple'} login in the window that opened...
                    </span>
                    <button type="button" onClick={stop} className="text-xs text-primary hover:underline">
                        Cancel
                    </button>
                </div>
            )}

            {manualUrl && (
                <div className="rounded-md border border-warning/25 bg-warning/10 p-3 text-xs text-warning">
                    <p className="font-medium">Popup blocked</p>
                    <p className="mt-1 text-warning/85">
                        Open the login page manually:{' '}
                        <a
                            href={manualUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-medium underline"
                        >
                            Continue with {pending === 'apple' ? 'Apple' : 'Facebook'}
                            <ExternalLink className="h-3 w-3" />
                        </a>
                    </p>
                </div>
            )}

            {error && (
                <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 flex items-start gap-2 text-xs text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <p>{error}</p>
                </div>
            )}
        </div>
    )
}
