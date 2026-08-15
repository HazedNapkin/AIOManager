import { useState, useEffect } from 'react'
import { useSyncStore, savePasswordToSession } from '@/store/syncStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Rocket, Lock, Key, LogIn, RefreshCw, Eye, EyeOff, ShieldAlert } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { useTheme } from '@/contexts/ThemeContext'
import { useAuthStore } from '@/store/authStore'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { clearLocalAuthSecrets, restoreLocalAuthSecrets } from '@/lib/crypto'
import { apiGet } from '@/lib/http-client'

import { CopyButton } from '@/components/ui/copy-button'
import { useConfetti } from '@/components/ui/confetti'
import { BorderBeam } from '@/components/ui/border-beam'
import { TypingText } from '@/components/ui/typing-text'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { cn } from '@/lib/utils'
import pkg from '../../package.json'

interface LoginPageProps {
    initialMode?: 'login' | 'register'
}

export function LoginPage({ initialMode = 'login' }: LoginPageProps = {}) {
    useDocumentTitle('Login')
    const auth = useSyncStore(s => s.auth)
    const register = useSyncStore(s => s.register)
    const login = useSyncStore(s => s.login)
    const logout = useSyncStore(s => s.logout)
    const { isLocked, unlock } = useAuthStore()
    const { isLight, logoUrl } = useTheme()

    const confetti = useConfetti()
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()

    const [mode, setMode] = useState<'login' | 'register'>(initialMode)
    const [showPassword, setShowPassword] = useState(false)
    const [customHtml, setCustomHtml] = useState<string | null>(null)
    const [isUnlocking, setIsUnlocking] = useState(false)
    const [showSwitchConfirm, setShowSwitchConfirm] = useState(false)
    const [showRegSuccess, setShowRegSuccess] = useState(false)
    const [registeredId, setRegisteredId] = useState('')
    const [hasCopied, setHasCopied] = useState(false)

    const [loginId, setLoginId] = useState(auth.id || '')
    const [loginPass, setLoginPass] = useState('')

    const [regPass, setRegPass] = useState('')
    const [regPassConfirm, setRegPassConfirm] = useState('')
    const [isRegistering, setIsRegistering] = useState(false)

    const [loading, setLoading] = useState(false)
    const [loginError, setLoginError] = useState<string | null>(null)
    const [regError, setRegError] = useState<string | null>(null)
    const [registrationsClosed, setRegistrationsClosed] = useState(false)

    const passwordsMatch = regPass === regPassConfirm || !regPassConfirm
    const normalizedLoginError = loginError?.toLowerCase() ?? ''
    const notFoundError = normalizedLoginError.includes('not found')
    const sessionRestoreError = loginError ? /database is locked|vault is locked|session expired|app is not initialized|encryption metadata|unlock (?:the )?app/i.test(loginError) : false
    const passwordError = loginError ? /password|decrypt/i.test(loginError) && !sessionRestoreError : false

    useEffect(() => {
        apiGet<{ customHtml?: string; registrationsClosed?: boolean }>('/config')
            .then(data => {
                if (data?.customHtml) setCustomHtml(data.customHtml)
                setRegistrationsClosed(Boolean(data?.registrationsClosed))
            })
            .catch(() => {})
    }, [])

    useEffect(() => {
        if (registrationsClosed && mode === 'register') {
            setMode('login')
        }
    }, [registrationsClosed, mode])

    useEffect(() => {
        const idParam = searchParams.get('id')
        if (idParam) {
            setLoginId(idParam)
            setMode('login')
            toast({ title: "Account detected", description: "Enter your password to sign in." })
        }
    }, [searchParams])

    const handleRegister = async () => {
        if (!regPass) {
            toast({ variant: "destructive", title: "Password required", description: "Choose a password." })
            return
        }

        if (regPass.length < 8) {
            toast({ variant: "destructive", title: "Password too short", description: "Use at least 8 characters so your session can be restored reliably." })
            return
        }

        if (regPass !== regPassConfirm) {
            toast({ variant: "destructive", title: "Passwords do not match", description: "Enter the same password twice." })
            return
        }

        setIsRegistering(true)
        setRegError(null)
        try {
            await register(regPass)
            const newId = useSyncStore.getState().auth.id
            setRegisteredId(newId)
            setShowRegSuccess(true)
            confetti.fire({ particleCount: 80, spread: 70, origin: { x: 0.5, y: 0.4 } })
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Registration failed. Please try again.'
            if (msg.includes('Registrations are closed')) {
                setRegError('Registrations are closed on this instance.')
            } else {
                setRegError(msg)
            }
        } finally {
            setIsRegistering(false)
        }
    }

    const handleUnlock = async () => {
        if (!loginPass) {
            toast({ variant: "destructive", title: "Password required", description: "Enter your master password." })
            return
        }

        setIsUnlocking(true)
        setLoginError(null)

        try {
            const success = await unlock(loginPass)
            if (!success) {
                setLoginError('Invalid password')
            } else {
                if (auth.isAuthenticated && auth.id) {
                    savePasswordToSession(loginPass)
                    useSyncStore.setState(s => ({ auth: { ...s.auth, password: loginPass } }))
                }
                toast({ title: "Welcome back", description: "Signed in successfully." })
            }
        } catch (e) {
            const msg = (e as Error).message

            if (msg.includes('not initialized')) {
                if (import.meta.env.DEV) console.log('[Auth] Local DB empty. Attempting Cloud Restore...')
                try {
                    await login(auth.id, loginPass, true)
                    toast({ title: "Restored", description: "Session restored from cloud." })
                } catch (restoreErr) {
                    if (import.meta.env.DEV) console.error('[Auth] Cloud restore failed:', restoreErr)
                    setLoginError("This browser session could not be restored. Log in from your original browser to sync first.")
                }
            } else {
                setLoginError(msg)
                if (import.meta.env.DEV) console.error("Unlock error:", e)
            }
        } finally {
            setIsUnlocking(false)
        }
    }

    const handleLogin = async () => {
        if (!loginId || !loginPass) {
            toast({ variant: "destructive", title: "Missing credentials", description: "Enter your UUID and password." })
            return
        }

        setLoading(true)
        setLoginError(null)
        try {
            await login(loginId, loginPass)
        } catch (e) {
            setLoginError((e as Error).message)
            if (import.meta.env.DEV) console.error("Login error:", e)
        } finally {
            setLoading(false)
        }
    }

    const handleCloudRecoveryLogin = async () => {
        const effectiveId = loginId || auth.id
        if (!effectiveId || !loginPass) {
            toast({ variant: "destructive", title: "Missing credentials", description: "Enter your UUID and password." })
            return
        }

        setLoading(true)
        setLoginError(null)
        const localAuthBackup = clearLocalAuthSecrets()
        try {
            await login(effectiveId, loginPass, false, true)
            toast({ title: "Signed in", description: "This browser session was reset and your cloud data was restored." })
        } catch (e) {
            restoreLocalAuthSecrets(localAuthBackup)
            const msg = (e as Error).message
            console.error("Cloud recovery login error:", e)
            if (msg.includes("Encryption metadata") || msg.includes("Encryption Mismatch")) {
                setLoginError("Could not decrypt your cloud data with this password. Make sure you are using the correct UUID and password from when you registered.")
            } else {
                setLoginError(msg)
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4 animate-in fade-in duration-500">
            <div className="max-w-md w-full space-y-5">
                {customHtml && (
                    <div
                        className="custom-html-container"
                        dangerouslySetInnerHTML={{ __html: customHtml }}
                    />
                )}

                <div className="text-center space-y-4">
                    <div className="flex justify-center">
                        <div className="flex h-20 w-20 items-center justify-center">
                            <img
                                src={logoUrl || "/logo.png"}
                                alt="AIOManager"
                                loading="lazy"
                                onError={(e) => { if (e.currentTarget.src !== window.location.origin + '/logo.png') e.currentTarget.src = '/logo.png' }}
                                className={cn('h-20 w-20 object-contain', !logoUrl && isLight && 'invert')}
                            />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <h1 className="text-3xl font-bold tracking-tighter">AIOManager</h1>
                        <div className="text-sm text-muted-foreground">
                            <TypingText text="One manager to rule them all." delay={40} hideCursorOnComplete grow />
                        </div>
                    </div>
                </div>

                {!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && (
                    <div className="bg-destructive/10 border border-destructive/20 p-4 rounded-lg space-y-2 animate-in slide-in-from-top-2 duration-500">
                        <div className="flex items-center gap-2 text-sm text-destructive font-semibold">
                            <ShieldAlert className="h-5 w-5" />
                            <span>Secure connection required</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            AIOManager needs HTTPS for browser encryption and sync APIs. Use a reverse proxy or access it from <code>localhost</code>.
                        </p>
                        <div className="pt-1">
                            <a
                                href="https://github.com/Sonicx161/AIOManager#secure-context-https-required"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-destructive/80 hover:text-destructive underline flex items-center gap-1"
                            >
                                Open setup guide
                            </a>
                        </div>
                    </div>
                )}

                <Tabs value={mode} onValueChange={(v) => { setMode(v as 'login' | 'register'); setShowPassword(false); }} className="w-full">
                    {!registrationsClosed && (
                        <TabsList className="mb-4 grid w-full grid-cols-2">
                            <TabsTrigger value="login" className="h-8">Login</TabsTrigger>
                            <TabsTrigger value="register" className="h-8">New Account</TabsTrigger>
                        </TabsList>
                    )}

                    <TabsContent value="register">
                        <Card className="relative overflow-hidden border border-border/60 bg-card shadow-sm">
                            <BorderBeam duration={14} />
                            <CardHeader>
                                <CardTitle className="text-lg font-bold tracking-tight">Create account</CardTitle>
                                <CardDescription>Generate a private UUID for your encrypted workspace.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label className="text-xs font-medium text-muted-foreground uppercase">Account UUID</Label>
                                    <div className="p-3 bg-muted/20 rounded-lg border border-border/40 text-center">
                                        <p className="text-xs text-muted-foreground">
                                            A unique UUID will be generated automatically.
                                        </p>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs font-medium text-muted-foreground uppercase">Password</Label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            type={showPassword ? "text" : "password"}
                                            placeholder="••••••••"
                                            className={`h-11 pl-10 pr-12 ${regPass && regPass.length < 8 ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                                            autoComplete="new-password"
                                            value={regPass}
                                            onChange={(e) => setRegPass(e.target.value)}
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="absolute right-0 top-0 h-11 w-11 text-muted-foreground hover:text-foreground"
                                            onClick={() => setShowPassword(!showPassword)}
                                            aria-label={showPassword ? "Hide password" : "Show password"}
                                        >
                                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </Button>
                                    </div>
                                    {regPass && regPass.length < 8 && (
                                        <p className="text-xs text-destructive mt-1">At least 8 characters required ({regPass.length}/8)</p>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-xs font-medium text-muted-foreground uppercase">Confirm password</Label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            type={showPassword ? "text" : "password"}
                                            placeholder="••••••••"
                                            className={`h-11 pl-10 pr-12 ${!passwordsMatch ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                                            autoComplete="new-password"
                                            value={regPassConfirm}
                                            onChange={(e) => setRegPassConfirm(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="absolute right-0 top-0 h-11 w-11 text-muted-foreground hover:text-foreground"
                                            onClick={() => setShowPassword(!showPassword)}
                                            aria-label={showPassword ? "Hide password" : "Show password"}
                                        >
                                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </Button>
                                    </div>
                                    {!passwordsMatch && (
                                        <p className="text-xs text-destructive font-medium animate-in slide-in-from-top-1">
                                            Passwords do not match
                                        </p>
                                    )}
                                    <p className="text-xs text-muted-foreground pt-1">
                                        This password is the <strong>only key</strong> to your data. Do not lose it.
                                    </p>
                                </div>
                            </CardContent>
                            <CardFooter>
                                <Button className="w-full gap-2" size="xl" onClick={handleRegister} disabled={isRegistering || (regPass.length > 0 && regPass.length < 8) || !passwordsMatch}>
                                    {isRegistering ? (
                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Rocket className="h-4 w-4" />
                                    )}
                                    {isRegistering ? 'Creating account' : 'Create account'}
                                </Button>
                            </CardFooter>
                            {regError && (
                                <div className="px-6 pb-4">
                                    <p className="text-xs text-destructive font-medium animate-in slide-in-from-top-1">{regError}</p>
                                </div>
                            )}
                        </Card>
                    </TabsContent>

                    <TabsContent value="login">
                        <Card className="relative overflow-hidden border border-border/60 bg-card shadow-sm">
                            <BorderBeam duration={14} />
                            <CardHeader>
                                <CardTitle className="text-lg font-bold tracking-tight">Welcome Back</CardTitle>
                                <CardDescription className="text-foreground/80">
                                    {isLocked && auth.isAuthenticated
                                        ? 'Your session ended. Sign in again to continue.'
                                        : 'Enter your UUID and password to sign in.'}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label className="text-xs font-medium text-foreground/80 uppercase">UUID</Label>
                                    <div className="relative">
                                        <Key className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            placeholder="uuid-string..."
                                            className={`h-11 pl-10 font-mono text-sm ${notFoundError ? 'border-destructive' : ''}`}
                                            value={loginId}
                                            onChange={(e) => { setLoginId(e.target.value.trim()); setLoginError(null); }}
                                            onKeyDown={(e) => e.key === 'Enter' && (isLocked && auth.isAuthenticated ? handleUnlock() : handleLogin())}
                                            disabled={isLocked && auth.isAuthenticated}
                                            autoFocus
                                        />
                                    </div>
                                    {notFoundError && (
                                        <p className="text-xs text-destructive font-medium animate-in slide-in-from-top-1">
                                            We couldn't find an account with this UUID. Make sure you copied the entire string correctly.
                                        </p>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-xs font-medium text-foreground/80 uppercase">Password</Label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            type={showPassword ? "text" : "password"}
                                            placeholder="••••••••"
                                            className={`h-11 pl-10 pr-12 ${passwordError ? 'border-destructive' : ''}`}
                                            autoComplete="current-password"
                                            value={loginPass}
                                            onChange={(e) => { setLoginPass(e.target.value); setLoginError(null); }}
                                            onKeyDown={(e) => e.key === 'Enter' && (isLocked && auth.isAuthenticated ? handleUnlock() : handleLogin())}
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="absolute right-0 top-0 h-11 w-11 text-muted-foreground hover:text-foreground"
                                            onClick={() => setShowPassword(!showPassword)}
                                            aria-label={showPassword ? "Hide password" : "Show password"}
                                        >
                                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </Button>
                                    </div>
                                    {passwordError && (
                                        <p className="text-xs text-destructive font-medium animate-in slide-in-from-top-1">
                                            The password you entered is incorrect. Try again or check your Caps Lock.
                                        </p>
                                    )}
                                    {loginError && !notFoundError && !passwordError && !sessionRestoreError && (
                                        <p className="text-xs text-destructive font-medium animate-in slide-in-from-top-1">
                                            {loginError === 'Server error, try again later.'
                                                ? 'Something went wrong on our end. Wait a moment and try again.'
                                                : loginError}
                                        </p>
                                    )}
                                    {sessionRestoreError && (
                                        <div className="rounded-lg border border-warning/25 bg-warning/10 p-3 text-xs text-warning space-y-2 animate-in slide-in-from-top-1">
                                            <p className="font-medium">This browser session could not be restored.</p>
                                            <p className="text-warning/90">Sign in from cloud with this UUID/password to continue.</p>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="h-8 w-full border-warning/30 bg-background/60 text-warning hover:bg-warning/10"
                                                onClick={handleCloudRecoveryLogin}
                                                disabled={loading || isUnlocking}
                                            >
                                                Sign in from cloud
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                            <CardFooter className="flex flex-col gap-3">
                                <Button
                                    className="w-full gap-2"
                                    size="xl"
                                    variant="default"
                                    onClick={isLocked && auth.isAuthenticated ? handleUnlock : handleLogin}
                                    disabled={loading || isUnlocking}
                                >
                                    {loading || isUnlocking ? (
                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <LogIn className="h-4 w-4" />
                                    )}
                                    {loading || isUnlocking ? 'Signing in' : 'Login'}
                                </Button>

                                {isLocked && auth.isAuthenticated && (
                                    <Button
                                        variant="link"
                                        className="text-xs text-foreground/80"
                                        onClick={() => setShowSwitchConfirm(true)}
                                    >
                                        Switch account
                                    </Button>
                                )}
                            </CardFooter>
                        </Card>
                    </TabsContent>
                </Tabs>

                {registrationsClosed && (
                    <p className="mt-4 text-center text-sm text-muted-foreground">Registrations are closed on this instance.</p>
                )}

                <ConfirmationDialog
                    open={showSwitchConfirm}
                    onOpenChange={setShowSwitchConfirm}
                    title="Switch account?"
                    description="Clear the local session and switch accounts?"
                    confirmText="Switch"
                    cancelText="Cancel"
                    isDestructive={true}
                    onConfirm={async () => {
                        await logout()
                        window.location.reload()
                    }}
                />

                <Dialog open={showRegSuccess} onOpenChange={(open) => { if (!open) setShowRegSuccess(false) }}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <div className="flex justify-center mb-4">
                                <div className="h-12 w-12 rounded-full bg-success/10 flex items-center justify-center">
                                    <Rocket className="h-6 w-6 text-success" />
                                </div>
                            </div>
                            <DialogTitle className="text-center">Account created</DialogTitle>
                            <DialogDescription className="text-center pt-2">
                                Save this UUID. It is the only way to sign in again.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label className="text-xs font-medium text-muted-foreground uppercase">Account UUID</Label>
                                <div className="relative group">
                                    <div className="p-4 bg-success/10 rounded-lg border border-success/20 flex items-center justify-between gap-3 group-hover:border-success/40 transition-colors">
                                        <code className="text-sm font-mono font-bold break-all text-success">
                                            {registeredId}
                                        </code>
                                        <CopyButton
                                            value={registeredId}
                                            className="shrink-0 h-10 w-10"
                                            iconSize={16}
                                            onCopied={() => setHasCopied(true)}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 space-y-2">
                                <div className="flex items-center gap-2 text-warning font-semibold text-xs uppercase">
                                    <ShieldAlert className="h-4 w-4" />
                                    No password reset
                                </div>
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                    AIOManager does not store your password. If you lose this UUID or password, the encrypted data cannot be recovered.
                                </p>
                            </div>
                        </div>

                        <DialogFooter className="sm:justify-center flex-col gap-2">
                            <Button
                                className="w-full font-semibold"
                                size="xl"
                                onClick={() => navigate('/')}
                                disabled={!hasCopied}
                            >
                                Enter dashboard
                            </Button>
                            {!hasCopied && (
                                <p className="text-xs text-muted-foreground text-center">Copy your UUID above before continuing.</p>
                            )}
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <div className="text-center mt-4">
                    <Link
                        to="/kronorium"
                        className="text-xs text-muted-foreground hover:text-primary transition-colors"
                    >
                        Read the Kronorium →
                    </Link>
                </div>

                <p className="text-center text-xs text-muted-foreground font-mono">
                    v{pkg.version}{(pkg as Record<string, unknown>).build ? ` · Build ${(pkg as Record<string, unknown>).build}` : ''}
                </p>
            </div>
        </div>
    )
}
