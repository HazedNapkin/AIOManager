import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMemo, useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from '@/contexts/ThemeContext'
import { useSyncStore } from '@/store/syncStore'
import { useFailoverStore } from '@/store/failoverStore'
import { LogOut, Users, Package, Activity, BarChart3, Settings, HelpCircle, KeyRound, StickyNote, MoreHorizontal, X, Search, CloudOff, RefreshCw, Cloud, Zap, ZapOff } from 'lucide-react'
import { useVaultStore } from '@/store/vaultStore'
import { useProviderStore } from '@/store/providerStore'
import { useAccountStore } from '@/store/accountStore'
import { useAddonStore } from '@/store/addonStore'
import { PROVIDERS, getKeyAbbr } from '@/lib/constants'
import { Tooltip } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { formatDistanceToNow } from 'date-fns'
import { cn, safeHref } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const PRIMARY_NAV = [
  { to: '/', icon: Users, label: 'Accounts', match: (p: string) => p === '/' || p.startsWith('/account/') },
  { to: '/saved-addons', icon: Package, label: 'Addons', match: (p: string) => p === '/saved-addons' },
  { to: '/activity', icon: Activity, label: 'Activity', match: (p: string) => p === '/activity' },
  { to: '/vault', icon: KeyRound, label: 'Vault', match: (p: string) => p === '/vault' || p.startsWith('/vault/') },
]

const MORE_NAV = [
  { to: '/notes', icon: StickyNote, label: 'Notes', match: (p: string) => p === '/notes' },
  { to: '/metrics', icon: BarChart3, label: 'Metrics', match: (p: string) => p === '/metrics' },
  { to: '/replay', icon: null, label: 'Replay', match: (p: string) => p === '/replay' },
  { to: '/kronorium', icon: HelpCircle, label: 'Docs', match: (p: string) => p.startsWith('/kronorium') },
  { to: '/settings', icon: Settings, label: 'Settings', match: (p: string) => p === '/settings' },
]

interface MobileMoreTriggerProps {
  moreOpen: boolean
  setMoreOpen: (v: boolean | ((prev: boolean) => boolean)) => void
  isMoreActive: boolean
}

function MobileMoreTrigger({ moreOpen, setMoreOpen, isMoreActive }: MobileMoreTriggerProps) {
  return (
    <button
      onClick={() => setMoreOpen(v => !v)}
      className={`relative flex flex-col items-center justify-center pt-3 pb-1 px-1 w-full transition-colors ${isMoreActive || moreOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
      aria-label="More options"
    >
      <AnimatePresence>
        {isMoreActive && !moreOpen && (
          <motion.div
            layoutId="mobile-nav-dot"
            className="absolute top-1 w-1 h-1 rounded-full bg-primary"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          />
        )}
      </AnimatePresence>
      <MoreHorizontal className="h-5 w-5 mb-0.5" />
      <span className="text-xs font-medium tracking-tight">More</span>
    </button>
  )
}

export function MobileBottomNav() {
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const isMoreActive = MORE_NAV.some(item => item.match(location.pathname))

  return (
    <div className="md:hidden flex-shrink-0 relative z-50 bg-card/95 backdrop-blur-lg border-t border-border/40 flex items-center justify-around min-h-[80px] pb-[calc(env(safe-area-inset-bottom,0px)+10px)] shadow-[0_-10px_40px_hsl(var(--background)/0.8)]">
      {PRIMARY_NAV.map((item) => {
        const isActive = item.match(location.pathname)
        const Icon = item.icon
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`relative flex flex-col items-center justify-center pt-3 pb-1 px-1 w-full transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <AnimatePresence>
              {isActive && (
                <motion.div
                  layoutId="mobile-nav-dot-bottom"
                  className="absolute top-1 w-1 h-1 rounded-full bg-primary"
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </AnimatePresence>
            <Icon className="h-5 w-5 mb-0.5" />
            <span className="text-xs font-medium tracking-tight">{item.label}</span>
          </Link>
        )
      })}
      <MobileMoreTrigger moreOpen={moreOpen} setMoreOpen={setMoreOpen} isMoreActive={isMoreActive} />

      {createPortal(
        <AnimatePresence>
          {moreOpen && (
            <>
              <motion.div
                className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMoreOpen(false)}
              />
              <motion.div
                className="fixed bottom-[80px] left-0 right-0 z-40 bg-card/95 backdrop-blur-lg rounded-t-3xl border border-b-0 border-border/40 shadow-[0_-10px_40px_hsl(var(--background)/0.8)]"
                initial={{ y: 420 }}
                animate={{ y: 0 }}
                exit={{ y: 420 }}
                transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              >
                <div className="flex items-center justify-between px-5 pt-5 pb-3">
                    <span className="text-xs font-medium uppercase text-foreground/60">More</span>
                    <Button variant="ghost" onClick={() => setMoreOpen(false)} className="p-1 text-muted-foreground/60 hover:text-foreground" aria-label="Close menu">
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                <div className="grid grid-cols-3 gap-3 px-4 pb-6">
                    {MORE_NAV.map((item) => {
                        const isActive = item.match(location.pathname)
                        const Icon = item.icon
                        return (
                            <Link
                                key={item.to}
                                to={item.to}
                                onClick={() => setMoreOpen(false)}
                                className={`flex flex-col items-center justify-center py-5 px-3 rounded-2xl transition-colors gap-2.5 ${isActive ? 'bg-primary/12 text-primary' : 'text-foreground/70 hover:bg-muted/50 hover:text-foreground'}`}
                            >
                                {item.to === '/replay' ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="m11 19-9-7 9-7v14z" opacity="0.5" />
                                        <path d="m22 19-9-7 9-7v14z" />
                                    </svg>
                                ) : (
                                    Icon && <Icon className="h-6 w-6" />
                                )}
                                <span className="text-sm font-bold">{item.label}</span>
                            </Link>
                    )
                  })}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}

const NAV_ITEMS = [
  { to: '/', icon: Users, label: 'Accounts', badge: 'count' as const, match: (p: string) => p === '/' || p.startsWith('/account/') },
  { to: '/saved-addons', icon: Package, label: 'Addons', badge: 'count' as const, match: (p: string) => p === '/saved-addons' },
  { to: '/notes', icon: StickyNote, label: 'Notes', match: (p: string) => p === '/notes' },
  { to: '/vault', icon: KeyRound, label: 'Vault', match: (p: string) => p === '/vault' || p.startsWith('/vault/') },
  { to: '/activity', icon: Activity, label: 'Activity', match: (p: string) => p === '/activity' },
  { to: '/metrics', icon: BarChart3, label: 'Metrics', match: (p: string) => p === '/metrics' },
  { to: '/replay', icon: null, label: 'Replay', match: (p: string) => p === '/replay' },
  { to: '/kronorium', icon: HelpCircle, label: 'Docs', match: (p: string) => p.startsWith('/kronorium') },
  { to: '/settings', icon: Settings, label: 'Settings', match: (p: string) => p === '/settings' },
]

function TabBadge({ count, dotColor, isActive, glow }: { count?: number; dotColor?: string; isActive: boolean; glow?: boolean }) {
  const { isLight } = useTheme()
  if (count !== undefined) {
    return (
      <span className={cn(
        'ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md px-1 text-xs font-semibold tabular-nums',
        isLight
          ? (isActive || glow ? 'bg-muted text-foreground' : 'bg-muted/60 text-muted-foreground')
          : (isActive || glow ? 'bg-white/[0.10] text-foreground' : 'bg-white/[0.06] text-muted-foreground')
      )}>{count}</span>
    )
  }
  if (dotColor) {
    return <span className="ml-0.5 w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />
  }
  return null
}

export function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const { isLight, logoUrl } = useTheme()
  const auth = useSyncStore(s => s.auth)
  const logout = useSyncStore(s => s.logout)
  const isSyncing = useSyncStore(s => s.isSyncing)
  const isRefreshingFromCloud = useSyncStore(s => s.isRefreshingFromCloud)
  const lastSyncedAt = useSyncStore(s => s.lastSyncedAt)
  const lastSyncCheckedAt = useSyncStore(s => s.lastSyncCheckedAt)
  const syncHistory = useSyncStore(s => s.history)
  const syncToRemote = useSyncStore(s => s.syncToRemote)
  const rules = useFailoverStore(s => s.rules)
  const lastWorkerRun = useFailoverStore(s => s.lastWorkerRun)

  const keys = useVaultStore(s => s.keys)
  const health = useProviderStore(s => s.health)
  const accounts = useAccountStore(s => s.accounts)
  const library = useAddonStore(s => s.library)

  const activeRulesCount = useMemo(() => rules.filter(r => r.isActive).length, [rules])
  const hasRules = useMemo(() => rules.length > 0, [rules])
  const isServerLive = useMemo(() => lastWorkerRun && (Date.now() - new Date(lastWorkerRun).getTime()) < 180000, [lastWorkerRun])

  const autopilotStatus = useMemo(() => !isServerLive ? 'Offline' :
    !hasRules ? 'Standby' :
      activeRulesCount > 0 ? 'Live' : 'Paused'
  , [isServerLive, hasRules, activeRulesCount])

  const providerKeys = useMemo(() => keys
    .filter(k => ['real-debrid', 'torbox', 'premiumize', 'alldebrid', 'debrid-link'].includes(k.provider) || k.provider === 'other'),
  [keys])

  const addonCount = useMemo(() => Object.keys(library).length, [library])

  const syncTimeAgo = useMemo(() => {
    const display = lastSyncCheckedAt || lastSyncedAt
    if (!display) return ''
    return formatDistanceToNow(new Date(display), { addSuffix: true })
  }, [lastSyncCheckedAt, lastSyncedAt])

  const recentSyncError = useMemo(() => {
    const lastError = syncHistory.find(h => h.status === 'error')
    return lastError && (Date.now() - new Date(lastError.timestamp).getTime()) < 5 * 60 * 1000 ? lastError : null
  }, [syncHistory])

  const syncDotColor = useMemo(() => {
    const isOnline = auth.isAuthenticated
    if (!isOnline || (!isSyncing && !isRefreshingFromCloud && !lastSyncCheckedAt && !lastSyncedAt)) return 'bg-red-500'
    if (isSyncing || isRefreshingFromCloud) return 'bg-yellow-500 animate-pulse'
    if (recentSyncError) return 'bg-red-500'
    const lastCheck = lastSyncCheckedAt || lastSyncedAt
    const lastSync = lastCheck ? new Date(lastCheck).getTime() : 0
    if (Date.now() - lastSync > 5 * 60 * 1000) return 'bg-yellow-500'
    return 'bg-green-500'
  }, [auth.isAuthenticated, isSyncing, isRefreshingFromCloud, lastSyncCheckedAt, lastSyncedAt, recentSyncError])

  const [syncLabel, setSyncLabel] = useState('')
  useEffect(() => {
    const update = () => {
      if (!auth.isAuthenticated) { setSyncLabel('Offline'); return }
      if (isSyncing) { setSyncLabel('Syncing'); return }
      if (isRefreshingFromCloud) { setSyncLabel('Refreshing'); return }
      if (lastSyncCheckedAt || lastSyncedAt) { setSyncLabel(syncTimeAgo); return }
      setSyncLabel('Offline')
    }
    update()
    const interval = setInterval(update, 60000)
    return () => clearInterval(interval)
  }, [auth.isAuthenticated, isSyncing, isRefreshingFromCloud, lastSyncCheckedAt, lastSyncedAt, syncTimeAgo])

  const formatExpDate = useCallback((isoDate: string | null | undefined) => {
    if (!isoDate) return null
    const d = new Date(isoDate)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }, [])

  const [vaultOpen, setVaultOpen] = useState(false)

  const getBadgeData = useCallback((item: typeof NAV_ITEMS[number]): { count?: number; dotColor?: string } => {
    if (item.badge === 'count' && item.to === '/') return { count: accounts.length }
    if (item.badge === 'count' && item.to === '/saved-addons') return { count: addonCount }

    return {}
  }, [accounts.length, addonCount])

  const openCommandPalette = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-command-palette'))
  }, [])

  return (
    <>
    <header className="flex-shrink-0 relative z-50 md:sticky md:top-0 pointer-events-none">

      <div className={`relative z-[60] pointer-events-auto border-b border-border/40 ${isLight ? 'bg-card/92 backdrop-blur-xl' : 'glass-header backdrop-blur-xl'}`}>
        <div className="max-w-[1800px] mx-auto w-full px-4 h-12 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 shrink-0 hover:opacity-90 transition-opacity">
            <img
              src={logoUrl || "/logo.png"}
              alt="AIOManager"
              loading="lazy"
              onError={(e) => { if (e.currentTarget.src !== window.location.origin + '/logo.png') e.currentTarget.src = '/logo.png' }}
              className={`h-6 w-6 object-contain transition-[transform,opacity,box-shadow] ${!logoUrl && isLight ? 'invert' : ''}`}
            />
            <span className="text-[13px] font-bold tracking-tight text-foreground/90">AIOManager</span>
          </Link>

           {auth.isAuthenticated && (
            <Tooltip content="Logout" side="bottom">
              <Button
                variant="ghost"
                type="button"
                onClick={(e) => { e.preventDefault(); logout() }}
                className="md:hidden text-muted-foreground hover:text-destructive p-1.5 h-8 w-8 ml-auto"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </Tooltip>
          )}

          <div className="hidden md:flex items-center gap-2 ml-auto">
            <button
              onClick={openCommandPalette}
              className="h-8 w-72 rounded-lg bg-muted/40 hover:bg-muted/60 border border-border/40 flex items-center px-2.5 gap-2 transition-colors"
              aria-label="Search"
            >
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-[12px] text-muted-foreground flex-1 text-left">Search accounts, addons, keys...</span>
              <kbd className="text-xs px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground/60 shrink-0">⌘K</kbd>
            </button>

            <div className="relative flex items-center h-8 rounded-lg bg-muted/30 border border-border/40">
              <DropdownMenu open={vaultOpen} onOpenChange={setVaultOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-1.5 px-2.5 h-full rounded-l-lg hover:bg-muted/20 transition-colors"
                    aria-label="Vault keys"
                  >
                    <KeyRound className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-bold text-foreground/80 tabular-nums">{providerKeys.length}</span>
                  </button>
                </DropdownMenuTrigger>

                <DropdownMenuContent
                  align="end"
                  sideOffset={8}
                  className="w-[min(360px,90vw)] p-0 rounded-2xl overflow-hidden shadow-2xl border-border/40"
                  style={{
                    background: 'hsl(var(--card))',
                  }}
                >
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30 bg-muted/20">
                    <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Vault</div>
                    <div className="text-[13px] font-bold ml-auto">{providerKeys.length} key{providerKeys.length !== 1 ? 's' : ''}</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { navigate('/vault'); setVaultOpen(false); }}
                      className="h-7 px-2.5 ml-2 text-[11px] font-bold text-primary hover:bg-primary/10"
                    >
                      View all
                    </Button>
                  </div>
                  <div className="max-h-[320px] overflow-y-auto py-1 custom-scrollbar">
                    {providerKeys.length === 0 ? (
                      <div className="py-8 text-center px-4">
                        <KeyRound className="h-8 w-8 text-muted-foreground/60 mx-auto mb-2" />
                        <p className="text-xs text-muted-foreground">No keys in your vault</p>
                      </div>
                    ) : (
                      providerKeys.map((key) => {
                        const h = health[key.id]
                        const total = h?.daysRemaining
                        let remaining = ''
                        if (total !== null && total !== undefined) {
                          const years = Math.floor(total / 365)
                          const months = Math.floor((total % 365) / 30)
                          const days = total % 30
                          const parts: string[] = []
                          if (years > 0) parts.push(`${years}y`)
                          if (months > 0) parts.push(`${months}mo`)
                          if (days > 0 || parts.length === 0) parts.push(`${days}d`)
                          remaining = parts.join(' ')
                        }
                        const expDate = formatExpDate(h?.expiresAt)
                        const dashboardUrl = key.customDashboardUrl || PROVIDERS.find(p => p.value === key.provider)?.url
                        const isExpired = h?.status === 'expired'
                        const isExpiring = h?.status === 'active' && h.daysRemaining !== null && h.daysRemaining !== undefined && h.daysRemaining <= 30
                        const dotColor = isExpired ? 'bg-destructive' : isExpiring ? 'bg-warning' : h?.status === 'active' ? 'bg-success' : 'bg-muted-foreground/30'
                        return (
                          <button
                            key={key.id}
                            type="button"
                            className="flex items-center gap-3 w-full px-4 py-3 text-left transition-[transform,opacity,box-shadow] hover:bg-primary/5 group"
                            onClick={() => {
                              if (dashboardUrl) window.open(safeHref(dashboardUrl), '_blank', 'noopener,noreferrer');
                              setVaultOpen(false);
                            }}
                          >
                            <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                            <div className="h-8 w-8 rounded-lg bg-muted/50 border border-border/40 flex items-center justify-center text-xs font-bold text-muted-foreground group-hover:border-primary/30 group-hover:text-primary transition-colors">
                              {getKeyAbbr(key)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="block text-[13px] font-semibold text-foreground truncate">{key.name}</span>
                              {expDate ? (
                                <span className={cn("block text-[11px] mt-0.5 text-muted-foreground", isExpired ? "text-destructive" : isExpiring ? "text-warning" : "")}>
                                  {isExpired ? `Expired · ${expDate}` : `${remaining} left · ${expDate}`}
                                </span>
                              ) : remaining ? (
                                <span className="block text-[11px] mt-0.5 text-muted-foreground">{remaining} left</span>
                              ) : null}
                            </div>
                          </button>
                        )
                      })
                    )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              <Tooltip
                content={
                  !isServerLive ? 'Autopilot Server is offline' :
                    !hasRules ? 'Autopilot: No rules configured' :
                      activeRulesCount > 0 ? `Monitoring ${activeRulesCount} active rule${activeRulesCount !== 1 ? 's' : ''}` :
                        'Autopilot Paused'
                }
                side="bottom"
              >
                <div className="border-l border-border/30 flex items-center gap-1.5 px-2.5 h-full cursor-default">
                  {autopilotStatus === 'Live' && (
                    <span className="relative flex w-1.5 h-1.5">
                      <span className="absolute inline-flex w-full h-full rounded-full bg-warning opacity-60 animate-ping" />
                      <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-warning" />
                    </span>
                  )}
                  {autopilotStatus === 'Live'
                    ? <Zap className="h-3 w-3 text-warning" />
                    : <ZapOff className="h-3 w-3 text-muted-foreground" />
                  }
                  <span className={`text-xs font-bold tabular-nums ${
                    autopilotStatus === 'Live' ? 'text-warning' : 'text-foreground/60'
                  }`}>
                    {autopilotStatus === 'Live' ? activeRulesCount : autopilotStatus === 'Offline' ? 'Off' : autopilotStatus.charAt(0)}
                  </span>
                </div>
              </Tooltip>

              <Tooltip content={
                !auth.isAuthenticated ? 'Offline mode'
                  : recentSyncError ? `Sync failed: ${recentSyncError.message}. Click to retry.`
                  : isSyncing || isRefreshingFromCloud ? 'Syncing...'
                  : `Synced ${syncTimeAgo}`
              } side="bottom">
                <button
                  onClick={() => auth.isAuthenticated && syncToRemote(false)}
                  className="border-l border-border/30 flex items-center gap-1.5 px-2.5 h-full rounded-r-lg hover:bg-muted/20 transition-colors"
                  aria-label="Sync status"
                >
                  {!auth.isAuthenticated ? (
                    <CloudOff className="h-3 w-3 text-muted-foreground" />
                  ) : isSyncing || isRefreshingFromCloud ? (
                    <RefreshCw className="h-3 w-3 text-primary animate-spin" />
                  ) : (
                    <Cloud className="h-3 w-3 text-muted-foreground" />
                  )}
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${syncDotColor}`} />
                  <span className="text-xs font-bold text-foreground/60 tabular-nums">{syncLabel}</span>
                </button>
              </Tooltip>

            </div>

            {auth.isAuthenticated && (
              <div className="flex items-center gap-1.5">
                <Tooltip content={auth.id} side="bottom">
                  <div className="h-7 w-7 overflow-hidden rounded-full bg-primary/20 border border-primary/25 flex items-center justify-center text-xs font-bold text-primary cursor-default">
                    {auth.avatar ? (
                      <img src={auth.avatar} alt="" className="h-full w-full object-cover" />
                    ) : (
                      (auth.name || auth.id).charAt(0).toUpperCase()
                    )}
                  </div>
                </Tooltip>
                <Tooltip content="Logout" side="bottom">
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={(e) => { e.preventDefault(); logout() }}
                    className="text-muted-foreground/60 hover:text-destructive p-1"
                    aria-label="Sign out"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="md:hidden relative z-50 pointer-events-auto flex items-center justify-center gap-4 h-8 border-b border-border/30 bg-card/60 backdrop-blur-sm text-muted-foreground">
        <span className="flex items-center gap-1 text-xs">
          <KeyRound className="h-3 w-3" />
          <span className="font-semibold tabular-nums">{providerKeys.length}</span>
        </span>
        <span className="flex items-center gap-1 text-xs">
          {autopilotStatus === 'Live' ? <Zap className="h-3 w-3 text-warning" /> : <ZapOff className="h-3 w-3" />}
          <span className={`font-semibold ${autopilotStatus === 'Live' ? 'text-warning' : ''}`}>{autopilotStatus === 'Live' ? `Live · ${activeRulesCount}` : autopilotStatus}</span>
        </span>
        <span className="flex items-center gap-1 text-xs">
          {!auth.isAuthenticated ? <CloudOff className="h-3 w-3" /> : isSyncing || isRefreshingFromCloud ? <RefreshCw className="h-3 w-3 text-primary animate-spin" /> : <Cloud className="h-3 w-3" />}
          <span className={`w-1.5 h-1.5 rounded-full ${syncDotColor}`} />
          <span className="font-semibold">{syncLabel}</span>
        </span>
      </div>

      <div className="hidden md:block pointer-events-none">
        <div className="max-w-[1800px] mx-auto w-full px-4">
          <nav className="flex justify-center mt-1.5">
            <div className={cn(
              'pointer-events-auto inline-flex h-auto w-fit max-w-[calc(100%-1rem)] flex-wrap items-center justify-start gap-1.5 rounded-2xl border border-border/40 bg-card/92 p-1.5 text-muted-foreground shadow-sm backdrop-blur-xl',
              !isLight && 'border-white/10 bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
            )}>
              {NAV_ITEMS.map((item) => {
                const isActive = item.match(location.pathname)
                const Icon = item.icon
                const badgeData = getBadgeData(item)
                const useGlow = isActive && !isLight

                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setVaultOpen(false)}
                    className={cn(
                      'relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium transition-[transform,opacity,box-shadow]',
                      isActive
                        ? (isLight
                          ? 'border border-border/40 bg-background text-foreground shadow-sm'
                          : 'border border-white/10 bg-white/[0.08] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]')
                        : (isLight
                          ? 'text-muted-foreground hover:bg-background/45 hover:text-foreground'
                          : 'text-muted-foreground hover:bg-white/[0.055] hover:text-foreground')
                    )}
                  >
                    {item.to === '/replay' ? (
                      <motion.div initial="initial" animate="animate" className="flex items-center justify-center">
                        <motion.svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <motion.path d="m11 19-9-7 9-7v14z" variants={{ initial: { opacity: 0.4 }, animate: { opacity: [0.4, 1, 0.4], transition: { repeat: Infinity, duration: 1.5, ease: 'linear' } } }} />
                          <motion.path d="m22 19-9-7 9-7v14z" variants={{ initial: { opacity: 1 }, animate: { opacity: [1, 0.4, 1], transition: { repeat: Infinity, duration: 1.5, ease: 'linear' } } }} />
                        </motion.svg>
                      </motion.div>
                    ) : (
                      Icon && <Icon className="w-[15px] h-[15px]" strokeWidth={isActive ? 2.2 : 1.7} />
                    )}
                    <span>{item.label}</span>
                    <TabBadge count={badgeData.count} dotColor={badgeData.dotColor} isActive={isActive} glow={useGlow} />
                  </Link>
                )
              })}
            </div>
          </nav>
        </div>
      </div>
    </header>
  </>
  )
}
