import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatusChip } from '@/components/ui/status-chip'
import { ToolbarShell } from '@/components/ui/toolbar-shell'
import { Trash2, ArrowLeft, MoreVertical, Loader2, Zap, CheckCircle2, AlertCircle, Mail, Lock, Key, RefreshCw, Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { useConnectionStore } from '@/store/connectionStore'
import { useAccountStore, getStremioAuthKey, getCachedAuthKey, getEncryptionKey, getAccountEmail } from '@/store/accountStore'
import { stremioClient } from '@/api/stremio-client'
import { loginWithCredentials } from '@/api/auth'
import { nuvioAuth, realstreamAuth } from '@/api/hydra-providers'
import { fetchConnectionToken } from '@/api/connection'
import { encrypt } from '@/lib/crypto'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Connection, ConnectionStatus } from '@/types/connection'
import { PlatformLogo, ConnectionStatusPill, connectionLabel } from './ConnectionPrimitives'
import { displayStatus, tokenExpiry } from '@/lib/connection-format'
import { NuvioConnectionWorkspace } from './NuvioWorkspace'

const errMsg = (e: unknown, fallback = 'Try again.') => (e instanceof Error ? e.message : fallback)

function withTimeout<T>(promise: Promise<T>, ms = 10000): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error('Connection test timed out')), ms)
        )
    ])
}

function TestResultBanner({ result }: { result: { ok: boolean; message: string } | null }) {
    if (!result) return null
    return (
        <div className={cn(
            'flex items-center gap-2 rounded-xl border px-3 py-2 text-xs',
            result.ok
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'border-destructive/30 bg-destructive/10 text-destructive'
        )}>
            {result.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            <span className="truncate">{result.message}</span>
        </div>
    )
}

function SectionShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm space-y-3">
            <div className="min-w-0">
                <p className="text-sm font-semibold">{title}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            {children}
        </div>
    )
}

function StremioCredentialsSection({ accountId, connection }: { accountId: string; connection: Connection }) {
    const updateConnection = useConnectionStore(s => s.updateConnection)
    const account = useAccountStore(s => s.accounts.find(a => a.id === accountId))
    const [email, setEmail] = useState(connection.credentials?.email || (account ? getAccountEmail(account) || '' : ''))
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [newAuthKey, setNewAuthKey] = useState('')
    const [saving, setSaving] = useState(false)
    const [savingKey, setSavingKey] = useState(false)

    const emailValid = email.includes('@')
    const passwordValid = password.length > 0

    const handleReauth = async () => {
        if (!emailValid || !passwordValid) return
        setSaving(true)
        try {
            const response = await loginWithCredentials(email, password)
            const encryptionKey = getEncryptionKey()
            const encrypted = await encrypt(response.authKey, encryptionKey)
            await updateConnection(accountId, connection.id, {
                credentials: {
                    ...connection.credentials,
                    authKey: encrypted,
                    email: response.user?.email || email,
                },
                status: 'active',
            })
            toast({ title: 'Stremio session refreshed' })
            setPassword('')
            await useConnectionStore.getState().syncConnections(accountId)
        } catch (err) {
            toast({ title: 'Re-authentication failed', description: errMsg(err), variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }

    const handleUpdate = async () => {
        const trimmed = newAuthKey.trim()
        if (!trimmed) return
        setSavingKey(true)
        try {
            const encryptionKey = getEncryptionKey()
            const encrypted = await encrypt(trimmed, encryptionKey)
            await updateConnection(accountId, connection.id, {
                credentials: { ...connection.credentials, authKey: encrypted },
                status: 'active',
            })
            toast({ title: 'Auth key updated' })
            setNewAuthKey('')
            await useConnectionStore.getState().syncConnections(accountId)
        } catch (err) {
            toast({ title: 'Update failed', description: errMsg(err), variant: 'destructive' })
        } finally {
            setSavingKey(false)
        }
    }

    return (
        <SectionShell title="Re-authenticate" description="Sign in with your Stremio email and password, or paste a fresh auth key.">
            <div className="space-y-2">
                <Label htmlFor="stremio-edit-email">Email</Label>
                <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        id="stremio-edit-email"
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
                <Label htmlFor="stremio-edit-password">Password</Label>
                <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        id="stremio-edit-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Your Stremio password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="pl-10 pr-9"
                        onKeyDown={e => { if (e.key === 'Enter' && emailValid && passwordValid) handleReauth() }}
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword(s => !s)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                </div>
            </div>
            <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={handleReauth}
                disabled={saving || !emailValid || !passwordValid}
            >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {saving ? 'Authenticating...' : 'Re-authenticate'}
            </Button>

            <div className="border-t border-border/40" />

            <div className="space-y-2">
                <Label htmlFor="stremio-new-authkey">New Auth Key</Label>
                <Input
                    id="stremio-new-authkey"
                    type="password"
                    placeholder="Paste a fresh Stremio auth key"
                    value={newAuthKey}
                    onChange={e => setNewAuthKey(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && newAuthKey.trim()) handleUpdate() }}
                />
            </div>
            <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={handleUpdate}
                disabled={savingKey || !newAuthKey.trim()}
            >
                {savingKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {savingKey ? 'Updating...' : 'Update Auth Key'}
            </Button>
        </SectionShell>
    )
}

function NuvioCredentialsSection({ accountId, connection }: { accountId: string; connection: Connection }) {
    const updateConnection = useConnectionStore(s => s.updateConnection)
    const [email, setEmail] = useState(connection.credentials?.email || '')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [saving, setSaving] = useState(false)
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

    const emailValid = email.includes('@')
    const passwordValid = password.length > 0

    const handleReauth = async () => {
        if (!emailValid || !passwordValid) return
        setSaving(true)
        try {
            const bu = connection.credentials?.baseUrl || undefined
            const pk = connection.credentials?.publishableKey || undefined
            const result = await nuvioAuth(email, password, pk, bu)
            const t = result.tokens
            if (!t) throw new Error('No tokens returned. Confirm your Nuvio account and try again.')
            await updateConnection(accountId, connection.id, {
                credentials: {
                    ...connection.credentials,
                    email,
                    accessToken: t.accessToken,
                    refreshToken: t.refreshToken,
                    expiresAt: String(t.expiresAt),
                },
                status: 'active',
            })
            const { storeConnectionCredential } = await import('@/api/hydra-providers')
            storeConnectionCredential(accountId, connection.id, {
                accessToken: t.accessToken,
                refreshToken: t.refreshToken,
                expiresAt: t.expiresAt,
                profileId: connection.credentials?.profileId || null,
                baseUrl: bu || null,
                publishableKey: pk || null,
            }, 'nuvio').catch(err => {
                toast({ title: 'Saved locally, but the server did not store the new session', description: errMsg(err), variant: 'destructive' })
            })
            toast({ title: 'Nuvio session refreshed' })
            setPassword('')
            await useConnectionStore.getState().syncConnections(accountId)
        } catch (err) {
            toast({ title: 'Re-authentication failed', description: errMsg(err), variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }

    const handleTest = async () => {
        setTesting(true)
        setTestResult(null)
        try {
            const token = await withTimeout(fetchConnectionToken(accountId, connection.id, 'nuvio'))
            setTestResult({ ok: true, message: `Session healthy (token expires ${new Date(token.expiresAt).toLocaleString()})` })
            toast({ title: 'Connection healthy' })
        } catch (err) {
            const message = errMsg(err, 'Session could not be verified. Try re-authenticating.')
            setTestResult({ ok: false, message })
            toast({ title: 'Connection test failed', description: message, variant: 'destructive' })
        } finally {
            setTesting(false)
        }
    }

    return (
        <SectionShell title="Nuvio credentials" description="Re-authenticate to refresh your session tokens.">
            <div className="flex items-center justify-end">
                <Button
                    variant="subtle"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 text-xs"
                    onClick={handleTest}
                    disabled={testing}
                >
                    {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    {testing ? 'Testing...' : 'Test Connection'}
                </Button>
            </div>
            <div className="space-y-2">
                <Label htmlFor="nuvio-edit-email">Email</Label>
                <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        id="nuvio-edit-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        className="pl-10"
                    />
                </div>
            </div>
            <div className="space-y-2">
                <Label htmlFor="nuvio-edit-password">Password</Label>
                <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        id="nuvio-edit-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Your Nuvio password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="pl-10 pr-9"
                        onKeyDown={e => { if (e.key === 'Enter' && emailValid && passwordValid) handleReauth() }}
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword(s => !s)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                </div>
            </div>
            <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={handleReauth}
                disabled={saving || !emailValid || !passwordValid}
            >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {saving ? 'Authenticating...' : 'Re-authenticate'}
            </Button>
            <TestResultBanner result={testResult} />
        </SectionShell>
    )
}

function RealStreamCredentialsSection({ accountId, connection }: { accountId: string; connection: Connection }) {
    const updateConnection = useConnectionStore(s => s.updateConnection)
    const [email, setEmail] = useState(connection.credentials?.email || '')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [saving, setSaving] = useState(false)
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

    const emailValid = email.includes('@')
    const passwordValid = password.length > 0

    const handleReauth = async () => {
        if (!emailValid || !passwordValid) return
        setSaving(true)
        try {
            const result = await realstreamAuth(email, password, connection.credentials?.baseUrl || undefined)
            const t = result.tokens
            if (!t) throw new Error('No tokens returned. Confirm your RealStream account and try again.')
            const credentials = {
                ...connection.credentials,
                email,
                password,
                accessToken: t.accessToken,
                userId: t.userId || connection.credentials?.userId || '',
                expiresAt: String(t.expiresAt),
            }
            await updateConnection(accountId, connection.id, { credentials, status: 'active' })
            const { storeConnectionCredential } = await import('@/api/hydra-providers')
            storeConnectionCredential(accountId, connection.id, {
                accessToken: t.accessToken,
                userId: t.userId || null,
                expiresAt: t.expiresAt,
                baseUrl: connection.credentials?.baseUrl || null,
                email,
                password,
            }, 'realstream').catch(err => {
                toast({ title: 'Saved locally, but the server did not store the new session', description: errMsg(err), variant: 'destructive' })
            })
            toast({ title: 'RealStream session refreshed' })
            setPassword('')
            await useConnectionStore.getState().syncConnections(accountId)
        } catch (err) {
            toast({ title: 'Re-authentication failed', description: errMsg(err), variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }

    const handleTest = async () => {
        setTesting(true)
        setTestResult(null)
        try {
            const token = await withTimeout(fetchConnectionToken(accountId, connection.id, 'realstream'))
            setTestResult({ ok: true, message: `Session healthy (token expires ${new Date(token.expiresAt).toLocaleString()})` })
            toast({ title: 'Connection healthy' })
        } catch (err) {
            const message = errMsg(err, 'Session could not be verified. Try re-authenticating.')
            setTestResult({ ok: false, message })
            toast({ title: 'Connection test failed', description: message, variant: 'destructive' })
        } finally {
            setTesting(false)
        }
    }

    return (
        <SectionShell title="RealStream credentials" description="Re-authenticate to refresh your session tokens.">
            <div className="flex items-center justify-end">
                <Button
                    variant="subtle"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 text-xs"
                    onClick={handleTest}
                    disabled={testing}
                >
                    {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    {testing ? 'Testing...' : 'Test Connection'}
                </Button>
            </div>
            <div className="space-y-2">
                <Label htmlFor="rs-edit-email">Email</Label>
                <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        id="rs-edit-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        className="pl-10"
                    />
                </div>
            </div>
            <div className="space-y-2">
                <Label htmlFor="rs-edit-password">Password</Label>
                <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        id="rs-edit-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Your RealStream password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="pl-10 pr-9"
                        onKeyDown={e => { if (e.key === 'Enter' && emailValid && passwordValid) handleReauth() }}
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword(s => !s)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                </div>
            </div>
            <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={handleReauth}
                disabled={saving || !emailValid || !passwordValid}
            >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {saving ? 'Authenticating...' : 'Re-authenticate'}
            </Button>
            <TestResultBanner result={testResult} />
        </SectionShell>
    )
}

function HydraCredentialsSection({ accountId, connection }: { accountId: string; connection: Connection }) {
    const updateConnection = useConnectionStore(s => s.updateConnection)
    const [newApiKey, setNewApiKey] = useState('')
    const [showKey, setShowKey] = useState(false)
    const [saving, setSaving] = useState(false)
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

    const handleUpdate = async () => {
        const trimmed = newApiKey.trim()
        if (!trimmed) return
        setSaving(true)
        try {
            await updateConnection(accountId, connection.id, {
                credentials: { ...connection.credentials, apiKey: trimmed },
                status: 'active',
            })
            const { storeConnectionCredential } = await import('@/api/hydra-providers')
            const bundle = {
                authValue: trimmed,
                baseUrl: connection.driverConfig?.baseUrl,
                authType: connection.driverConfig?.authType,
                authHeader: connection.driverConfig?.authHeader,
                enabled: connection.enabled,
            }
            storeConnectionCredential(accountId, connection.id, bundle, 'hydra').catch(err => {
                toast({ title: 'Saved locally, but the server did not store the key', description: errMsg(err), variant: 'destructive' })
            })
            toast({ title: 'API key updated' })
            setNewApiKey('')
            await useConnectionStore.getState().syncConnections(accountId)
        } catch (err) {
            toast({ title: 'Update failed', description: errMsg(err), variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }

    const handleTest = async () => {
        setTesting(true)
        setTestResult(null)
        try {
            const { testHydraEndpoint } = await import('@/api/hydra-providers')
            const baseUrl = connection.driverConfig?.baseUrl
            const authType = connection.driverConfig?.authType || 'header'
            const authHeader = connection.driverConfig?.authHeader || 'x-api-key'
            const authValue = newApiKey.trim() || connection.credentials?.apiKey || ''
            if (!authValue) throw new Error('No API key set. Enter one to test.')
            if (!baseUrl) throw new Error('No endpoint URL configured.')
            await withTimeout(testHydraEndpoint(baseUrl, authType, authHeader, authValue), 15000)
            setTestResult({ ok: true, message: 'Outbound endpoint reachable.' })
            toast({ title: 'Connection healthy' })
        } catch (err) {
            const message = errMsg(err, 'Endpoint test failed. Check the API key and target server.')
            setTestResult({ ok: false, message })
            toast({ title: 'Connection test failed', description: message, variant: 'destructive' })
        } finally {
            setTesting(false)
        }
    }

    return (
        <SectionShell title="Hydra API key" description="Update the API key used to push to this outbound server.">
            <div className="flex items-center justify-end">
                <Button
                    variant="subtle"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 text-xs"
                    onClick={handleTest}
                    disabled={testing}
                >
                    {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    {testing ? 'Testing...' : 'Test Connection'}
                </Button>
            </div>
            <div className="space-y-2">
                <Label htmlFor="hydra-edit-key">New API Key</Label>
                <div className="relative">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        id="hydra-edit-key"
                        type={showKey ? 'text' : 'password'}
                        placeholder="Paste a new API key"
                        value={newApiKey}
                        onChange={e => setNewApiKey(e.target.value)}
                        className="pl-10 pr-9"
                        onKeyDown={e => { if (e.key === 'Enter' && newApiKey.trim()) handleUpdate() }}
                    />
                    <button
                        type="button"
                        onClick={() => setShowKey(s => !s)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label={showKey ? 'Hide key' : 'Show key'}
                    >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                </div>
            </div>
            <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={handleUpdate}
                disabled={saving || !newApiKey.trim()}
            >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {saving ? 'Updating...' : 'Update API Key'}
            </Button>
            <TestResultBanner result={testResult} />
        </SectionShell>
    )
}

export function ConnectionEditPanel({
    accountId,
    connection,
    status,
    onBack,
}: {
    accountId: string
    connection: Connection
    status: ConnectionStatus
    onBack: () => void
}) {
    const removeConnection = useConnectionStore(s => s.removeConnection)
    const account = useAccountStore(s => s.accounts.find(a => a.id === accountId))
    const [confirmRemove, setConfirmRemove] = useState(false)
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
    const isHydra = connection.connectionType === 'hydra-outbound'
    const name = connectionLabel(connection)
    const expiry = tokenExpiry(connection)
    const display = displayStatus(status, expiry)

    const handleRemove = () => {
        removeConnection(accountId, connection.id)
        onBack()
    }

    const handleTestConnection = async () => {
        if (!account) return
        setTesting(true)
        setTestResult(null)
        try {
            const encryptedKey = getStremioAuthKey(account)
            if (!encryptedKey) {
                throw new Error('No auth key found for this account')
            }
            const authKey = await getCachedAuthKey(encryptedKey, getEncryptionKey())
            const user = await withTimeout(stremioClient.getUser(authKey))
            setTestResult({ ok: true, message: `Connection healthy${user.email ? ` \u2014 ${user.email}` : ''}` })
            toast({ title: 'Connection healthy' })
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Connection test failed'
            setTestResult({ ok: false, message })
            toast({ title: 'Connection test failed', description: message, variant: 'destructive' })
        } finally {
            setTesting(false)
        }
    }

    return (
        <div className="space-y-4">
            <ToolbarShell className="w-fit max-w-full p-2" contentClassName="gap-2">
                <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 rounded-xl border border-border/40 bg-card px-2.5 text-xs font-medium text-muted-foreground shadow-sm hover:bg-muted/50 hover:text-foreground" onClick={onBack}>
                    <ArrowLeft className="h-4 w-4" />
                    Connections
                </Button>
            </ToolbarShell>
            <div className="flex items-center gap-2">
                <div className="flex-1" />
                {confirmRemove ? (
                    <div className="flex items-center gap-1.5">
                        <Button size="sm" variant="subtle" className="h-7 text-xs" onClick={() => setConfirmRemove(false)}>Cancel</Button>
                        <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={handleRemove}>Remove</Button>
                    </div>
                ) : (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground">
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[160px]">
                            <DropdownMenuItem onClick={() => setConfirmRemove(true)} className="gap-2 text-xs text-destructive focus:text-destructive">
                                <Trash2 className="h-3.5 w-3.5" />
                                Remove connection
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>

            <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
                <div className="flex items-center gap-3">
                    <PlatformLogo platform={connection.platform} className="h-12 w-12 shrink-0" isHydra={isHydra} />
                    <div className="min-w-0 flex-1">
                        <p className="text-base font-semibold truncate">{name}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <ConnectionStatusPill status={display} />
                            {isHydra && <StatusChip size="sm" className="h-5 px-2 text-xs bg-muted/40">Outbound</StatusChip>}
                            {connection.capabilities.map(c => (
                                <StatusChip key={c} size="sm" className="h-5 px-2 text-xs bg-muted/40">{c}</StatusChip>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {connection.platform === 'stremio' && (
                <>
                    <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-sm font-semibold">Connection health</p>
                                <p className="text-xs text-muted-foreground">Verify the Stremio auth key is valid and reachable.</p>
                            </div>
                            <Button
                                variant="subtle"
                                size="sm"
                                className="h-8 shrink-0 gap-1.5 text-xs"
                                onClick={handleTestConnection}
                                disabled={testing || !account}
                            >
                                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                                {testing ? 'Testing...' : 'Test Connection'}
                            </Button>
                        </div>
                        <TestResultBanner result={testResult} />
                    </div>
                    <StremioCredentialsSection accountId={accountId} connection={connection} />
                </>
            )}

            {connection.platform === 'nuvio' && (
                <>
                    <NuvioCredentialsSection accountId={accountId} connection={connection} />
                    <NuvioConnectionWorkspace
                        accountId={accountId}
                        connection={connection}
                        status={status}
                    />
                </>
            )}

            {connection.platform === 'realstream' && (
                <RealStreamCredentialsSection accountId={accountId} connection={connection} />
            )}

            {isHydra && (
                <HydraCredentialsSection accountId={accountId} connection={connection} />
            )}
        </div>
    )
}
