import { useEffect, useRef, useState } from 'react'
import { Tooltip } from '@/components/ui/tooltip'
import { cn, getTimeAgo } from '@/lib/utils'
import { AlertCircle, AlertTriangle, Check, CircleDashed, RefreshCw } from 'lucide-react'

const STALE_AFTER_MS = 24 * 60 * 60 * 1000
const SUCCESS_FLASH_MS = 1800

export interface AccountSyncIndicatorProps {
  /** True while a sync is in flight for this account (existing loadingAccounts selector). */
  loading: boolean
  /** Last successful sync timestamp. Invalid or missing values never render a success state. */
  lastSync: Date | string | number | null | undefined
  /** Honest failure label, e.g. account.lastError when account.status === 'error'. */
  error?: string | null
  className?: string
}

function toValidMs(value: Date | string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

function formatAbsolute(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * Quiet icon-only sync status for account cards.
 *
 * - Rotates while a sync is in flight; all animation stops under
 *   prefers-reduced-motion.
 * - Flashes a brief check only for a success it actually witnessed while
 *   mounted: a loading cycle that settled with a newer valid lastSync and no
 *   error. A recent timestamp on first render, hydration/cloud pushes (the
 *   deferred canonical fold writes lastSync with no loading cycle),
 *   regressing timestamps, invalid values, and failed cycles never flash —
 *   including after an error clears later.
 * - Missing or invalid lastSync shows "Never synced"; failures keep the
 *   honest error icon; stamps over 24h old keep the stale warning.
 * - Elapsed and absolute time live in the tooltip (hover, keyboard focus,
 *   and non-mouse taps, which re-focus the trigger because touch browsers do
 *   not reliably focus buttons on tap) and in the trigger's aria-label for
 *   screen readers. No per-second timers: elapsed text refreshes with the
 *   parent's shared 60s relative-time tick.
 * - Deliberately not memoized: the >24h stale flip relies on the parent's
 *   ticker re-render; the render itself is just a button and an icon, so a
 *   few hundred cards stay cheap.
 */
export function AccountSyncIndicator({ loading, lastSync, error = null, className }: AccountSyncIndicatorProps) {
  const lastSyncMs = toValidMs(lastSync)
  const hasError = error != null && error !== ''
  const [flashSuccess, setFlashSuccess] = useState(false)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPointerTypeRef = useRef('')
  const cycleRef = useRef({
    initialized: false,
    prevLoading: false,
    /** Last adopted timestamp; increases over this are success candidates. */
    baselineMs: null as number | null,
    /** True once a loading cycle was witnessed and not yet resolved. */
    armed: false,
  })

  useEffect(() => {
    const cycle = cycleRef.current
    if (!cycle.initialized) {
      // First render adopts the current state silently, no matter how recent,
      // so reloads and hydrations never fake a success flash. Mounting while
      // a sync is already in flight still witnesses that cycle: a completion
      // stamp at settle is a real observed success.
      cycle.initialized = true
      cycle.prevLoading = loading
      cycle.baselineMs = lastSyncMs
      cycle.armed = loading
      return
    }

    const wasLoading = cycle.prevLoading
    cycle.prevLoading = loading

    if (loading || hasError || lastSyncMs === null || (cycle.baselineMs !== null && lastSyncMs < cycle.baselineMs)) {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
      flashTimerRef.current = null
      setFlashSuccess(false)
    }

    if (loading) {
      // A cycle is in flight. Timestamps that land now are decided once, at
      // the render where loading settles.
      cycle.armed = true
      return
    }

    if (lastSyncMs === cycle.baselineMs) {
      // Loading settled (or nothing is in flight) and nothing changed:
      // resolve a witnessed cycle without a success. A timestamp that only
      // arrives after the settle is indistinguishable from hydration/cloud
      // data (the deferred canonical fold writes lastSync exactly that way),
      // so it never earns a flash.
      if (wasLoading) cycle.armed = false
      return
    }

    // A timestamp change observed while idle — after a cycle already resolved
    // — is hydration or cloud data and never flashes. A success needs the
    // change to be observed by this render of the cycle it settles.
    const increased = lastSyncMs !== null && (cycle.baselineMs === null || lastSyncMs > cycle.baselineMs)
    const witnessed = cycle.armed && wasLoading && !hasError
    if (wasLoading) cycle.armed = false
    if (witnessed && increased) {
      // A loading cycle witnessed while mounted ended with a newer valid
      // timestamp and no error = a real observed success.
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
      setFlashSuccess(true)
      flashTimerRef.current = setTimeout(() => setFlashSuccess(false), SUCCESS_FLASH_MS)
    } else {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
      flashTimerRef.current = null
      setFlashSuccess(false)
    }
    // Otherwise: hydration/cloud data, a regression, an invalid value, or a
    // failure-cycle timestamp — adopt quietly, no flash.
    cycle.baselineMs = lastSyncMs
  }, [lastSyncMs, loading, hasError])

  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
  }, [])

  const stale = lastSyncMs !== null && Date.now() - lastSyncMs > STALE_AFTER_MS
  const ago = lastSyncMs !== null ? getTimeAgo(new Date(lastSyncMs)) : null
  const lastSuccessDetail = lastSyncMs !== null
    ? `Last success ${ago} · ${formatAbsolute(lastSyncMs)}`
    : 'No successful sync yet'

  // Display priority: sync in flight > honest failure > missing timestamp > stale > success flash > quiet.
  type VisualState = 'loading' | 'error' | 'never' | 'stale' | 'success' | 'quiet'
  let stateKey: VisualState = 'quiet'
  let Icon: typeof Check = Check
  let iconClass = 'text-muted-foreground/65'
  let mainLabel = 'Sync status'
  let detailLabel: string | null = null

  if (loading) {
    stateKey = 'loading'
    Icon = RefreshCw
    iconClass = 'text-muted-foreground'
    mainLabel = 'Syncing now'
    detailLabel = lastSuccessDetail
  } else if (hasError) {
    stateKey = 'error'
    Icon = AlertCircle
    iconClass = 'text-destructive'
    mainLabel = 'Sync failed'
    const reason = error.length > 60 ? `${error.slice(0, 60)}…` : error
    detailLabel = `${reason} · ${lastSuccessDetail}`
  } else if (lastSyncMs === null) {
    stateKey = 'never'
    Icon = CircleDashed
    mainLabel = 'Never synced'
    detailLabel = 'No successful sync recorded yet'
  } else if (stale) {
    stateKey = 'stale'
    Icon = AlertTriangle
    iconClass = 'text-warning'
    mainLabel = `Synced ${ago}`
    detailLabel = `Over 24h ago · ${formatAbsolute(lastSyncMs)} · Sync recommended`
  } else if (flashSuccess) {
    stateKey = 'success'
    Icon = Check
    iconClass = 'text-success'
    mainLabel = `Synced ${ago}`
    detailLabel = formatAbsolute(lastSyncMs)
  } else {
    mainLabel = `Synced ${ago}`
    detailLabel = formatAbsolute(lastSyncMs)
  }

  const ariaLabel = detailLabel ? `${mainLabel} · ${detailLabel}` : mainLabel

  return (
    <Tooltip
      content={
        <>
          <span className="block">{mainLabel}</span>
          {detailLabel && <span className="mt-0.5 block font-normal text-muted-foreground">{detailLabel}</span>}
        </>
      }
      side="top"
    >
      {/* Raw DOM button on purpose: the Tooltip trigger merges its ref through
          Radix Slot, which is only guaranteed for real DOM elements here. The
          stopPropagation handlers keep taps, clicks and Enter/Space from
          activating the surrounding clickable card (navigation, selection,
          long-press). */}
      <button
        type="button"
        aria-label={ariaLabel}
        onPointerDown={(e) => { lastPointerTypeRef.current = e.pointerType }}
        onClick={(e) => {
          e.stopPropagation()
          // Touch browsers do not reliably focus buttons on tap — and the
          // focus that does fire arrives while a pointer is down, which Radix
          // deliberately ignores — so tap alone would never open the tooltip.
          // Re-focusing after a non-mouse tap lets Radix's own focus path
          // open it. Keyboard activation (detail 0) already has focus, and
          // mouse keeps click-as-dismiss.
          if (e.detail > 0 && lastPointerTypeRef.current !== 'mouse') {
            const btn = e.currentTarget
            setTimeout(() => btn.focus(), 0)
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}
        className={cn(
          'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          className
        )}
      >
        <Icon
          key={stateKey}
          aria-hidden="true"
          className={cn(
            'h-3 w-3',
            iconClass,
            stateKey === 'loading' && 'animate-spin motion-reduce:animate-none',
            stateKey === 'success' && 'animate-in zoom-in-50 duration-200 motion-reduce:animate-none'
          )}
        />
      </button>
    </Tooltip>
  )
}
