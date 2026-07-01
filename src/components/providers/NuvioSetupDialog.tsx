import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatusChip } from '@/components/ui/status-chip'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { nuvioAuth, nuvioSignup } from '@/api/hydra-providers'
import {
    Check,
    Loader2,
    AlertCircle,
    Mail,
    Lock,
} from 'lucide-react'
import { useState, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

type WizardStep = 'login' | 'profile' | 'confirm'

interface NuvioProfile {
    id: string
    name: string
    avatarColorHex?: string
    avatarId?: number
    usesPrimaryAddons?: boolean
}

export interface NuvioBackend {
    baseUrl?: string
    publishableKey?: string
}

interface NuvioSetupDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onComplete: (tokens: NuvioTokens, profileId: string | null, profiles: NuvioProfile[], email: string, backend: NuvioBackend) => void | Promise<void>
}

interface NuvioTokens {
    accessToken: string
    refreshToken: string
    expiresAt: number
}

const STEP_INDICATORS = [
    { step: 'login' as const, label: 'Login' },
    { step: 'profile' as const, label: 'Profile' },
    { step: 'confirm' as const, label: 'Confirm' },
]

export function NuvioSetupDialog({ open, onOpenChange, onComplete }: NuvioSetupDialogProps) {
    const [step, setStep] = useState<WizardStep>('login')
    const [mode, setMode] = useState<'login' | 'signup'>('login')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')

    const [showAdvanced, setShowAdvanced] = useState(false)
    const [customBaseUrl, setCustomBaseUrl] = useState('')
    const [customPublishableKey, setCustomPublishableKey] = useState('')

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [tokens, setTokens] = useState<NuvioTokens | null>(null)
    const [profiles, setProfiles] = useState<NuvioProfile[]>([])
    const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)

    const reset = useCallback(() => {
        setStep('login')
        setEmail('')
        setPassword('')
        setShowAdvanced(false)
        setCustomBaseUrl('')
        setCustomPublishableKey('')
        setLoading(false)
        setError(null)
        setTokens(null)
        setProfiles([])
        setSelectedProfileId(null)
    }, [])

    const backend = (): NuvioBackend => ({
        baseUrl: customBaseUrl.trim() || undefined,
        publishableKey: customPublishableKey.trim() || undefined,
    })

    const handleClose = (nextOpen: boolean) => {
        if (!nextOpen) reset()
        onOpenChange(nextOpen)
    }

    const handleLogin = async () => {
        setLoading(true)
        setError(null)
        try {
            const b = backend()
            const result = mode === 'signup'
                ? await nuvioSignup(email, password, b.publishableKey, b.baseUrl)
                : await nuvioAuth(email, password, b.publishableKey, b.baseUrl)
            const t = result.tokens
            if (!t) {
                setMode('login')
                setError('Check your email to confirm your Nuvio account, then sign in.')
                return
            }
            setTokens(t)
            const p = result.profiles || []
            setProfiles(p)

            if (p.length <= 1) {
                setSelectedProfileId(p[0]?.id || null)
                setStep('confirm')
            } else {
                setStep('profile')
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Login failed')
        } finally {
            setLoading(false)
        }
    }

    const handleFinish = async () => {
        if (!tokens) return
        try {
            await onComplete(tokens, selectedProfileId, profiles, email, backend())
        } catch (e) {
            toast({ title: 'Setup failed', description: e instanceof Error ? e.message : 'Failed to configure provider', variant: 'destructive' })
        }
        handleClose(false)
    }

    const stepIndex = STEP_INDICATORS.findIndex(s => s.step === step)
    const emailValid = email.includes('@')
    const passwordValid = password.length > 0

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Connect Nuvio</DialogTitle>
                    <DialogDescription>
                        Sign in to your Nuvio account to sync addons and plugins.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-center gap-2 mt-2">
                    {STEP_INDICATORS.map((s, i) => {
                        const active = s.step === step
                        const done = i < stepIndex
                        return (
                            <div key={s.step} className="flex items-center gap-2 flex-1">
                                <div
                                    className={cn(
                                        'flex items-center justify-center h-7 w-7 rounded-full text-xs font-bold shrink-0 transition-colors',
                                        active ? 'bg-primary text-primary-foreground' :
                                        done ? 'bg-success/20 text-success' :
                                        'bg-muted text-muted-foreground'
                                    )}
                                >
                                    {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                                </div>
                                <span className={cn(
                                    'text-xs font-medium truncate',
                                    active ? 'text-foreground' : 'text-muted-foreground'
                                )}>
                                    {s.label}
                                </span>
                                {i < STEP_INDICATORS.length - 1 && (
                                    <div className={cn(
                                        'flex-1 h-px',
                                        done ? 'bg-success/40' : 'bg-border'
                                    )} />
                                )}
                            </div>
                        )
                    })}
                </div>

                <div className="min-h-[200px]">
                    {step === 'login' && (
                        <div className="space-y-4 mt-2">
                            <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/40 p-1">
                                <button type="button" onClick={() => { setMode('login'); setError(null) }} className={cn('h-8 rounded-lg text-xs font-semibold transition-colors', mode === 'login' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>Sign In</button>
                                <button type="button" onClick={() => { setMode('signup'); setError(null) }} className={cn('h-8 rounded-lg text-xs font-semibold transition-colors', mode === 'signup' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>Create Account</button>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="nuvio-email">Email</Label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="nuvio-email"
                                        type="email"
                                        placeholder="you@example.com"
                                        value={email}
                                        onChange={e => setEmail(e.target.value)}
                                        className="pl-10"
                                        autoFocus
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="nuvio-password">Password</Label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="nuvio-password"
                                        type="password"
                                        placeholder="Your Nuvio password"
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        className="pl-10"
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && emailValid && passwordValid) handleLogin()
                                        }}
                                    />
                                </div>
                            </div>

                            <div className="pt-1">
                                <button
                                    type="button"
                                    onClick={() => setShowAdvanced(v => !v)}
                                    className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    {showAdvanced ? 'Hide' : 'Use a custom backend'}
                                </button>
                            </div>

                            {showAdvanced && (
                                <div className="space-y-3 rounded-xl border border-border/40 bg-muted/20 p-3">
                                    <p className="text-xs text-muted-foreground">
                                        Point this connection at a self-hosted or alternate Nuvio backend. Leave blank to use the default.
                                    </p>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="nuvio-base-url" className="text-xs">Backend URL</Label>
                                        <Input
                                            id="nuvio-base-url"
                                            type="url"
                                            placeholder="https://your-backend.example.com"
                                            value={customBaseUrl}
                                            onChange={e => setCustomBaseUrl(e.target.value)}
                                            className="h-9 text-sm"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="nuvio-publishable-key" className="text-xs">Publishable key</Label>
                                        <Input
                                            id="nuvio-publishable-key"
                                            type="text"
                                            placeholder="sb_publishable_..."
                                            value={customPublishableKey}
                                            onChange={e => setCustomPublishableKey(e.target.value)}
                                            className="h-9 text-sm"
                                        />
                                    </div>
                                </div>
                            )}

                            {error && (
                                <div className="rounded-xl bg-destructive/5 border border-destructive/20 px-3 py-2 text-xs text-destructive flex items-center gap-2">
                                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                    {error}
                                </div>
                            )}
                        </div>
                    )}

                    {step === 'profile' && (
                        <div className="space-y-3 mt-2">
                            <p className="text-sm text-muted-foreground">Select which Nuvio profile to sync addons with.</p>
                            <div className="grid gap-2">
                                {profiles.map(profile => (
                                    <button
                                        key={profile.id}
                                        className={cn(
                                            'flex items-center gap-3 rounded-2xl border p-4 text-left transition-colors',
                                            selectedProfileId === profile.id
                                                ? 'border-primary/50 bg-primary/5'
                                                : 'border-border/40 bg-card hover:bg-accent/50'
                                        )}
                                        onClick={() => setSelectedProfileId(profile.id)}
                                    >
                                        <div
                                            className="h-9 w-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                                            style={{ backgroundColor: profile.avatarColorHex || '#6366f1' }}
                                        >
                                            {(profile.name || '?')[0].toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold truncate">{profile.name}</p>
                                            {profile.usesPrimaryAddons && (
                                                <p className="text-xs text-muted-foreground">Uses primary addons</p>
                                            )}
                                        </div>
                                        {selectedProfileId === profile.id && (
                                            <Check className="h-4 w-4 text-primary ml-auto shrink-0" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {step === 'confirm' && (
                        <div className="space-y-4 mt-2">
                            <p className="text-sm text-muted-foreground">Review your Nuvio connection before adding.</p>

                            <div className="rounded-2xl border border-border/40 bg-card p-4 space-y-3">
                                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                                    <span className="text-muted-foreground">Account</span>
                                    <span className="font-medium truncate">{email}</span>
                                    <span className="text-muted-foreground">Profile</span>
                                    <span className="font-medium truncate">
                                        {selectedProfileId
                                            ? profiles.find(p => p.id === selectedProfileId)?.name || 'Default'
                                            : 'Default'}
                                    </span>
                                </div>

                                {profiles.length > 1 && selectedProfileId && (
                                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/40">
                                        {profiles.filter(p => p.id === selectedProfileId).map(p => (
                                            <StatusChip key={p.id} size="sm" className="text-xs h-5 px-2 bg-muted/50">
                                                {p.name}
                                            </StatusChip>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="rounded-xl bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-warning flex items-start gap-2">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                <span>Your Nuvio password is never stored. Only the session token is stored encrypted on your sync server.</span>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    {step !== 'login' && (
                        <Button
                            variant="subtle"
                            onClick={() => {
                                if (step === 'confirm') setStep(profiles.length > 1 ? 'profile' : 'login')
                                else if (step === 'profile') setStep('login')
                            }}
                            disabled={loading}
                        >
                            Back
                        </Button>
                    )}

                    <div className="flex-1" />

                    {step === 'login' && (
                        <>
                            <Button variant="subtle" onClick={() => handleClose(false)}>Cancel</Button>
                            <Button
                                onClick={handleLogin}
                                disabled={!emailValid || !passwordValid || loading}
                            >
                                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                                {loading ? (mode === 'signup' ? 'Creating...' : 'Signing in...') : (mode === 'signup' ? 'Create Account' : 'Sign In')}
                            </Button>
                        </>
                    )}

                    {step === 'profile' && (
                        <>
                            <Button variant="subtle" onClick={() => handleClose(false)}>Cancel</Button>
                            <Button
                                onClick={() => setStep('confirm')}
                                disabled={!selectedProfileId && profiles.length > 0}
                            >
                                Next
                            </Button>
                        </>
                    )}

                    {step === 'confirm' && (
                        <Button
                            onClick={handleFinish}
                        >
                            Add Connection
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
