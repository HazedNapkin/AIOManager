import { Button } from '@/components/ui/button'
import { ImageUploadButton } from '@/components/ui/image-upload-button'
import { Tooltip } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAccounts } from '@/hooks/useAccounts'
import { useUIStore } from '@/store/uiStore'
import { useAccountStore, hasPlatformConnection, getStremioAuthKey } from '@/store/accountStore'
import {
  AlertCircle,
  Check,
  ExternalLink,
  HelpCircle,
  KeyRound,
  Mail,
  QrCode,
  Search,
  ShieldCheck,
  Smile,
  MoreVertical,
  X,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useAuthStore } from '@/store/authStore'
import { StremioOAuth } from './StremioOAuth'
import { QRLinkDialog } from '@/components/qr/QRLinkDialog'
import type { QRSession } from '@/lib/qr-device-link'
import { createStremioLink, pollStremioLink } from '@/api/stremio-link'
import { buildResetPasswordUrl } from '@/api/stremio-relay'
import { StremioSocialAuth } from './StremioSocialAuth'
import { NuvioSetupDialog, type NuvioBackend } from '@/components/providers/NuvioSetupDialog'
import { RealStreamSetupDialog, type RealStreamTokens } from '@/components/providers/RealStreamSetupDialog'
import { ProviderSetupDialog } from '@/components/providers/ProviderSetupDialog'
import { useConnectionStore } from '@/store/connectionStore'
import type { HydraDriverConfig } from '@/types/provider'
import { ACCOUNT_COLORS, cn } from '@/lib/utils'
import { EMOJI_GROUPS } from '@/lib/emoji-data'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ColorPicker } from '@/components/ui/color-picker'
import { useTheme } from '@/contexts/ThemeContext'
import { motion, AnimatePresence } from 'framer-motion'
import { PLATFORM_REGISTRY } from '@/lib/platform-registry'
import { ConnectionManager } from '@/components/providers/ConnectionManager'
import { PlatformLogo } from '@/components/providers/ConnectionPrimitives'
import { AccountAvatar } from './AccountAvatar'

type AccountAuthMode = 'credentials' | 'oauth' | 'authKey' | 'qr'
type WizardStep = 'identity' | 'platform' | 'connect-more'
type PlatformStep = 'select' | 'stremio-auth'

const ACCOUNT_AUTH_METHODS: Array<{ id: AccountAuthMode; label: string; subtitle: string; icon: LucideIcon }> = [
  { id: 'credentials', label: 'Email & Password', subtitle: 'Best for persistent sync and auto-refresh.', icon: Mail },
  { id: 'oauth', label: 'OAuth', subtitle: 'Approve in Stremio without typing your password here.', icon: ShieldCheck },
  { id: 'qr', label: 'QR Code', subtitle: "Scan with your phone's Stremio app.", icon: QrCode },
  { id: 'authKey', label: 'Auth Key', subtitle: 'Paste an existing token for advanced imports.', icon: KeyRound },
]

export function AccountForm() {
  const isOpen = useUIStore((state) => state.isAddAccountDialogOpen)
  const closeDialog = useUIStore((state) => state.closeAddAccountDialog)
  const editingAccount = useUIStore((state) => state.editingAccount)
  const liveAccount = useAccountStore((s) => editingAccount ? s.accounts.find(a => a.id === editingAccount.id) ?? editingAccount : null)
  const encryptionKey = useAuthStore((state) => state.encryptionKey)
  const { addAccountByAuthKey, addAccountByCredentials, addLocalAccount, removeAccount, updateAccount, loading } = useAccounts()
  const { isLight } = useTheme()

  const [wizardStep, setWizardStep] = useState<WizardStep>('identity')
  const [platformStep, setPlatformStep] = useState<PlatformStep>('select')
  const [createdAccountId, setCreatedAccountId] = useState<string | null>(null)
  const [connectedPlatforms, setConnectedPlatforms] = useState<Set<string>>(new Set())
  const [nuvioDialogOpen, setNuvioDialogOpen] = useState(false)
  const [qrDialogOpen, setQrDialogOpen] = useState(false)
  const [realstreamDialogOpen, setRealstreamDialogOpen] = useState(false)
  const [hydraDialogOpen, setHydraDialogOpen] = useState(false)
  const [mode, setMode] = useState<AccountAuthMode>('credentials')
  const [authIntent, setAuthIntent] = useState<'login' | 'signup'>('login')
  const [name, setName] = useState('')
  const [authKey, setAuthKey] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [oauthAuthKey, setOauthAuthKey] = useState('')
  const [oauthEmail, setOauthEmail] = useState('')
  const [oauthPassword, setOauthPassword] = useState('')
  const [oauthSaving, setOauthSaving] = useState(false)
  const [oauthEmailLoading, setOauthEmailLoading] = useState(false)
  const [error, setError] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [accentColor, setAccentColor] = useState<string | undefined>(undefined)
  const [emoji, setEmoji] = useState('')
  const [emojiSearch, setEmojiSearch] = useState('')
  const [avatar, setAvatar] = useState('')
  const [hideLastWatched, setHideLastWatched] = useState(false)
  const [hideAddonPreview, setHideAddonPreview] = useState(false)
  const [hidePlatformLogos, setHidePlatformLogos] = useState(false)
  const connectionSubDialogRef = useRef(false)
  const subDialogClosedAtRef = useRef(0)

  const isEditing = !!editingAccount
  const isExpiredSession = editingAccount?.status === 'expired'

  useEffect(() => {
    setOauthAuthKey('')
    setOauthEmail('')
    setOauthPassword('')
    setOauthSaving(false)
    setOauthEmailLoading(false)
    setError('')
    setShowHelp(false)
    setWizardStep('identity')
    setPlatformStep('select')
    setCreatedAccountId(null)
    setConnectedPlatforms(new Set())

    if (editingAccount) {
      setName(editingAccount.name)
      setAuthKey('')
      setPassword('')
      const stremioConn = editingAccount.connections?.find(c => c.platform === 'stremio')
      const connEmail = stremioConn?.credentials?.email
      const connAuthKey = stremioConn?.credentials?.authKey
      if (connEmail) {
        setMode('credentials')
        setEmail(connEmail)
      } else if (connAuthKey) {
        setMode('authKey')
        setEmail('')
        setAuthKey('')
      } else {
        setMode('credentials')
        setEmail('')
        setAuthKey('')
      }
      setAccentColor(editingAccount.accentColor)
      setEmoji(editingAccount.emoji || '')
      setAvatar(editingAccount.avatar || '')
      setHideLastWatched(editingAccount.hideLastWatched ?? false)
      setHideAddonPreview(editingAccount.hideAddonPreview ?? false)
      setHidePlatformLogos(editingAccount.hidePlatformLogos ?? false)
    } else {
      setMode('credentials')
      setAuthIntent('login')
      setName('')
      setAuthKey('')
      setEmail('')
      setPassword('')
      setAccentColor(undefined)
      setEmoji('')
      setAvatar('')
      setHideLastWatched(false)
    }
  }, [editingAccount, isOpen])

  const handleClose = () => {
    setCreatedAccountId(null)
    setConnectedPlatforms(new Set())
    closeDialog()
  }

  const handleOAuthApproved = (key: string, user?: { email?: string; username?: string; name?: string }) => {
    const providedEmail = user?.email?.trim() || ''
    setAuthKey(key)
    setOauthAuthKey(key)
    setOauthPassword('')
    setOauthEmailLoading(false)
    setError('')

    if (providedEmail) {
      setOauthEmail(providedEmail)
      setEmail(providedEmail)
      setName(current => current.trim() ? current : providedEmail)
      return
    }

    const fallbackEmail = email.trim()
    setOauthEmail(fallbackEmail)
    setOauthEmailLoading(!fallbackEmail)
    void (async () => {
      try {
        const { stremioClient } = await import('@/api/stremio-client')
        const stremioUser = await stremioClient.getUser(key)
        const detectedEmail = stremioUser.email?.trim()
        if (!detectedEmail) return
        setOauthEmail(current => current.trim() ? current : detectedEmail)
        setEmail(current => current.trim() ? current : detectedEmail)
        setName(current => current.trim() ? current : detectedEmail)
      } catch (err) {
        if (import.meta.env.DEV) console.warn('[AccountForm] Could not prefill OAuth email:', err)
      } finally {
        setOauthEmailLoading(false)
      }
    })()
  }

  const handleSaveOAuthAccount = async (persistent: boolean) => {
    if (!oauthAuthKey) {
      setError('Complete OAuth authorization first.')
      return
    }
    if (!encryptionKey) {
      setError('Session expired. Sign in again before saving accounts.')
      return
    }

    setOauthSaving(true)
    setError('')
    try {
      const beforeIds = !editingAccount ? new Set(useAccountStore.getState().accounts.map(a => a.id)) : null
      if (persistent) {
        const resolvedEmail = (oauthEmail || email || editingAccount?.email || '').trim()
        if (!resolvedEmail || !oauthPassword.trim()) {
          setError('Enter the Stremio email and password to make this OAuth account persistent.')
          return
        }
        if (editingAccount) {
          await updateAccount(editingAccount.id, {
            name: name.trim() || resolvedEmail,
            email: resolvedEmail,
            password: oauthPassword,
            accentColor: accentColor === 'none' ? undefined : accentColor,
            emoji: emoji.trim() || undefined,
            avatar: avatar || undefined,
            hideLastWatched,
            hideAddonPreview,
            hidePlatformLogos,
          })
        } else {
          await addAccountByCredentials(
            resolvedEmail,
            oauthPassword,
            name.trim() || resolvedEmail,
            accentColor === 'none' ? undefined : accentColor,
            emoji.trim() || undefined,
            avatar || undefined,
            'login'
          )
        }
      } else {
        if (editingAccount) {
          await updateAccount(editingAccount.id, {
            name: name.trim() || oauthEmail || editingAccount.name || 'Account',
            authKey: oauthAuthKey,
            accentColor: accentColor === 'none' ? undefined : accentColor,
            emoji: emoji.trim() || undefined,
            avatar: avatar || undefined,
            hideLastWatched,
            hideAddonPreview,
            hidePlatformLogos,
          })
        } else {
          await addAccountByAuthKey(
            oauthAuthKey,
            name.trim() || oauthEmail || 'Account',
            accentColor === 'none' ? undefined : accentColor,
            emoji.trim() || undefined,
            avatar || undefined
          )
        }
      }
      if (editingAccount) {
        handleClose()
      } else if (beforeIds) {
        const newAccount = useAccountStore.getState().accounts.find(a => !beforeIds.has(a.id))
        if (newAccount) {
          setCreatedAccountId(newAccount.id)
          setConnectedPlatforms(prev => new Set(prev).add('stremio'))
          setWizardStep('connect-more')
        } else {
          handleClose()
        }
      } else {
        handleClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${editingAccount ? 'update' : 'add'} account`)
    } finally {
      setOauthSaving(false)
    }
  }

  const handleIdentityNext = () => {
    if (!name.trim()) {
      setError('Give your account a name.')
      return
    }
    setError('')
    setWizardStep('platform')
  }

  const handleSkipLocal = async () => {
    if (!name.trim()) {
      setError('Give your account a name.')
      return
    }
    setError('')
    try {
      await addLocalAccount(name.trim(), accentColor === 'none' ? undefined : accentColor, emoji.trim() || undefined, avatar || undefined)
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account')
    }
  }

  const handleNuvioAccountComplete = async (
    tokens: { accessToken: string; refreshToken: string; expiresAt: number },
    profileId: string | null,
    _profiles: unknown[],
    email: string,
    backend: NuvioBackend
  ) => {
    let accountId: string | undefined
    const isFirstConnection = !createdAccountId
    try {
      if (isFirstConnection) {
        accountId = await addLocalAccount(name.trim() || 'Nuvio Account', accentColor === 'none' ? undefined : accentColor, emoji.trim() || undefined, avatar || undefined)
        setCreatedAccountId(accountId)
      } else {
        accountId = createdAccountId
      }
      const profileIndex = (() => {
        if (!profileId) return ''
        const match = (_profiles as Array<Record<string, unknown>>).find(p => p?.id === profileId)
        const idx = match ? Number(match.profileIndex ?? match.profileIndex) : NaN
        return Number.isFinite(idx) && idx > 0 ? String(idx) : ''
      })()
      await useConnectionStore.getState().addConnection(accountId, {
        platform: 'nuvio',
        driverType: 'native',
        connectionType: 'native',
        enabled: true,
        status: 'active',
        credentials: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: String(tokens.expiresAt),
          profileId: profileId || '',
          profileIndex,
          email,
          ...(backend?.baseUrl ? { baseUrl: backend.baseUrl } : {}),
          ...(backend?.publishableKey ? { publishableKey: backend.publishableKey } : {}),
        },
        capabilities: ['addons', 'plugins', 'profiles'],
      })
      const { scheduleSyncAccount } = await import('@/store/account/accountSync')
      scheduleSyncAccount(accountId)
      setConnectedPlatforms(prev => new Set(prev).add('nuvio'))
      if (isFirstConnection) {
        setWizardStep('connect-more')
      } else {
        setNuvioDialogOpen(false)
      }
    } catch (err) {
      if (isFirstConnection && accountId) removeAccount(accountId).catch(() => {})
      setError(err instanceof Error ? err.message : 'Failed to add Nuvio connection')
    }
  }

  const handleRealStreamAccountComplete = async (tokens: RealStreamTokens, email: string, password: string) => {
    let accountId: string | undefined
    const isFirstConnection = !createdAccountId
    try {
      if (isFirstConnection) {
        accountId = await addLocalAccount(name.trim() || 'RealStream Account', accentColor === 'none' ? undefined : accentColor, emoji.trim() || undefined, avatar || undefined)
        setCreatedAccountId(accountId)
      } else {
        accountId = createdAccountId
      }
      await useConnectionStore.getState().addConnection(accountId, {
        platform: 'realstream',
        driverType: 'native',
        connectionType: 'native',
        enabled: true,
        status: 'active',
        credentials: {
          accessToken: tokens.accessToken,
          userId: tokens.userId || '',
          expiresAt: String(tokens.expiresAt),
          email,
          password,
        },
        capabilities: ['addons'],
      })
      const { scheduleSyncAccount } = await import('@/store/account/accountSync')
      scheduleSyncAccount(accountId)
      setConnectedPlatforms(prev => new Set(prev).add('realstream'))
      if (isFirstConnection) {
        setWizardStep('connect-more')
      } else {
        setRealstreamDialogOpen(false)
      }
    } catch (err) {
      if (isFirstConnection && accountId) removeAccount(accountId).catch(() => {})
      setError(err instanceof Error ? err.message : 'Failed to add RealStream connection')
    }
  }

  const handleHydraAccountComplete = async (config: HydraDriverConfig, credential: string) => {
    let accountId: string | undefined
    const isFirstConnection = !createdAccountId
    try {
      if (isFirstConnection) {
        accountId = await addLocalAccount(name.trim() || config.name, accentColor === 'none' ? undefined : accentColor, emoji.trim() || undefined, avatar || undefined)
        setCreatedAccountId(accountId)
      } else {
        accountId = createdAccountId
      }
      await useConnectionStore.getState().addConnection(accountId, {
        platform: config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        driverType: 'hydra-outbound',
        connectionType: 'hydra-outbound',
        enabled: true,
        status: 'active',
        credentials: { apiKey: credential },
        capabilities: ['addons'],
        driverConfig: config,
      })
      setConnectedPlatforms(prev => new Set(prev).add('hydra-outbound'))
      if (isFirstConnection) {
        setWizardStep('connect-more')
      } else {
        setHydraDialogOpen(false)
      }
    } catch (err) {
      if (isFirstConnection && accountId) removeAccount(accountId).catch(() => {})
      setError(err instanceof Error ? err.message : 'Failed to add Hydra connection')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }

    if (mode === 'oauth' || mode === 'qr') return
    setError('')

    if (!encryptionKey) {
      setError('Session expired. Sign in again before saving accounts.')
      return
    }

    if (editingAccount) {
      const resolvedEmail = email.trim() || editingAccount.email || ''
      const expiredConnection = editingAccount.connections?.find(c => c.status === 'expired')
      const isStremioExpired = !expiredConnection || expiredConnection.platform === 'stremio'
      if (mode === 'credentials' && password.trim() && !resolvedEmail) {
        setError('Email is required when updating Stremio credentials.')
        return
      }
      if (editingAccount.status === 'expired' && mode === 'credentials' && (!resolvedEmail || !password.trim())) {
        if (isStremioExpired) {
          setError('Enter the Stremio email and password to restore this expired session.')
        } else {
          const platformName = expiredConnection.platform.charAt(0).toUpperCase() + expiredConnection.platform.slice(1)
          setError(`Session expired. Reconnect your ${platformName} account in the Connections tab to restore it.`)
        }
        return
      }
      if (editingAccount.status === 'expired' && mode === 'authKey' && !authKey.trim()) {
        if (isStremioExpired) {
          setError('Paste a fresh AuthKey to replace this expired token.')
        } else {
          const platformName = expiredConnection.platform.charAt(0).toUpperCase() + expiredConnection.platform.slice(1)
          setError(`Session expired. Reconnect your ${platformName} account in the Connections tab to restore it.`)
        }
        return
      }
    }

    try {
      const beforeIds = !editingAccount ? new Set(useAccountStore.getState().accounts.map(a => a.id)) : null
      if (editingAccount) {
        await updateAccount(editingAccount.id, {
          name: name.trim() || editingAccount.name,
          authKey: mode === 'authKey' && authKey.trim() ? authKey.trim() : undefined,
          email:
            mode === 'credentials' && (password.trim() || email !== editingAccount.email)
              ? email.trim() || editingAccount.email
              : undefined,
          password: mode === 'credentials' && password.trim() ? password : undefined,
          accentColor: accentColor === 'none' ? undefined : accentColor,
          emoji: emoji.trim() || undefined,
          avatar: avatar || undefined,
          hideLastWatched,
          hideAddonPreview,
          hidePlatformLogos,
        })
      } else {
        if (mode === 'authKey') {
          if (!authKey.trim()) {
            setError('Auth key is required')
            return
          }
          await addAccountByAuthKey(authKey.trim(), name.trim(), accentColor === 'none' ? undefined : accentColor, emoji.trim() || undefined, avatar || undefined)
        } else if (mode === 'credentials') {
          if (!email.trim() || !password.trim()) {
            setError('Email and password are required')
            return
          }
          await addAccountByCredentials(email.trim(), password, name.trim(), accentColor === 'none' ? undefined : accentColor, emoji.trim() || undefined, avatar || undefined, authIntent)
        }
      }
      if (editingAccount) {
        handleClose()
      } else if (beforeIds) {
        const newAccount = useAccountStore.getState().accounts.find(a => !beforeIds.has(a.id))
        if (newAccount) {
          setCreatedAccountId(newAccount.id)
          setConnectedPlatforms(prev => new Set(prev).add('stremio'))
          setWizardStep('connect-more')
        } else {
          handleClose()
        }
      } else {
        handleClose()
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Failed to ${editingAccount ? 'update' : 'add'} account`
      )
    }
  }

  const availableAuthMethods = ACCOUNT_AUTH_METHODS

  const renderIdentityStep = () => (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="name" className="text-xs font-medium text-muted-foreground uppercase">Account Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Account"
          className="bg-background/50 border-muted focus:bg-background transition-colors h-11"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleIdentityNext()
            }
          }}
        />
      </div>

      <div className="space-y-3">
        <Label className="text-xs font-medium text-muted-foreground uppercase">Theme Color</Label>
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip content="No accent color" side="top">
            <button
              type="button"
              onClick={() => setAccentColor('none')}
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-[transform,opacity,box-shadow] hover:scale-110 relative overflow-hidden group ${accentColor === 'none' ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background' : 'border border-foreground/20'}`}
            >
              <div className="absolute inset-x-0 h-0.5 bg-destructive/50 rotate-45" />
              <div className="text-xs font-bold opacity-40 group-hover:opacity-100 transition-opacity">Off</div>
            </button>
          </Tooltip>

          {ACCOUNT_COLORS.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => setAccentColor(hex)}
              className={`w-8 h-8 rounded-xl transition-[transform,opacity,box-shadow] hover:scale-115 ${accentColor === hex ? 'ring-2 ring-white ring-offset-2 ring-offset-background shadow-lg' : ''}`}
              style={{ backgroundColor: hex }}
            />
          ))}

          <Popover>
            <Tooltip content="Custom color" side="top">
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={`w-8 h-8 rounded-xl transition-[transform,opacity,box-shadow] hover:scale-115 bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)] ${(accentColor && accentColor !== 'none' && !ACCOUNT_COLORS.includes(accentColor)) ? 'ring-2 ring-white ring-offset-2 ring-offset-background shadow-lg' : ''}`}
                />
              </PopoverTrigger>
            </Tooltip>
            <PopoverContent className="w-[280px] p-4" align="start">
              <ColorPicker
                value={accentColor && accentColor.startsWith('#') ? accentColor : '#6366f1'}
                onChange={(hex) => setAccentColor(hex)}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="space-y-3">
        <Label className="text-xs font-medium text-muted-foreground uppercase">Account Emoji</Label>
        <div className="flex items-center gap-3">
          <Input
            id="emoji"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            placeholder="👤"
            className="bg-background/50 border-muted focus:bg-background transition-colors w-14 h-14 text-center text-2xl p-0 rounded-xl shadow-inner"
            maxLength={4}
          />

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="subtle" size="icon" className="h-14 w-14 rounded-xl bg-background/50 border-muted hover:bg-muted/50 transition-[transform,opacity,box-shadow] shadow-sm">
                <Smile className="h-6 w-6 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0 border-border/10 shadow-2xl overflow-hidden rounded-xl" align="start">
              <div className="flex flex-col h-[380px] bg-popover">
                <div className="p-3 border-b border-border/10 bg-muted/20">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search emojis..."
                      className="pl-9 h-9 text-xs bg-muted/30 border border-border/40 focus:bg-muted/40 rounded-lg"
                      value={emojiSearch}
                      onChange={(e) => setEmojiSearch(e.target.value)}
                      autoFocus
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                  {Object.entries(EMOJI_GROUPS).map(([group, emojis]) => {
                    const filtered = emojis.filter(e =>
                      e.keywords.some(k => k.toLowerCase().includes(emojiSearch.toLowerCase())) ||
                      e.char.includes(emojiSearch)
                    )
                    if (filtered.length === 0) return null

                    return (
                      <div key={group} className="mb-6 last:mb-0">
                        <h4 className="text-xs font-semibold text-primary/60 mb-3 px-1">{group}</h4>
                        <div className="grid grid-cols-6 gap-2">
                          {filtered.map((e) => (
                            <Tooltip key={e.char} content={e.keywords[0]}>
                              <button
                                type="button"
                                onClick={() => setEmoji(e.char)}
                                className={`h-10 w-10 flex items-center justify-center text-xl rounded-xl transition-[transform,opacity,box-shadow] duration-200 hover:scale-115 hover:bg-primary/20 ${emoji === e.char ? `bg-primary/25 ring-2 ${isLight ? 'ring-primary' : 'ring-primary/50'} shadow-lg scale-110` : 'hover:bg-accent/40'}`}
                              >
                                {e.char}
                              </button>
                            </Tooltip>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-14 px-4 text-xs font-bold uppercase rounded-xl opacity-40 hover:opacity-100 hover:text-destructive hover:bg-destructive/5 transition-[transform,opacity,box-shadow]"
            onClick={() => setEmoji('')}
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <Label className="text-xs font-medium text-muted-foreground uppercase">Avatar URL</Label>
          <p className="text-xs text-muted-foreground mt-1">Direct image link (https://...). Overrides emoji when set. Syncs across devices.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative h-10 w-10 rounded-lg border border-border/40 bg-muted/30 overflow-hidden flex items-center justify-center shrink-0">
            <AccountAvatar account={{ name: name || 'Account', email, emoji, avatar: avatar || undefined, status: 'active' }} size="sm" showStatus={false} />
          </div>
          <input
            type="url"
            value={avatar.startsWith('data:') ? '\u2713 Uploaded image' : avatar}
            onChange={(e) => setAvatar(e.target.value)}
            readOnly={avatar.startsWith('data:')}
            placeholder="https://example.com/avatar.png"
            className="flex h-10 w-full rounded-md border border-border/50 bg-background/50 px-3 py-2 text-sm transition-[border,box-shadow] file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
            autoComplete="off"
            spellCheck={false}
          />
          {avatar && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => setAvatar('')}
              aria-label="Clear avatar URL"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
          <ImageUploadButton
            onUploaded={(dataUrl) => setAvatar(dataUrl)}
            options={{ maxDimension: 256, square: true, quality: 0.85 }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            label="Upload avatar"
          />
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/50 rounded-xl px-4 py-3 animate-in shake duration-500">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-destructive">{error}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  const renderPlatformStep = () => {
    if (!isEditing && platformStep === 'select') {
      return renderPlatformSelection()
    }
    return renderStremioAuth()
  }

  const renderPlatformSelection = () => (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {PLATFORM_REGISTRY.filter(p => p.available).map(p => {
          const handleClick = () => {
            setError('')
            if (p.id === 'stremio') {
              setPlatformStep('stremio-auth')
            } else if (p.id === 'nuvio') {
              setNuvioDialogOpen(true)
            } else if (p.id === 'realstream') {
              setRealstreamDialogOpen(true)
            } else if (p.id === 'hydra-outbound') {
              setHydraDialogOpen(true)
            }
          }
          return (
            <button
              key={p.id}
              type="button"
              onClick={handleClick}
              className={cn(
                'group relative flex min-h-[148px] flex-col items-start gap-4 rounded-[1.35rem] border p-4 text-left transition-[background-color,border-color,box-shadow,transform]',
                'border-border/45 bg-card/65 hover:-translate-y-0.5 hover:border-border/80 hover:bg-muted/30 hover:shadow-md'
              )}
            >
              <span className={cn(
                'flex h-11 w-11 items-center justify-center rounded-2xl border transition-colors',
                'border-border/45 bg-background/60 text-muted-foreground group-hover:text-foreground'
              )}>
                <img src={p.logo} alt={p.name} loading="lazy" className="h-6 w-6 rounded" />
              </span>
              <span className="space-y-1.5 pr-5">
                <span className="block text-[15px] font-semibold leading-tight text-foreground">{p.name}</span>
                <span className="block text-xs leading-relaxed text-muted-foreground">{p.description}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )

  const renderStremioAuth = () => (
    <div className="space-y-5">
      {isExpiredSession && (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-warning">Session expired</p>
              <p className="text-xs leading-relaxed text-warning/85">
                Stremio rejected the saved token. Use Email & Password for persistent sync, or choose OAuth/Auth Key to replace the token.
              </p>
            </div>
          </div>
        </div>
      )}

      {(!isEditing || isExpiredSession) && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {availableAuthMethods.map(method => {
            const Icon = method.icon
            const isSelected = mode === method.id

            return (
              <button
                key={method.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => {
                  setMode(method.id)
                  setError('')
                  if (method.id !== 'oauth') {
                    setOauthAuthKey('')
                    setOauthEmail('')
                    setOauthPassword('')
                  }
                }}
                className={cn(
                  'group relative flex min-h-[148px] flex-col items-start gap-4 rounded-[1.35rem] border p-4 text-left transition-[background-color,border-color,box-shadow,transform]',
                  isSelected
                    ? 'border-border/80 bg-muted/30 shadow-md'
                    : 'border-border/45 bg-card/65 hover:-translate-y-0.5 hover:border-border/80 hover:bg-muted/30 hover:shadow-md'
                )}
              >
                <span className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-2xl border transition-colors',
                  isSelected
                    ? 'border-border/45 bg-background/60 text-foreground'
                    : 'border-border/45 bg-background/60 text-muted-foreground group-hover:text-foreground'
                )}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="space-y-1.5 pr-5">
                  <span className="block text-[15px] font-semibold leading-tight text-foreground">{method.label}</span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">{method.subtitle}</span>
                </span>
                {isSelected && (
                  <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-background text-foreground shadow-sm">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {!isEditing && mode === 'credentials' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/40 p-1">
            <button type="button" onClick={() => { setAuthIntent('login'); setError('') }} className={cn('h-9 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', authIntent === 'login' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>Sign In</button>
            <button type="button" onClick={() => { setAuthIntent('signup'); setError('') }} className={cn('h-9 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', authIntent === 'signup' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>Create Account</button>
          </div>
          <p className="text-xs text-muted-foreground px-1">
            {authIntent === 'login'
              ? 'Sign in to an existing Stremio account.'
              : 'Create a brand-new Stremio account with this email and password.'}
          </p>
        </div>
      )}

      {mode === 'oauth' ? (
        oauthAuthKey ? (
          <div className="space-y-4 rounded-2xl border border-success/25 bg-success/10 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-success/15 p-2 text-success">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-success">OAuth approved</p>
                <p className="text-xs leading-relaxed text-success/85">
                  {isEditing
                    ? 'Save this OAuth token now, or enter your Stremio password to make sync persistent.'
                    : 'Add the account now, or enter your Stremio password to make sync persistent.'}
                </p>
              </div>
            </div>

            <div className="grid gap-3 rounded-xl border border-border/40 bg-background/50 p-3">
              <div className="space-y-2">
                <Label htmlFor="oauth-email" className="text-xs font-medium text-muted-foreground uppercase">Stremio Email</Label>
                <Input
                  id="oauth-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={oauthEmail}
                  onChange={(e) => {
                    setOauthEmail(e.target.value)
                    setEmail(e.target.value)
                  }}
                  placeholder="your@email.com"
                  className="bg-background/50 border-muted focus:bg-background transition-colors h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="oauth-password" className="text-xs font-medium text-muted-foreground uppercase">Password for persistent sync</Label>
                <Input
                  id="oauth-password"
                  type="password"
                  autoComplete="current-password"
                  value={oauthPassword}
                  onChange={(e) => setOauthPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleSaveOAuthAccount(true)
                    }
                  }}
                  placeholder="Optional, but recommended"
                  className="bg-background/50 border-muted focus:bg-background transition-colors h-11"
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  onClick={() => handleSaveOAuthAccount(true)}
                  disabled={loading || oauthSaving || oauthEmailLoading || !encryptionKey}
                  className="rounded-xl font-bold text-xs"
                >
                  {oauthSaving ? 'Saving...' : oauthEmailLoading ? 'Checking email...' : isEditing ? 'Save persistent session' : 'Save persistent account'}
                </Button>
                <Button
                  type="button"
                  variant="subtle"
                  onClick={() => handleSaveOAuthAccount(false)}
                  disabled={loading || oauthSaving || !encryptionKey}
                  className="rounded-xl font-semibold text-xs"
                >
                  {isEditing ? 'Use OAuth token only' : 'Continue with OAuth only'}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <StremioOAuth
            onAuthKey={handleOAuthApproved}
            onError={setError}
            disabled={loading}
          />
        )
      ) : mode === 'qr' ? (
        <div className="flex flex-col items-center justify-center p-8 border border-dashed rounded-lg bg-muted/30">
          <div className="mb-4 p-3 rounded-full bg-primary/10">
            <QrCode className="h-6 w-6 text-primary" />
          </div>
          <h3 className="font-semibold text-sm mb-1">Stremio QR Login</h3>
          <p className="text-xs text-muted-foreground text-center mb-6 max-w-[240px]">
            Generate a QR code and scan it with your phone's Stremio app. Approve there, no password needed here.
          </p>
          <Button
            type="button"
            onClick={() => setQrDialogOpen(true)}
            disabled={loading}
            className="w-full gap-2"
          >
            <QrCode className="h-4 w-4" />
            Generate QR Code
          </Button>
        </div>
      ) : mode === 'authKey' ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="authKey" className="text-xs font-medium text-muted-foreground uppercase">Auth Key</Label>
            <Input
              id="authKey"
              type="password"
              value={authKey}
              onChange={(e) => setAuthKey(e.target.value)}
              placeholder={isExpiredSession ? 'Paste a fresh Stremio auth key' : isEditing ? '••••• (encrypted)' : 'Enter your Stremio auth key'}
              required={!isEditing || isExpiredSession}
              className="bg-background/50 border-muted focus:bg-background transition-colors h-11"
            />
            {isExpiredSession && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                OAuth tokens can expire after Stremio Web logout. Email & Password is the only auto-refresh path.
              </p>
            )}
          </div>
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="link"
              onClick={() => setShowHelp(!showHelp)}
              className="h-auto gap-1 p-0 text-xs font-medium"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              {showHelp ? 'Hide instructions' : 'Where to find?'}
            </Button>
            <Link
              to="/kronorium/getting-started/first-account#method-2-authkey-advanced"
              onClick={handleClose}
              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
            >
              Full Guide <ExternalLink className="h-2.5 w-2.5" />
            </Link>
          </div>

          <AnimatePresence>
            {showHelp && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="p-3 bg-muted/50 rounded-xl border border-border/10 space-y-3 mt-1">
                  <div className="space-y-2">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      1. Log into <a href="https://web.stremio.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline italic">web.stremio.com</a>
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      2. Run in Console (<kbd className="px-1 py-0.5 rounded bg-muted border border-border text-xs">F12</kbd>):
                    </p>
                    <pre
                      className="text-xs bg-muted p-2 rounded border border-border font-mono text-muted-foreground select-all cursor-pointer hover:bg-muted/80 transition-colors"
                      onClick={(e) => {
                        const target = e.currentTarget
                        const selection = window.getSelection()
                        const range = document.createRange()
                        range.selectNodeContents(target)
                        selection?.removeAllRanges()
                        selection?.addRange(range)
                      }}
                    >
                      localStorage.getItem("profile")
                    </pre>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-xs font-medium text-muted-foreground uppercase">Email</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required={!isEditing}
              autoFocus
              className="bg-background/50 border-muted focus:bg-background transition-colors h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-xs font-medium text-muted-foreground uppercase">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={isEditing ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isExpiredSession ? 'Enter password to restore sync' : isEditing ? 'Leave blank to keep unchanged' : 'Enter your password'}
              required={!isEditing}
              className="bg-background/50 border-muted focus:bg-background transition-colors h-11"
            />
            {isExpiredSession && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Saving Email & Password stores the password encrypted locally so AIOManager can refresh future Stremio auth keys automatically.
              </p>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => window.open(buildResetPasswordUrl(email), '_blank', 'noopener,noreferrer')}
                className="text-xs text-primary hover:underline"
              >
                Forgot password?
              </button>
            </div>
          </div>
        </div>
      )}

      {(!isEditing || isExpiredSession) && !(mode === 'oauth' && oauthAuthKey) && (
        <StremioSocialAuth
          onAuthKey={(key, user) => {
            handleOAuthApproved(key, user)
            setMode('oauth')
          }}
          onError={setError}
          disabled={loading}
        />
      )}

      {isEditing && (
        <div className="border-t border-border/10 pt-4 space-y-1">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">Hide last watched</p>
              <p className="text-xs text-muted-foreground">Don't show what this account is currently watching on the card.</p>
            </div>
            <Switch
              checked={hideLastWatched}
              onCheckedChange={setHideLastWatched}
            />
          </div>
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">Hide addon preview</p>
              <p className="text-xs text-muted-foreground">Don't show addon logos on the card.</p>
            </div>
            <Switch
              checked={hideAddonPreview}
              onCheckedChange={setHideAddonPreview}
            />
          </div>
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">Hide platform logos</p>
              <p className="text-xs text-muted-foreground">Don't show connection logos on the card.</p>
            </div>
            <Switch
              checked={hidePlatformLogos}
              onCheckedChange={setHidePlatformLogos}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="bg-destructive/10 border border-destructive/50 rounded-xl px-4 py-3 animate-in shake duration-500">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-destructive">{error}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  const renderConnectMoreStep = () => (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-foreground">Connect more platforms</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          This account can connect to multiple platforms. Add more now or skip to finish.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {PLATFORM_REGISTRY.filter(p => p.available && (connectedPlatforms.has(p.id) || p.id !== 'stremio')).map(p => {
          const isConnected = connectedPlatforms.has(p.id)
          const handleConnect = () => {
            setError('')
            if (p.id === 'nuvio') {
              setNuvioDialogOpen(true)
            } else if (p.id === 'realstream') {
              setRealstreamDialogOpen(true)
            } else if (p.id === 'hydra-outbound') {
              setHydraDialogOpen(true)
            }
          }
          return (
            <div
              key={p.id}
              className={cn(
                'group relative flex min-h-[148px] flex-col items-start gap-4 rounded-[1.35rem] border p-4 text-left transition-[background-color,border-color,box-shadow,transform]',
                isConnected
                  ? 'border-success/30 bg-success/5'
                  : 'border-border/45 bg-card/65 hover:-translate-y-0.5 hover:border-border/80 hover:bg-muted/30 hover:shadow-md'
              )}
            >
              <span className={cn(
                'flex h-11 w-11 items-center justify-center rounded-2xl border transition-colors',
                'border-border/45 bg-background/60 text-muted-foreground group-hover:text-foreground'
              )}>
                <img src={p.logo} alt={p.name} loading="lazy" className="h-6 w-6 rounded" />
              </span>
              <span className="space-y-1.5 pr-5 flex-1">
                <span className="block text-[15px] font-semibold leading-tight text-foreground">{p.name}</span>
                <span className="block text-xs leading-relaxed text-muted-foreground">{p.description}</span>
              </span>
              {isConnected ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
                  <Check className="h-3 w-3" />
                  Connected
                </span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleConnect}
                  className="rounded-xl font-bold text-xs"
                >
                  Connect
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  const renderEditingView = () => (
    <form onSubmit={handleSubmit} className="mt-4">
      <Tabs defaultValue="customize" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="customize">
            Customize
          </TabsTrigger>
          <TabsTrigger value="connections">
            Connections
          </TabsTrigger>
        </TabsList>

        <TabsContent value="customize" className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="edit-name" className="text-xs font-medium text-muted-foreground uppercase">Display Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Account"
              className="bg-background/50 border-muted focus:bg-background transition-colors h-10 rounded-xl"
              maxLength={32}
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Card Preview</p>
            {(() => {
              const hasAccent = accentColor && accentColor !== 'none'
              const displayName = name || (email ? email.split('@')[0] : 'My Account')
              const addonCount = loading ? '-' : editingAccount?.addons.length ?? 0
              return (
                <Card
                  className="pointer-events-none relative rounded-[1.35rem] border-border/45 bg-card/80 shadow-sm"
                >
                  <CardHeader className="relative z-10 px-4 pb-3 pt-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="relative shrink-0">
                          <AccountAvatar account={{ name: displayName, email, emoji, avatar, status: 'active' }} size="lg" showStatus={false} />
                          {hasAccent && (
                            <span
                              className="pointer-events-none absolute inset-0 rounded-xl"
                              style={{ boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accentColor} 65%, transparent)` }}
                              aria-hidden="true"
                            />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <CardTitle className="flex items-center gap-2 text-base font-semibold truncate tracking-tight">
                            <span className="truncate flex-1">{displayName}</span>
                          </CardTitle>
                          {email && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{email}</p>
                          )}
                          {liveAccount && (hasPlatformConnection(liveAccount) || (liveAccount.connections || []).filter(c => c.platform !== 'stremio').length > 0) && (
                            <div className="flex items-center gap-1 mt-1">
                              {getStremioAuthKey(liveAccount) && (
                                <PlatformLogo platform="stremio" className="h-5 w-5" />
                              )}
                              {(liveAccount.connections || []).filter(c => c.platform !== 'stremio').map(conn => (
                                <PlatformLogo key={conn.id} platform={conn.platform} className={cn("h-5 w-5", conn.enabled === false && "opacity-40 grayscale")} isHydra={conn.connectionType === 'hydra-outbound'} />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <Button variant="ghost" className="h-8 w-8 rounded-full p-0 text-muted-foreground opacity-30 shrink-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="relative z-10 px-4 pb-3">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="font-semibold text-foreground">{addonCount}</span>
                          addon{addonCount === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(!liveAccount || liveAccount.status !== 'error') && (
                          <span className="inline-flex h-6 items-center gap-1 rounded-full border border-success/25 bg-success/10 px-2 text-xs font-semibold text-success">
                            <ShieldCheck className="h-3 w-3" />
                            Healthy
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                  {liveAccount?.lastSync && (
                    <div className="px-4 pb-4 pt-1">
                      <span className="text-xs text-muted-foreground/60">Synced {new Date(liveAccount.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                    </div>
                  )}
                </Card>
              )
            })()}
          </div>

          <div className="space-y-4 px-1">
            <div className="space-y-3">
              <Label className="text-xs font-medium text-muted-foreground uppercase">Account Emoji</Label>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Input
                    id="emoji"
                    value={emoji}
                    onChange={(e) => setEmoji(e.target.value)}
                    placeholder="👤"
                    className="bg-background/50 border-muted focus:bg-background transition-colors w-14 h-14 text-center text-2xl p-0 rounded-xl shadow-inner"
                    maxLength={4}
                  />
                </div>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="subtle" size="icon" className="h-14 w-14 rounded-xl bg-background/50 border-muted hover:bg-muted/50 transition-[transform,opacity,box-shadow] shadow-sm">
                      <Smile className="h-6 w-6 opacity-60" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[320px] p-0 border-border/10 shadow-2xl overflow-hidden rounded-xl" align="start">
                    <div className="flex flex-col h-[380px] bg-popover">
                      <div className="p-3 border-b border-border/10 bg-muted/20">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Search emojis..."
                            className="pl-9 h-9 text-xs bg-muted/30 border border-border/40 focus:bg-muted/40 rounded-lg"
                            value={emojiSearch}
                            onChange={(e) => setEmojiSearch(e.target.value)}
                            autoFocus
                          />
                        </div>
                      </div>

                      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        {Object.entries(EMOJI_GROUPS).map(([group, emojis]) => {
                          const filtered = emojis.filter(e =>
                            e.keywords.some(k => k.toLowerCase().includes(emojiSearch.toLowerCase())) ||
                            e.char.includes(emojiSearch)
                          )
                          if (filtered.length === 0) return null

                          return (
                            <div key={group} className="mb-6 last:mb-0">
                              <h4 className="text-xs font-semibold text-primary/60 mb-3 px-1">{group}</h4>
                              <div className="grid grid-cols-6 gap-2">
                                {filtered.map((e) => (
                                  <Tooltip key={e.char} content={e.keywords[0]}>
                                    <button
                                      type="button"
                                      onClick={() => setEmoji(e.char)}
                                      className={`h-10 w-10 flex items-center justify-center text-xl rounded-xl transition-[transform,opacity,box-shadow] duration-200 hover:scale-115 hover:bg-primary/20 ${emoji === e.char ? `bg-primary/25 ring-2 ${isLight ? 'ring-primary' : 'ring-primary/50'} shadow-lg scale-110` : 'hover:bg-accent/40'}`}
                                    >
                                      {e.char}
                                    </button>
                                  </Tooltip>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-14 px-4 text-xs font-bold uppercase rounded-xl opacity-40 hover:opacity-100 hover:text-destructive hover:bg-destructive/5 transition-[transform,opacity,box-shadow]"
                  onClick={() => setEmoji('')}
                >
                  Clear
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div>
                <Label className="text-xs font-medium text-muted-foreground uppercase">Avatar URL</Label>
                <p className="text-xs text-muted-foreground mt-1">Direct image link (https://...). Overrides emoji when set. Syncs across devices.</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative h-10 w-10 rounded-lg border border-border/40 bg-muted/30 overflow-hidden flex items-center justify-center shrink-0">
                  <AccountAvatar account={{ name: name || 'Account', email, emoji, avatar: avatar || undefined, status: 'active' }} size="sm" showStatus={false} />
                </div>
                <input
                  type="url"
                  value={avatar.startsWith('data:') ? '\u2713 Uploaded image' : avatar}
                  onChange={(e) => setAvatar(e.target.value)}
                  readOnly={avatar.startsWith('data:')}
                  placeholder="https://example.com/avatar.png"
                  className="flex h-10 w-full rounded-md border border-border/50 bg-background/50 px-3 py-2 text-sm transition-[border,box-shadow] file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
                  autoComplete="off"
                  spellCheck={false}
                />
                {avatar && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setAvatar('')}
                    aria-label="Clear avatar URL"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
                <ImageUploadButton
                  onUploaded={(dataUrl) => setAvatar(dataUrl)}
                  options={{ maxDimension: 256, square: true, quality: 0.85 }}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                  label="Upload avatar"
                />
              </div>
            </div>

            <div className="space-y-4">
              <Label className="text-xs font-medium text-muted-foreground uppercase">Theme Color</Label>

              <div className="bg-muted/10 p-4 rounded-2xl border border-border/10 space-y-5">
                <div className="flex flex-wrap items-center gap-3">
                  <Tooltip content="No accent color" side="top">
                    <button
                      key="none"
                      type="button"
                      onClick={() => setAccentColor('none')}
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-[transform,opacity,box-shadow] hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background relative overflow-hidden group ${accentColor === 'none' ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background' : 'border border-foreground/20'}`}
                    >
                      <div className="absolute inset-x-0 h-0.5 bg-destructive/50 rotate-45" />
                      <div className="text-xs font-bold opacity-40 group-hover:opacity-100 transition-opacity">Off</div>
                    </button>
                  </Tooltip>

                  {ACCOUNT_COLORS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setAccentColor(hex)}
              className={`w-8 h-8 rounded-xl transition-[transform,opacity,box-shadow] hover:scale-115 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${accentColor === hex ? 'ring-2 ring-white ring-offset-2 ring-offset-background shadow-lg' : ''}`}
                      style={{ backgroundColor: hex }}
                    />
                  ))}

                  <Popover>
                    <Tooltip content="Custom color" side="top">
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                  className={`w-8 h-8 rounded-xl transition-[transform,opacity,box-shadow] hover:scale-115 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)] ${(accentColor && accentColor !== 'none' && !ACCOUNT_COLORS.includes(accentColor)) ? 'ring-2 ring-white ring-offset-2 ring-offset-background shadow-lg' : ''}`}
                        />
                      </PopoverTrigger>
                    </Tooltip>
                    <PopoverContent className="w-[280px] p-4" align="start">
                      <ColorPicker
                        value={accentColor && accentColor.startsWith('#') ? accentColor : '#6366f1'}
                        onChange={(hex) => setAccentColor(hex)}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl shadow-inner border border-foreground/10 shrink-0 transition-colors duration-500"
                    style={{ background: (accentColor && accentColor !== 'none') ? accentColor : 'transparent' }}
                  />
                  <div className="relative flex-1">
                    <Input
                      type="text"
                      value={accentColor === 'none' ? '' : (accentColor || '')}
                      onChange={(e) => {
                        const val = e.target.value
                        if (/^#[0-9a-fA-F]{0,6}$/.test(val)) setAccentColor(val)
                      }}
                      placeholder={accentColor === 'none' ? 'None' : "#hexcode"}
                      className="font-mono text-xs bg-background/50 border-muted focus:bg-background h-10 rounded-xl"
                      disabled={accentColor === 'none'}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-border/10 pt-4 space-y-1">
              <Label className="text-xs font-medium text-muted-foreground uppercase">Card Options</Label>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium">Hide last watched</p>
                  <p className="text-xs text-muted-foreground">Don't show what this account is currently watching on the card.</p>
                </div>
                <Switch
                  checked={hideLastWatched}
                  onCheckedChange={setHideLastWatched}
                />
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium">Hide addon preview</p>
                  <p className="text-xs text-muted-foreground">Don't show addon logos on the card.</p>
                </div>
                <Switch
                  checked={hideAddonPreview}
                  onCheckedChange={setHideAddonPreview}
                />
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium">Hide platform logos</p>
                  <p className="text-xs text-muted-foreground">Don't show connection logos on the card.</p>
                </div>
                <Switch
                  checked={hidePlatformLogos}
                  onCheckedChange={setHidePlatformLogos}
                />
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="connections" className="space-y-5">
          {editingAccount && (
            <ConnectionManager
              accountId={editingAccount.id}
              connections={liveAccount?.connections ?? editingAccount.connections}
              onSubDialogChange={(open) => { connectionSubDialogRef.current = open; if (!open) subDialogClosedAtRef.current = Date.now() }}
            />
          )}
        </TabsContent>
      </Tabs>

      {error && (
        <div className="bg-destructive/10 border border-destructive/50 rounded-xl px-4 py-3 mt-6 animate-in shake duration-500">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-destructive">{error}</p>
            </div>
          </div>
        </div>
      )}

      <DialogFooter className="mt-8 pt-2">
        <Button type="button" variant="subtle" onClick={handleClose} className="rounded-xl font-semibold text-xs">
          Cancel
        </Button>
        {mode !== 'oauth' && mode !== 'qr' && (
          <Button
            type="submit"
            disabled={loading || !encryptionKey}
            className="rounded-xl font-bold text-xs px-8 transition-[transform,opacity,box-shadow]"
          >
            {loading
              ? isEditing ? 'Updating...' : 'Adding...'
              : !encryptionKey ? 'Vault Locked' : isExpiredSession ? 'Restore Session' : isEditing ? 'Save Changes' : 'Create Account'}
          </Button>
        )}
      </DialogFooter>
    </form>
  )

  if (isEditing) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => { if (open) return; if (connectionSubDialogRef.current) return; if (Date.now() - subDialogClosedAtRef.current < 250) return; handleClose() }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Account</DialogTitle>
            <DialogDescription>
              {isExpiredSession
                ? 'Re-authenticate this account to restore sync.'
                : 'Update account details. Leave credentials blank to keep them unchanged.'}
            </DialogDescription>
          </DialogHeader>
          {renderEditingView()}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {wizardStep === 'identity'
              ? 'Create Account'
              : wizardStep === 'connect-more'
                ? 'Connect More Platforms'
                : platformStep === 'select'
                  ? 'Connect a Platform'
                  : 'Connect Stremio'}
          </DialogTitle>
          <DialogDescription>
            {wizardStep === 'identity'
              ? 'Set up your account identity.'
              : wizardStep === 'connect-more'
                ? 'Link additional platforms to this account.'
                : platformStep === 'select'
                  ? 'Link a streaming platform, or skip for a local-only hub.'
                  : 'Choose how to connect your Stremio account.'}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {wizardStep === 'identity'
            ? renderIdentityStep()
            : wizardStep === 'connect-more'
              ? renderConnectMoreStep()
              : renderPlatformStep()}
        </div>

        {error && (wizardStep === 'identity' || wizardStep === 'connect-more') && (
          <div className="bg-destructive/10 border border-destructive/50 rounded-xl px-4 py-3 animate-in shake duration-500">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-bold text-destructive">{error}</p>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="mt-6 pt-2">
          {wizardStep === 'identity' ? (
            <>
              <Button type="button" variant="subtle" onClick={handleClose} className="rounded-xl font-semibold text-xs">
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleIdentityNext}
                disabled={!name.trim()}
                className="rounded-xl font-bold text-xs px-8"
              >
                Next
              </Button>
            </>
          ) : wizardStep === 'connect-more' ? (
            <>
              <Button type="button" variant="subtle" onClick={handleClose} className="rounded-xl font-semibold text-xs">
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleClose}
                className="rounded-xl font-bold text-xs px-8"
              >
                Finish
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="subtle"
                onClick={() => {
                  if (platformStep === 'stremio-auth') {
                    setPlatformStep('select')
                    setError('')
                  } else {
                    setWizardStep('identity')
                  }
                }}
                className="rounded-xl font-semibold text-xs"
              >
                Back
              </Button>
              {!isEditing && (
                <Button
                  type="button"
                  variant="subtle"
                  onClick={handleSkipLocal}
                  disabled={loading}
                  className="rounded-xl font-semibold text-xs"
                >
                  Skip for Now
                </Button>
              )}
              {platformStep === 'stremio-auth' && mode !== 'oauth' && mode !== 'qr' && (
                <Button
                  type="button"
                  onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}
                  disabled={loading || !encryptionKey}
                  className="rounded-xl font-bold text-xs px-8"
                >
                  {loading ? 'Adding...' : !encryptionKey ? 'Vault Locked' : 'Connect & Create'}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <QRLinkDialog
      open={qrDialogOpen}
      onOpenChange={setQrDialogOpen}
      title="Log in with QR Code"
      description="Open your phone's Stremio app, scan the code, and approve the login."
      start={createStremioLink}
      poll={pollStremioLink}
      onClaimed={(session: QRSession) => {
        const authKey = (session.platformData as { authKey?: string } | undefined)?.authKey
        if (!authKey) {
          if (import.meta.env.DEV) console.error('[AccountForm] QR approval returned no auth key')
          return
        }
        setQrDialogOpen(false)
        handleOAuthApproved(authKey)
        setMode('oauth')
      }}
    />

    <NuvioSetupDialog
      open={nuvioDialogOpen}
      onOpenChange={setNuvioDialogOpen}
      onComplete={handleNuvioAccountComplete}
    />

    <RealStreamSetupDialog
      open={realstreamDialogOpen}
      onOpenChange={setRealstreamDialogOpen}
      onComplete={handleRealStreamAccountComplete}
    />

    <ProviderSetupDialog
      open={hydraDialogOpen}
      onOpenChange={setHydraDialogOpen}
      onComplete={handleHydraAccountComplete}
    />
  </>
  )
}
