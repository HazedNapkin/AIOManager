import { Layout } from '@/components/layout/Layout'
import { ScrollToTop } from '@/components/ScrollToTop'
import { Toaster } from '@/components/ui/toaster'
import { AppRoutes } from '@/routes'
import { useAccountStore, getStremioAuthKey, hasPlatformConnection } from '@/store/accountStore'
import { useAddonStore } from '@/store/addonStore'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { useProfileStore } from '@/store/profileStore'
import { useFailoverStore } from '@/store/failoverStore'
import { useSyncStore, markAccountsHydrated } from '@/store/syncStore'
import { useNotesStore } from '@/store/notesStore'
import { LoginPage } from '@/pages/LoginPage'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useNavigate, Routes, Route } from 'react-router-dom'
import { useEffect, useState, lazy, Suspense } from 'react'


import { AppLoader, LoadingScreen } from '@/components/common/LoadingScreen'

const ReplaySharePage = lazy(() => import('@/pages/ReplaySharePage').then(m => ({ default: m.ReplaySharePage })))

// Always-mounted modals are dead weight in the entry chunk: lazy + latch them so the code loads
// on first open (off the critical path) and stays mounted afterward to keep open/close animations.
const AccountForm = lazy(() => import('@/components/accounts/AccountForm').then(m => ({ default: m.AccountForm })))
const AddonInstaller = lazy(() => import('@/components/addons/AddonInstaller').then(m => ({ default: m.AddonInstaller })))
const KeybindingsHelp = lazy(() => import('@/components/KeybindingsHelp').then(m => ({ default: m.KeybindingsHelp })))
const WhatsNewModal = lazy(() => import('@/components/WhatsNewModal').then(m => ({ default: m.WhatsNewModal })))

function App() {
  const navigate = useNavigate()
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [deferredModalsMounted, setDeferredModalsMounted] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDeferredModalsMounted(true), 150); return () => clearTimeout(t) }, [])
  const initializeAccounts = useAccountStore((state) => state.initialize)
  const initializeAddons = useAddonStore((state) => state.initialize)
  const initializeAuth = useAuthStore((state) => state.initialize)
  const initializeUI = useUIStore((state) => state.initialize)
  const initializeProfiles = useProfileStore((state) => state.initialize)
  const initializeFailover = useFailoverStore((state) => state.initialize)
  const startFailoverAutomation = useFailoverStore((state) => state.startAutomation)
  const initializeNotes = useNotesStore((state) => state.initialize)
  const isLocked = useAuthStore((state) => state.isLocked)
  const encryptionKey = useAuthStore((state) => state.encryptionKey)
  const isAddAccountDialogOpen = useUIStore((state) => state.isAddAccountDialogOpen)
  const isAddAddonDialogOpen = useUIStore((state) => state.isAddAddonDialogOpen)
  // Latch: flip true on first open and stay true (keeps the modal mounted for close animations).
  const [accountFormSeen, setAccountFormSeen] = useState(false)
  const [addonInstallerSeen, setAddonInstallerSeen] = useState(false)
  const [keybindingsSeen, setKeybindingsSeen] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [storageUnavailable, setStorageUnavailable] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  const auth = useSyncStore(s => s.auth)

  useEffect(() => { if (isAddAccountDialogOpen) setAccountFormSeen(true) }, [isAddAccountDialogOpen])
  useEffect(() => { if (isAddAddonDialogOpen) setAddonInstallerSeen(true) }, [isAddAddonDialogOpen])
  useEffect(() => { if (showShortcuts) setKeybindingsSeen(true) }, [showShortcuts])

  useEffect(() => {
    const init = async () => {
      const storageProbe = (async () => {
        try {
          await new Promise<void>((resolve, reject) => {
            const req = indexedDB.open('__aio_probe__')
            req.onsuccess = () => { req.result.close(); indexedDB.deleteDatabase('__aio_probe__'); resolve() }
            req.onerror = () => reject(req.error)
            req.onblocked = () => reject(new Error('blocked'))
          })
        } catch {
          setStorageUnavailable(true)
        }
      })()

      try {
        initializeUI()
        await initializeAuth()
        await initializeAccounts() // Critical: Must load accounts before failover/addons
        markAccountsHydrated()

        // These can run in parallel after accounts are loaded
        const results = await Promise.allSettled([
          initializeAddons(),
          initializeProfiles(),
          initializeFailover(),
          initializeNotes(),
        ])
        const failures = results.filter(r => r.status === 'rejected')
        if (failures.length > 0) {
          failures.forEach((f, i) => {
            const names = ['Addons', 'Profiles', 'Failover', 'Notes']
            if (import.meta.env.DEV) console.error(`[Init] ${names[i]} failed:`, (f as PromiseRejectedResult).reason)
          })
        }

        await storageProbe
        startFailoverAutomation()
        setIsInitialized(true)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown initialization error'
        if (import.meta.env.DEV) console.error('[Init] Fatal error:', error)
        setInitError(message)
      }
    }

    init()
  }, [initializeAccounts, initializeAddons, initializeAuth, initializeUI, initializeProfiles, initializeFailover, startFailoverAutomation, initializeNotes])

  // Trigger sync when app unlocks to ensure parity (debounced to avoid racing visibility handler)
  useEffect(() => {
    if (!isLocked && auth.isAuthenticated && isInitialized) {
      if (import.meta.env.DEV) console.log('[App] Vault unlocked. Triggering fresh cloud pull.')
      const t = setTimeout(() => {
        useSyncStore.getState().refreshFromCloud().then(() => {
          useAccountStore.getState().syncAllAccounts()
        }).catch(e => { if (import.meta.env.DEV) console.error(e); import('@/hooks/use-toast').then(({ toast }) => { toast({ title: 'Sync failed', description: 'Data may be stale. Try refreshing.', variant: 'destructive' }) }) })
         useFailoverStore.getState().syncServerState().catch(e => { if (import.meta.env.DEV) console.error(e); import('@/hooks/use-toast').then(({ toast }) => { toast({ title: 'Sync failed', description: 'Data may be stale. Try refreshing.', variant: 'destructive' }) }) })
      }, 1500)
      return () => clearTimeout(t)
    }
  }, [isLocked, auth.isAuthenticated, isInitialized])

  useEffect(() => {
    // In-memory gates - no DB/localStorage writes
    const SYNC_INTERVAL = 5 * 60 * 1000
    const AUTO_UPDATE_INTERVAL = 6 * 60 * 60 * 1000
    const JITTER_MS = 5000  // Spread tab-focus storms across 0-5s to soften thundering-herd on shared instances
    let lastSync = 0
    let lastAutoUpdateCheck = 0
    let syncJitterTimer: ReturnType<typeof setTimeout> | null = null
    let autoUpdateJitterTimer: ReturnType<typeof setTimeout> | null = null

    const handleVisibility = () => {
        if (document.visibilityState === 'visible' && isInitialized && !isLocked) {
            const now = Date.now()
            if (now - lastSync > SYNC_INTERVAL) {
                lastSync = now
                if (syncJitterTimer) clearTimeout(syncJitterTimer)
                syncJitterTimer = setTimeout(() => {
                    syncJitterTimer = null
                    useFailoverStore.getState().pullServerState()
                    useAccountStore.getState().syncAllAccounts(true)
                }, Math.random() * JITTER_MS)
            }

            // Auto update - always on, fires on tab focus if enough time has passed
            if (Date.now() - lastAutoUpdateCheck > AUTO_UPDATE_INTERVAL) {
                lastAutoUpdateCheck = Date.now()
                if (autoUpdateJitterTimer) clearTimeout(autoUpdateJitterTimer)
                autoUpdateJitterTimer = setTimeout(() => {
                    autoUpdateJitterTimer = null
                    const accounts = useAccountStore.getState().accounts
                    const allAddons = accounts.flatMap(a => a.addons)
                    if (allAddons.length === 0) return
                    let aborted = false
                    const timeout = setTimeout(() => { aborted = true }, 60000)
                    import('@/api/addons').then(({ checkAddonUpdates }) => {
                        if (aborted) return
                        checkAddonUpdates(allAddons, 'Auto-Update').then(async updates => {
                            clearTimeout(timeout)
                            if (aborted) return
                            const withUpdates = updates.filter(u => u.hasUpdate)
                            if (withUpdates.length === 0) return

                            useAddonStore.getState().updateLatestVersions(
                                Object.fromEntries(withUpdates.map(u => [u.addonId, u.latestVersion]))
                            )

                            const updatableUrls = new Set(withUpdates.map(u => u.transportUrl))
                            const accountsWithUpdates = useAccountStore.getState().accounts
                                .filter(a => hasPlatformConnection(a) && a.addons.some(ad => updatableUrls.has(ad.transportUrl)))
                                .map(a => ({ id: a.id, authKey: getStremioAuthKey(a) }))

                            if (accountsWithUpdates.length > 0 && !aborted) {
                                const result = await useAddonStore.getState().bulkReinstallAddons(
                                    Array.from(updatableUrls),
                                    accountsWithUpdates,
                                    true
                                )
                                if (result.success > 0) {
                                    import('@/hooks/use-toast').then(({ toast }) => {
                                        toast({ title: 'Addons Updated', description: `${result.success} account${result.success !== 1 ? 's' : ''} updated to the latest version.` })
                                    })
                                }
                                if (result.failed > 0) {
                                    const failedSummary = result.errors.slice(0, 5).map(e => e.error)
                                    import('@/hooks/use-toast').then(({ toast }) => {
                                        toast({
                                            title: 'Auto-Update Failed',
                                            description: `Could not update: ${failedSummary.join(', ')}${result.errors.length > 5 ? ` and ${result.errors.length - 5} more` : ''}`,
                                            variant: 'destructive',
                                        })
                                    })
                                }
                            }
                        }).catch(err => { clearTimeout(timeout); if (import.meta.env.DEV) console.error(err) })
                    })
                }, Math.random() * JITTER_MS)
            }
        }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
        document.removeEventListener('visibilitychange', handleVisibility)
        if (syncJitterTimer) clearTimeout(syncJitterTimer)
        if (autoUpdateJitterTimer) clearTimeout(autoUpdateJitterTimer)
    }
  }, [isInitialized, isLocked])

  // Sync UUID to URL for easy bookmarking/sharing
  useEffect(() => {
    if (auth.isAuthenticated && auth.id && isInitialized) {
      const url = new URL(window.location.href)
      if (url.searchParams.get('id') !== auth.id) {
        url.searchParams.set('id', auth.id)
        window.history.replaceState({}, '', url.toString())
      }
    }
  }, [auth.isAuthenticated, auth.id, isInitialized])

  // Keyboard Shortcuts
  useEffect(() => {
    let lastKey = ''
    let lastKeyTime = 0

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      const now = Date.now()
      const key = e.key.toLowerCase()

      // ? for help
      if (key === '?' || key === '/') {
        if (key === '?' || (key === '/' && e.shiftKey)) {
          setShowShortcuts(true)
          return
        }
      }

      // g + key navigation
      if (lastKey === 'g' && now - lastKeyTime < 500) {
        switch (key) {
          case 'a': navigate('/'); break;
          case 's': navigate('/saved-addons'); break;
          case 'h': navigate('/activity'); break;
          case 'm': navigate('/metrics'); break;
          case 'n': navigate('/notes'); break;
          case 'p': navigate('/settings'); break;
          case 'v': navigate('/vault'); break;
          case 'f': navigate('/kronorium'); break;
          case 'r': navigate('/replay'); break;
        }
      }

      lastKey = key
      lastKeyTime = now
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate])

  // Auth bypass for Share Links - Must run before isInitialized check
  if (/^\/replay\/share\/[^/]+$/.test(window.location.pathname)) {
    return (
      <Routes>
        <Route path="/replay/share/:token" element={
          <Suspense fallback={<AppLoader variant="route" />}>
            <ReplaySharePage />
          </Suspense>
        } />
      </Routes>
    )
  }

  if (storageUnavailable) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md text-center space-y-3">
          <p className="text-lg font-semibold text-foreground">Storage Unavailable</p>
          <p className="text-sm text-muted-foreground">
            AIOManager requires IndexedDB to store your encrypted account data.
            This is blocked in private/incognito mode in some browsers (e.g. Firefox).
            Try opening the app in a regular window, or use Chrome/Edge in private mode instead.
          </p>
        </div>
      </div>
    )
  }

  if (initError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md text-center space-y-4">
          <p className="text-lg font-semibold text-destructive">Initialization Failed</p>
          <p className="text-sm text-muted-foreground">{initError}</p>
          <button
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            onClick={() => { setInitError(null); window.location.reload() }}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!isInitialized) {
    return (
      <LoadingScreen />
    )
  }

  // Auth Guard: Force login if not authenticated, if the session is locked, or if we are
  // authenticated but have no encryption key (a keyless state must never render the app).
  // Bypass if visiting a Replay share link (stateless)
  const isShareLink = /^\/replay\/share\//.test(window.location.pathname)
  const isKronoriumRoute = window.location.pathname.startsWith('/kronorium')

  if ((!auth.isAuthenticated || isLocked || !encryptionKey) && !isShareLink && !isKronoriumRoute) {
    // Check for Deep Link (Parity with AIOStreams)
    // If user visits /account/<UUID> directly, we want to pre-fill that UUID
    const path = window.location.pathname
    const match = path.match(/^\/account\/([a-zA-Z0-9-]+)/)

    if (match && match[1]) {
      // Redirect to login with ID param
      const uuid = match[1]
      const currentId = new URLSearchParams(window.location.search).get('id')
      if (currentId !== uuid) {
        window.location.href = `/?id=${uuid}`
        return null // Halt rendering
      }
    }

    return <LoginPage />
  }

  if (isKronoriumRoute) {
    return (
      <TooltipProvider delayDuration={700} skipDelayDuration={0}>
        <ScrollToTop />
        <AppRoutes />
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider delayDuration={700} skipDelayDuration={0}>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-0 focus:left-0 focus:z-50 focus:p-4 focus:bg-background focus:text-foreground">Skip to main content</a>
      <Layout>
        <ScrollToTop />
        <AppRoutes />

        {accountFormSeen && <Suspense fallback={null}><AccountForm /></Suspense>}
        {addonInstallerSeen && <Suspense fallback={null}><AddonInstaller /></Suspense>}

        {deferredModalsMounted && <Suspense fallback={null}><WhatsNewModal /></Suspense>}
        {keybindingsSeen && <Suspense fallback={null}><KeybindingsHelp isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} /></Suspense>}
      </Layout>
      <Toaster />
    </TooltipProvider>
  )
}




export default App
