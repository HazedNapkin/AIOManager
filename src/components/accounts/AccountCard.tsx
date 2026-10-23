import { Button } from '@/components/ui/button'
import { prefetchAccountDetail } from '@/lib/account-prefetch'
import { Tooltip } from '@/components/ui/tooltip'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { AccountAvatar } from './AccountAvatar'
import { AccountMediaPlayback } from './AccountMedia'
import { AccountSyncIndicator } from './AccountSyncIndicator'
import { useJellyfinActivity } from '@/hooks/useJellyfinActivity'
import { accountMediaPlayback, mergeMediaItems } from '@/lib/jellyfin/activity'
import { PlatformSourceChip, platformName } from '@/components/addons/PlatformSourceChip'
import { accountPlatformSources } from '@/components/addons/platform-source'
import { CopyButton } from '@/components/ui/copy-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useUIStore } from '@/store/uiStore'
import { useFailoverStore } from '@/store/failoverStore'
import { useLibraryCache } from '@/store/libraryCache'
import { activityForAccount } from '@/lib/account-activity-index'
import { Account, type AddonChangelogEntry } from '@/types/account'
import type { ActivityItem } from '@/types/activity'
import { AlertCircle, MoreVertical, Pencil, RefreshCw, Trash, GripVertical, ArrowUpRight, ArrowUpCircle, RotateCw, StickyNote, Undo2, Redo2, Bold, Italic, List, ListOrdered, Link2, Check, Trash2, Activity, ArrowRightLeft, CheckCircle2, Play } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { cn, getLatestAddonVersion, maskEmailLevel, maskNameLevel, getTimeAgo, isNewerVersion } from '@/lib/utils'
import { STICKY_NOTE_MAX_LENGTH } from '@/lib/constants'
import { memo, useMemo, useRef, useEffect, useState, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useLongPress } from '@/hooks/useLongPress'
import { useToast } from '@/hooks/use-toast'
import { useRelativeTime } from '@/hooks/use-relative-time'
import { useAddonStore } from '@/store/addonStore'
import { useAccountStore, getAccountEmail, getStremioAuthKey, hasPlatformConnection } from '@/store/accountStore'

function HideableImage({ src, alt, className, fallback, style, dataThemePart }: { src?: string; alt?: string; className?: string; fallback?: string; style?: React.CSSProperties; dataThemePart?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  if (!src || failed) {
    if (fallback) {
      return (
        <div data-theme-part={dataThemePart} className={cn(className, 'flex items-center justify-center text-[8px] font-bold text-muted-foreground')} style={style}>
          {fallback}
        </div>
      )
    }
    return null
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      data-theme-part={dataThemePart}
      className={className}
      style={style}
    />
  )
}

// Module-level memo for the "changes today" chip: the changelog is scanned once per
// changelog publication (with a 60s TTL for the sliding 24h window), not once per card
// on every store write. In a 100-card grid that turns N x M work per sync into N O(1)
// map lookups. The shared 60s relative-time ticker still refreshes the rendered count.
// Semantics match the previous inline filter (entries strictly newer than 24h,
// invalid timestamps dropped); only the 24h boundary can lag by up to the 60s TTL.
// A new changelog array (sync append, clearChangelog) always rebuilds immediately.
let recentChangeCountsCache: { changelog: AddonChangelogEntry[]; builtAt: number; counts: Map<string, number> } | null = null
const RECENT_CHANGE_TTL_MS = 60_000
function recentChangeCountsFor(changelog: AddonChangelogEntry[], now: number): Map<string, number> {
  if (recentChangeCountsCache && recentChangeCountsCache.changelog === changelog && now - recentChangeCountsCache.builtAt < RECENT_CHANGE_TTL_MS) {
    return recentChangeCountsCache.counts
  }
  const cutoff = now - 24 * 60 * 60 * 1000
  const counts = new Map<string, number>()
  for (const entry of changelog) {
    const ts = new Date(entry.timestamp).getTime()
    if (!Number.isFinite(ts) || ts <= cutoff) continue
    counts.set(entry.accountId, (counts.get(entry.accountId) || 0) + 1)
  }
  recentChangeCountsCache = { changelog, builtAt: now, counts }
  return counts
}

interface AccountCardProps {
  account: Account
  isSelected?: boolean
  onToggleSelect?: (accountId: string) => void
  onLongPress?: (accountId: string) => void
  onDelete?: (accountId: string) => void
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
  isSelectionMode?: boolean
  isPrivacyMode?: boolean
}

export const AccountCard = memo(function AccountCard({
  account,
  isSelected = false,
  onToggleSelect,
  onLongPress,
  onDelete,
  isSelectionMode = false,
  isPrivacyMode = false,
  ...restProps
}: AccountCardProps) {
  const navigate = useNavigate()
  const preventNavRef = useRef(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const handleMenuOpenChange = useCallback((open: boolean) => {
    setIsMenuOpen(open)
    if (!open) {
      preventNavRef.current = true
      setTimeout(() => { preventNavRef.current = false }, 400)
    }
  }, [])
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteValue, setNoteValue] = useState(account.note || '')
  const [noteHistory, setNoteHistory] = useState<string[]>([account.note || ''])
  const [noteHistoryIdx, setNoteHistoryIdx] = useState(0)
  const [noteIsEditing, setNoteIsEditing] = useState(false)
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null)
  const skipNoteAutoSaveRef = useRef(false)
  const noteLength = noteValue.length
  const noteLimitExceeded = noteLength > STICKY_NOTE_MAX_LENGTH
  const noteNearLimit = noteLength >= STICKY_NOTE_MAX_LENGTH - 20
  const noteCountLabel = `${noteLength} / ${STICKY_NOTE_MAX_LENGTH}`

  const pushNoteHistory = useCallback((val: string) => {
    setNoteHistory(prev => {
      const next = prev.slice(0, noteHistoryIdx + 1)
      next.push(val)
      return next.length > 50 ? next.slice(-50) : next
    })
    setNoteHistoryIdx(prev => Math.min(prev + 1, 49))
  }, [noteHistoryIdx])

  const noteUndo = useCallback(() => {
    if (noteHistoryIdx > 0) { const ni = noteHistoryIdx - 1; setNoteHistoryIdx(ni); setNoteValue(noteHistory[ni]) }
  }, [noteHistoryIdx, noteHistory])

  const noteRedo = useCallback(() => {
    if (noteHistoryIdx < noteHistory.length - 1) { const ni = noteHistoryIdx + 1; setNoteHistoryIdx(ni); setNoteValue(noteHistory[ni]) }
  }, [noteHistoryIdx, noteHistory])

  const noteWrapSel = useCallback((before: string, after: string) => {
    const ta = noteTextareaRef.current; if (!ta) return
    const s = ta.selectionStart, e = ta.selectionEnd
    const sel = noteValue.slice(s, e)
    const newVal = noteValue.slice(0, s) + before + sel + after + noteValue.slice(e)
    if (newVal.length > STICKY_NOTE_MAX_LENGTH && newVal.length > noteValue.length) return
    setNoteValue(newVal); pushNoteHistory(newVal)
    setTimeout(() => { ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + sel.length; ta.focus() }, 0)
  }, [noteValue, pushNoteHistory])

  const noteInsertPrefix = useCallback((prefix: string) => {
    const ta = noteTextareaRef.current; if (!ta) return
    const start = ta.selectionStart
    const lineStart = noteValue.lastIndexOf('\n', start - 1) + 1
    const newVal = noteValue.slice(0, lineStart) + prefix + noteValue.slice(lineStart)
    if (newVal.length > STICKY_NOTE_MAX_LENGTH && newVal.length > noteValue.length) return
    setNoteValue(newVal); pushNoteHistory(newVal)
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + prefix.length; ta.focus() }, 0)
  }, [noteValue, pushNoteHistory])

  const handleNoteChange = useCallback((newVal: string) => {
    if (newVal.length > STICKY_NOTE_MAX_LENGTH && newVal.length > noteValue.length) return
    setNoteValue(newVal)
    pushNoteHistory(newVal)
  }, [noteValue.length, pushNoteHistory])

  const handleNoteOpen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    preventNavRef.current = true
    setNoteValue(account.note || '')
    setNoteHistory([account.note || ''])
    setNoteHistoryIdx(0)
    setNoteIsEditing(!account.note?.trim())
    setNoteOpen(true)
  }, [account.note])

  const handleNoteClose = useCallback((open: boolean) => {
    if (!open) {
      if (noteIsEditing && !skipNoteAutoSaveRef.current) {
        useAccountStore.getState().updateAccountNote(account.id, noteValue)
      }
      skipNoteAutoSaveRef.current = false
      preventNavRef.current = true
      setTimeout(() => { preventNavRef.current = false }, 400)
    }
    setNoteOpen(open)
  }, [account.id, noteIsEditing, noteValue])

  const handleNoteSave = useCallback(() => {
    useAccountStore.getState().updateAccountNote(account.id, noteValue)
    if (noteValue.trim()) { setNoteIsEditing(false) } else { handleNoteClose(false) }
  }, [account.id, noteValue, handleNoteClose])

  const handleNoteClear = useCallback(() => {
    skipNoteAutoSaveRef.current = true
    setNoteValue('')
    useAccountStore.getState().updateAccountNote(account.id, '')
    handleNoteClose(false)
  }, [account.id, handleNoteClose])
  const { toast } = useToast()
  useRelativeTime()
  const syncAccount = useAccountStore((state) => state.syncAccount)
  const repairAccount = useAccountStore((state) => state.repairAccount)
  const loading = useAccountStore((state) => state.loadingAccounts.has(account.id))
  const { openAddAccountDialog, isAddAccountDialogOpen, privacyLevelNames } = useUIStore(
    useShallow((state) => ({
      openAddAccountDialog: state.openAddAccountDialog,
      isAddAccountDialogOpen: state.isAddAccountDialogOpen,
      privacyLevelNames: state.privacyLevelNames
    }))
  )
  const failoverRules = useFailoverStore(
    useShallow((state) => state.rules.filter(r => r.accountId === account.id))
  )
  const activeRules = useMemo(() => failoverRules.filter(r => r.isActive), [failoverRules])
  const failedOverRules = useMemo(() => activeRules.filter(r => r.activeUrl !== r.priorityChain?.[0]), [activeRules])



  const latestVersions = useAddonStore((state) => state.latestVersions)
  const updateCount = useMemo(() =>
    account.addons.filter(addon => {
      const latest = getLatestAddonVersion(latestVersions, addon)
      return latest && isNewerVersion(addon.manifest.version, latest)
    }).length,
    [account.addons, latestVersions]
  )
  const recentChanges = useAccountStore(
    (state) => recentChangeCountsFor(state.changelog, Date.now()).get(account.id) ?? 0
  )

  // Watch dialog state to prevent accidental navigation when it closes
  useEffect(() => {
    if (!isAddAccountDialogOpen) {
      preventNavRef.current = true
      const timer = setTimeout(() => {
        preventNavRef.current = false
      }, 400)
      return () => clearTimeout(timer)
    }
  }, [isAddAccountDialogOpen])

  const [isStabilized, setIsStabilized] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setIsStabilized(true), 1800)
    return () => clearTimeout(timer)
  }, [])

  const cachedAccountItems = useLibraryCache(
    useShallow((state) => activityForAccount(state.items, account.id))
  )
  const libraryLoading = useLibraryCache((state) => state.loading)
  const media = useJellyfinActivity(account.id)
  const accountItems = useMemo(() => mergeMediaItems(cachedAccountItems, media.history), [cachedAccountItems, media.history])

  const prevLastWatchedRef = useRef<ActivityItem | null>(null)

  const lastWatched = useMemo(() => {
    // Wait for this account's media history (or its encrypted snapshot) before
    // choosing a native-platform fallback during the first read after reload.
    if (media.initialLoading && media.history.length === 0) return null
    if (accountItems.length === 0 && libraryLoading) return prevLastWatchedRef.current

    if (accountItems.length === 0) {
      if (libraryLoading) return prevLastWatchedRef.current
      prevLastWatchedRef.current = null
      return null
    }

    const latest = accountItems.reduce<ActivityItem>(
      (max, item) => new Date(item.timestamp).getTime() > new Date(max.timestamp).getTime() ? item : max,
      accountItems[0]
    )
    prevLastWatchedRef.current = latest
    return latest
  }, [accountItems, libraryLoading, media.initialLoading, media.history.length])
  const mediaPlayback = accountMediaPlayback(media.playback, lastWatched)

  const handleEdit = () => {
    openAddAccountDialog(account)
  }

  const accountEmail = getAccountEmail(account)
  const isNameCustomized = account.name !== accountEmail && account.name !== 'Account' && account.name !== 'Stremio Account'
  const privacyLevel = isPrivacyMode ? privacyLevelNames : 0
  const displayName = isNameCustomized
    ? maskNameLevel(account.name, privacyLevel)
    : account.name && account.name.includes('@')
      ? maskEmailLevel(account.name, privacyLevel)
      : maskNameLevel(account.name || accountEmail || 'Unnamed Account', privacyLevel)

  const hasAccentColor = account.accentColor && account.accentColor !== 'none'
  const accentColor = hasAccentColor ? account.accentColor! : null
  const enabledAddons = account.addons.filter(a => a.flags?.enabled !== false)
  const addonPreviewCount = (() => {
    try { return parseInt(localStorage.getItem('aioman:addon-preview-count') || '4') } catch { return 4 }
  })()
  const previewAddons = addonPreviewCount === 0 ? enabledAddons : enabledAddons.slice(0, addonPreviewCount)
  const remainingCount = addonPreviewCount === 0 ? 0 : Math.max(0, enabledAddons.length - addonPreviewCount)
  const hasPlatformSources = accountPlatformSources(account).length > 0
  const expiredConnection = account.connections?.find(connection => connection.enabled !== false && connection.status === 'expired')

  const { isLongPressTriggered, ...longPressProps } = useLongPress(() => {
    if (!isSelectionMode && onLongPress) {
      onLongPress(account.id)
    }
  })

  const handleCardActivate = () => {
    if (preventNavRef.current || isLongPressTriggered) return
    if (isSelectionMode && onToggleSelect) {
      onToggleSelect(account.id)
    } else if (!isSelectionMode) {
      navigate(`/account/${account.id}`)
    }
  }
  const noteToolbarButtonClass = 'h-8 w-8 rounded-xl text-muted-foreground hover:bg-muted/50 hover:text-foreground'
  const statChipClass = 'inline-flex h-4 items-center gap-1 leading-none'
  const statCountClass = 'text-[11px] font-medium leading-none tabular-nums'

  return (
    <Card
      data-account-card={account.id}
      data-selected={Boolean(isSelected)}
      {...longPressProps}
      role="button"
      tabIndex={0}
      onMouseEnter={() => { if (!isSelectionMode) prefetchAccountDetail(account.id) }}
      onFocus={() => { if (!isSelectionMode) prefetchAccountDetail(account.id) }}
      className={cn(
        'group relative flex h-full min-w-0 cursor-pointer flex-col rounded-2xl border border-border/40 bg-card shadow-sm transition-[background-color,border-color,box-shadow,transform,opacity] duration-200 hover:-translate-y-0.5 hover:border-border/70 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        isSelectionMode && 'hover:border-primary/45',
        isSelected && 'border-primary/35 bg-primary/10 ring-2 ring-primary/20',
        isMenuOpen && 'z-40'
      )}
      onClick={(e) => {
        if (e.detail === 0) return
        handleCardActivate()
      }}
      onKeyDown={(e) => {
        if (noteOpen) return
        // Nested focusables (menu trigger, note toggle, dismiss chip) handle their own
        // Enter/Space; only keys pressed on the card itself activate navigation.
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardActivate() }
      }}
    >
      {isSelected && (
        <div
          data-theme-part="checkbox"
          data-state="checked"
          className="absolute -top-2 -right-2 z-30 w-6 h-6 rounded-full border-2 border-background bg-primary shadow-lg flex items-center justify-center transition-[transform,opacity,box-shadow] animate-in zoom-in-50 duration-200"
        >
          <svg className="w-3.5 h-3.5 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
      <div className={`flex flex-col flex-1 min-h-0 ${isSelectionMode ? 'pointer-events-none' : ''}`}>
        <CardHeader className="relative space-y-0 px-5 pb-2 pt-5 md:px-6 md:pt-6">

          {restProps.dragHandleProps && (
            <div
              {...restProps.dragHandleProps}
              className="
              absolute left-0 top-0 bottom-0 px-4
              flex items-center justify-center
              cursor-grab active:cursor-grabbing
              text-muted-foreground hover:text-foreground
              hover:bg-accent/50 transition-colors
              z-10
            "
              style={{ touchAction: 'none' }}
            >
              <GripVertical className="h-5 w-5" />
            </div>
          )}
          <div className="flex items-center justify-between relative z-10">
            <div className={`flex items-center gap-3 flex-1 min-w-0 ${restProps.dragHandleProps ? 'pl-8' : ''}`}>

              <div className="relative shrink-0">
                <AccountAvatar account={account} size="lg" className="h-11 w-11" />
                {accentColor && (
                  <span
                    data-theme-part="account-accent"
                    className="pointer-events-none absolute inset-0 rounded-xl"
                    style={{ boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accentColor} 65%, transparent)` }}
                    aria-hidden="true"
                  />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <CardTitle className="flex items-center gap-2 truncate text-base font-semibold leading-tight tracking-tight">
                  <span className="truncate flex-1">{displayName}</span>
                </CardTitle>

                {accountEmail && accountEmail !== account.name && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate sr-only">
                    {maskEmailLevel(accountEmail, privacyLevel)}
                  </p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs leading-tight text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    {!account.hidePlatformLogos && hasPlatformSources && (
                      <span className="inline-flex items-center border-r border-border/50 pr-2">
                        <PlatformSourceChip account={account} />
                      </span>
                    )}
                    {!hasPlatformSources && (
                      <span className="border-r border-border/50 pr-2 text-[11px]">Local</span>
                    )}
                    <span className="whitespace-nowrap">{account.addons.length} addon{account.addons.length !== 1 ? 's' : ''}</span>
                  </span>
                  {updateCount > 0 && (
                    <Tooltip content={`${updateCount} update${updateCount !== 1 ? 's' : ''} available`} side="top">
                      <span aria-label={`${updateCount} update${updateCount !== 1 ? 's' : ''} available`} data-theme-part="badge" className={cn(statChipClass, 'text-primary')}>
                        <ArrowUpCircle className="h-3 w-3" />
                        <span className={statCountClass}>{updateCount}</span>
                      </span>
                    </Tooltip>
                  )}
                  {recentChanges > 0 && updateCount === 0 && (
                    <Tooltip content={`${recentChanges} change${recentChanges !== 1 ? 's' : ''} today · Click to dismiss`} side="top">
                      <button
                        data-theme-part="badge"
                        onClick={(e) => {
                          e.stopPropagation()
                          useAccountStore.getState().clearChangelog(account.id)
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}
                        aria-label={`${recentChanges} change${recentChanges !== 1 ? 's' : ''} today`}
                        className={cn(statChipClass, 'cursor-pointer rounded-sm text-primary transition-colors hover:bg-muted/50')}
                      >
                        <Activity className="h-3 w-3" />
                        <span className={statCountClass}>{recentChanges}</span>
                      </button>
                    </Tooltip>
                  )}
                  {activeRules.length > 0 && (
                    <Tooltip content={failedOverRules.length > 0
                      ? `${failedOverRules.length} rule${failedOverRules.length !== 1 ? 's' : ''} failed over`
                      : `${activeRules.length} Autopilot rule${activeRules.length !== 1 ? 's' : ''} healthy`} side="top">
                      <span
                        aria-label={failedOverRules.length > 0
                          ? `${failedOverRules.length} rule${failedOverRules.length !== 1 ? 's' : ''} failed over`
                          : `${activeRules.length} Autopilot rule${activeRules.length !== 1 ? 's' : ''} healthy`}
                        data-theme-part="badge"
                        className={cn(statChipClass, failedOverRules.length > 0 ? 'text-warning' : 'text-success')}
                      >
                        {failedOverRules.length > 0 ? <ArrowRightLeft className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                        <span className={statCountClass}>{failedOverRules.length || activeRules.length}</span>
                      </span>
                    </Tooltip>
                  )}
                </div>
              </div>

              {!isSelectionMode && (
                <DropdownMenu onOpenChange={handleMenuOpenChange}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="-mr-1 h-8 w-7 shrink-0 rounded-full p-0 text-muted-foreground hover:bg-muted/45 hover:text-foreground" onClick={(e) => e.stopPropagation()}>
                      <span className="sr-only">Open menu</span>
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="z-50 w-56">
                    <div className="px-2 py-1.5 text-xs font-medium uppercase text-muted-foreground">MANAGE ACCOUNT</div>
                    {account.status === 'expired' && (
                      <DropdownMenuItem className="gap-2 text-warning focus:text-warning" onClick={(e) => { e.stopPropagation(); handleEdit(); }}>
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        Fix Session
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem className="gap-2" onClick={(e) => { e.stopPropagation(); handleEdit(); }}>
                        <Pencil className="h-4 w-4 shrink-0" />
                        Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          toast({ title: 'Syncing...', description: `Refreshing ${displayName}` });
                          await syncAccount(account.id, true);
                          toast({ title: 'Sync Complete', description: `Successfully synced ${displayName}` });
                        } catch (err) {
                          toast({ variant: 'destructive', title: 'Sync Failed', description: `Could not sync ${displayName}: ${err instanceof Error ? err.message : 'unknown error'}` });
                        }
                      }}
                      disabled={loading}
                      className="gap-2"
                    >
                      <RefreshCw className={`h-4 w-4 shrink-0 ${loading ? 'animate-spin' : ''}`} />
                      Sync
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          toast({ title: 'Repairing...', description: `Deep-refreshing ${displayName}` });
                          await repairAccount(account.id);
                          toast({ title: 'Repair Complete', description: `Account ${displayName} is now healthy` });
                        } catch (err) {
                          toast({ variant: 'destructive', title: 'Repair Failed', description: `Failed to repair ${displayName}` });
                        }
                      }}
                      disabled={loading}
                      className="gap-2 cursor-pointer"
                    >
                      <RefreshCw className={`h-4 w-4 shrink-0 text-warning ${loading ? 'animate-spin' : ''}`} />
                      Repair
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!hasPlatformConnection(account)) return;
                        try {
                          toast({ title: 'Reinstalling...', description: `Reinstalling all addons on ${displayName}` });
                          const { useAddonStore } = await import('@/store/addonStore');
                          await useAddonStore.getState().bulkReinstallAllOnAccount(account.id, getStremioAuthKey(account));
                          toast({ title: 'Reinstall Complete', description: `All addons on ${displayName} have been reinstalled` });
                        } catch (err) {
                          toast({ variant: 'destructive', title: 'Reinstall Failed', description: `Could not reinstall addons on ${displayName}` });
                        }
                      }}
                      disabled={loading}
                      className="gap-2 cursor-pointer"
                    >
                      <RotateCw className={`h-4 w-4 shrink-0 text-primary ${loading ? 'animate-spin' : ''}`} />
                      Reinstall All
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => { e.stopPropagation(); onDelete?.(account.id); }}
                      className="gap-2 text-destructive focus:text-destructive"
                    >
                      <Trash className="h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="min-w-0 flex-grow px-5 pb-10 pt-2 md:px-6">
          <div className="space-y-3.5">
            {!account.hideAddonPreview && enabledAddons.length > 0 && (
              <div className="flex min-h-6 flex-wrap items-center gap-1.5">
                {previewAddons.map((addon, i) => (
                  <HideableImage
                    key={`${addon.transportUrl}-${i}`}
                    src={addon.manifest.logo}
                    alt={addon.manifest.name}
                    fallback={addon.manifest.name?.[0]?.toUpperCase()}
                    dataThemePart="image-tile"
                    className="h-[22px] w-[22px] shrink-0 rounded-md bg-muted/30 object-contain p-0.5 ring-1 ring-border/20 md:h-6 md:w-6"
                  />
                ))}
                {remainingCount > 0 && (
                  <span className="ml-0.5 text-[11px] text-muted-foreground">+{remainingCount}</span>
                )}
              </div>
            )}


            {account.addons.length === 0 && (
              <p className="py-1 text-xs text-muted-foreground">No addons yet</p>
            )}
            {account.status === 'error' && isStabilized && (
              <div data-theme-tone="status" data-theme-part="panel" className="bg-destructive/10 border border-destructive/50 rounded-md p-3 mt-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-destructive">Sync Failed</p>
                    <p className="text-xs text-destructive/80 mt-0.5">
                      {account.lastError || 'Could not reach the server. Try a re-sync; if it keeps failing, update the account credentials.'}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async (e) => {
                      e.stopPropagation()
                      try {
                          await syncAccount(account.id, true)
                      } catch {
                          handleEdit()
                      }
                  }}
                  className="w-full mt-2 border-destructive/30 text-destructive hover:bg-destructive/20 gap-2"
                >
                  <Pencil className="h-3 w-3" />
                  Try Sync / Update
                </Button>
              </div>
            )}
            {account.status === 'expired' && isStabilized && (
              <div data-theme-tone="status" data-theme-part="panel" className="flex items-center gap-2 rounded-lg border border-warning/25 bg-warning/10 px-2 py-1.5 text-warning">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <p className="min-w-0 flex-1 text-[11px]">
                  {expiredConnection ? `${platformName(expiredConnection.platform)} session expired` : 'Session expired'}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleEdit()
                  }}
                  aria-label="Fix session"
                  className="h-6 shrink-0 gap-1 px-1 text-[10px] text-warning hover:bg-warning/10 hover:text-warning"
                >
                  Fix <ArrowUpRight className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        </CardContent>


        <CardFooter className="mt-auto flex flex-wrap items-center gap-2 px-5 pb-5 pt-2 md:px-6 md:pb-6">
          {!account.hideLastWatched && (mediaPlayback || lastWatched) && (
            <div className="min-w-0 flex-[1_1_8.5rem]">
              {mediaPlayback ? <AccountMediaPlayback playback={mediaPlayback} /> : lastWatched && (
                <div className="flex min-h-5 min-w-0 items-center gap-1.5 text-xs">
                  <Play className="h-3.5 w-3.5 shrink-0 text-muted-foreground/65" aria-hidden="true" />
                  <Tooltip content={lastWatched.name} side="top">
                    <span className="truncate font-medium text-foreground/80">{lastWatched.name}</span>
                  </Tooltip>
                  <time className="ml-0.5 shrink-0 text-[11px] text-muted-foreground">{getTimeAgo(new Date(lastWatched.timestamp))}</time>
                </div>
              )}
            </div>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <AccountSyncIndicator
              loading={loading}
              lastSync={account.lastSync}
              error={account.status === 'error' ? account.lastError || 'Last sync attempt failed' : null}
            />
            <Tooltip content={account.note ? `Note: ${account.note.slice(0, 60)}${account.note.length > 60 ? '…' : ''}` : 'Add note'} side="top">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleNoteOpen}
                className={`h-6 w-6 flex items-center justify-center rounded-md p-0.5 ring-1 ring-border/20 transition-colors ${account.note ? 'text-primary bg-primary/10' : 'text-muted-foreground/60 bg-muted/30 hover:text-muted-foreground hover:bg-muted/50'}`}
                aria-label="Toggle note"
              >
                <StickyNote className="h-3 w-3" />
              </Button>
            </Tooltip>
          </div>
        </CardFooter>
      </div>

      <Dialog open={noteOpen} onOpenChange={handleNoteClose}>
        <DialogContent
          className="flex max-h-[85vh] flex-col gap-0 overflow-hidden rounded-[1.75rem] border-border/45 bg-card p-0 shadow-[0_24px_80px_hsl(0_0%_0%/0.32)] sm:max-w-xl"
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
        >
          <DialogHeader className="border-b border-border/25 px-5 py-4 pr-16">
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                <AccountAvatar account={account} size="md" showStatus={false} />
                {accentColor && (
                  <span
                    data-theme-part="account-accent"
                    className="pointer-events-none absolute inset-0 rounded-xl"
                    style={{ boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accentColor} 65%, transparent)` }}
                    aria-hidden="true"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-base min-w-0">{displayName}</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {noteValue.trim() ? 'Quick sticky note' : 'Write a quick sticky note'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {noteIsEditing ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
              <div data-theme-part="toolbar" className="flex items-center gap-1 rounded-2xl border border-border/35 bg-muted/50 p-1">
                <Tooltip content="Undo" side="top"><Button variant="ghost" size="icon" className={noteToolbarButtonClass} onClick={noteUndo} disabled={noteHistoryIdx === 0} aria-label="Undo"><Undo2 className="h-3.5 w-3.5" /></Button></Tooltip>
                <Tooltip content="Redo" side="top"><Button variant="ghost" size="icon" className={noteToolbarButtonClass} onClick={noteRedo} disabled={noteHistoryIdx >= noteHistory.length - 1} aria-label="Redo"><Redo2 className="h-3.5 w-3.5" /></Button></Tooltip>
                <div className="mx-1 h-5 w-px bg-border/60" />
                <Tooltip content="Bold" side="top"><Button variant="ghost" size="icon" className={noteToolbarButtonClass} onClick={() => noteWrapSel('**', '**')} aria-label="Bold"><Bold className="h-3.5 w-3.5" /></Button></Tooltip>
                <Tooltip content="Italic" side="top"><Button variant="ghost" size="icon" className={noteToolbarButtonClass} onClick={() => noteWrapSel('*', '*')} aria-label="Italic"><Italic className="h-3.5 w-3.5" /></Button></Tooltip>
                <Tooltip content="Bullet list" side="top"><Button variant="ghost" size="icon" className={noteToolbarButtonClass} onClick={() => noteInsertPrefix('- ')} aria-label="Bullet list"><List className="h-3.5 w-3.5" /></Button></Tooltip>
                <Tooltip content="Numbered list" side="top"><Button variant="ghost" size="icon" className={noteToolbarButtonClass} onClick={() => noteInsertPrefix('1. ')} aria-label="Numbered list"><ListOrdered className="h-3.5 w-3.5" /></Button></Tooltip>
                <Tooltip content="Link" side="top"><Button variant="ghost" size="icon" className={noteToolbarButtonClass} onClick={() => noteWrapSel('[', '](url)')} aria-label="Insert link"><Link2 className="h-3.5 w-3.5" /></Button></Tooltip>
                <div className="flex-1" />
                <CopyButton value={noteValue} className={noteToolbarButtonClass} iconSize={14} />
                {noteValue && (
                  <Tooltip content="Clear note" side="top">
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={handleNoteClear} aria-label="Delete note">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </Tooltip>
                )}
              </div>

              <div data-theme-part="panel" className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/35 bg-background">
                <Textarea
                  ref={noteTextareaRef}
                  data-autofocus="true"
                  value={noteValue}
                  onChange={e => handleNoteChange(e.target.value)}
                  maxLength={STICKY_NOTE_MAX_LENGTH}
                  placeholder={"Write anything...\n\n- Use bullet lists\n1. Or numbered lists\n**bold** and *italic*"}
                  className="h-full min-h-[220px] resize-none whitespace-pre-wrap break-words border-0 bg-transparent p-4 text-sm leading-relaxed focus-visible:ring-0"
                  autoFocus
                  onKeyDown={e => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); noteUndo() }
                    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); noteRedo() }
                    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); noteWrapSel('**', '**') }
                    if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); noteWrapSel('*', '*') }
                    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleNoteSave() }
                    if (e.key === 'Escape') { handleNoteSave() }
                    if (e.key === 'Enter') {
                      const textarea = e.currentTarget
                      const pos = textarea.selectionStart
                      const lineStart = noteValue.lastIndexOf('\n', pos - 1) + 1
                      const currentLine = noteValue.slice(lineStart, pos)
                      const ulMatch = currentLine.match(/^(\s*)([-*])\s/)
                      const olMatch = currentLine.match(/^(\s*)(\d+)\.\s/)
                      if (ulMatch) {
                        e.preventDefault()
                        if (currentLine.trim() === '- ' || currentLine.trim() === '* ') {
                          const newVal = noteValue.slice(0, lineStart) + noteValue.slice(pos)
                          setNoteValue(newVal); pushNoteHistory(newVal)
                          setTimeout(() => { textarea.selectionStart = textarea.selectionEnd = lineStart }, 0)
                        } else {
                          const { 1: indent, 2: bullet } = ulMatch
                          const newVal = noteValue.slice(0, pos) + '\n' + indent + bullet + ' ' + noteValue.slice(pos)
                          if (newVal.length > STICKY_NOTE_MAX_LENGTH && newVal.length > noteValue.length) return
                          setNoteValue(newVal); pushNoteHistory(newVal)
                          setTimeout(() => { textarea.selectionStart = textarea.selectionEnd = pos + 1 + indent.length + 2 }, 0)
                        }
                      } else if (olMatch) {
                        e.preventDefault()
                        const { 1: indent, 2: numStr } = olMatch
                        if (currentLine.trim() === numStr + '. ') {
                          const newVal = noteValue.slice(0, lineStart) + noteValue.slice(pos)
                          setNoteValue(newVal); pushNoteHistory(newVal)
                          setTimeout(() => { textarea.selectionStart = textarea.selectionEnd = lineStart }, 0)
                        } else {
                          const num = parseInt(numStr) + 1
                          const newVal = noteValue.slice(0, pos) + '\n' + indent + num + '. ' + noteValue.slice(pos)
                          if (newVal.length > STICKY_NOTE_MAX_LENGTH && newVal.length > noteValue.length) return
                          setNoteValue(newVal); pushNoteHistory(newVal)
                          setTimeout(() => { textarea.selectionStart = textarea.selectionEnd = pos + 1 + indent.length + num.toString().length + 2 }, 0)
                        }
                      }
                    }
                  }}
                />
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span className={cn(
                  'text-xs text-muted-foreground',
                  noteLimitExceeded ? 'text-destructive' : noteNearLimit && 'text-warning'
                )}>
                  {noteLength > 0 ? `${noteCountLabel} chars` : `${noteCountLabel} · Auto-saves when closed`}
                </span>
                <div className="flex items-center justify-end gap-2">
                  <Button size="sm" onClick={() => { handleNoteSave(); handleNoteClose(false) }} className="h-9 rounded-full px-4 text-xs font-semibold gap-1.5">
                    <Check className="h-3 w-3" /> Save & Close
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
              <div data-theme-part="panel" className="min-h-[160px] overflow-auto rounded-2xl border border-border/35 bg-background p-4 text-sm leading-relaxed whitespace-pre-wrap break-words">
                {noteValue || <span className="text-muted-foreground/60 italic">No note yet.</span>}
              </div>
              <div className="flex items-center justify-between">
                {account.note ? (
                  <Button onClick={handleNoteClear} variant="ghost" size="sm" className="text-xs text-muted-foreground/70 hover:text-destructive">Clear</Button>
                ) : <span />}
                <Button variant="subtle" size="sm" onClick={() => { setNoteIsEditing(true); setTimeout(() => noteTextareaRef.current?.focus(), 50) }} className="h-9 rounded-full gap-1.5 px-4">
                  <Pencil className="h-3 w-3" /> Edit
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </Card>
  )
})
