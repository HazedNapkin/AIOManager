import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { mapConcurrent } from '@/lib/concurrency'
import { cn, getAddonGroupKey, getCanonicalAddonUrl, normalizeAddonUrl } from '@/lib/utils'
import { useAddonStore } from '@/store/addonStore'
import { useAccountStore } from '@/store/accountStore'
import { AddonIcon } from '@/components/ui/addon-icon'
import { useProfileStore } from '@/store/profileStore'
import { StremioAccount } from '@/types/account'
import type { AddonDescriptor } from '@/types/addon'
import type { BulkResult, MergeResult, SavedAddon } from '@/types/saved-addon'
import { AccountAvatar } from './AccountAvatar'
import { AlertTriangle, CheckCircle2, ChevronDown, Copy, Globe, GripVertical, Info, LayoutGrid, Library, Loader2, PlusCircle, ShieldAlert, ShieldCheck, Trash2, Zap, UserMinus, FileDown, Search, Tags, X } from 'lucide-react'
import { useState, useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'


interface BatchOperationsDialogProps {
  selectedAccounts: StremioAccount[]
  allAccounts?: StremioAccount[]
  onClose: () => void
}
type BulkAction =
  | 'install-from-library'
  | 'add-saved-addons'
  | 'install-from-url'
  | 'clone-account'
  | 'update-addons'
  | 'reinstall-all'
  | 'protect-all'
  | 'unprotect-all'
  | 'remove-addons'
  | 'remove-by-tag'
  | 'sync-order'

type BulkAccountTarget = {
  id: string
  authKey: string
}

type BulkProgress = {
  status: 'running' | 'cancelling' | 'cancelled' | 'complete'
  current: number
  total: number
  accountName?: string
}

const ACTION_TITLES: Record<BulkAction, string> = {
  'install-from-library': 'Install from Library',
  'add-saved-addons': 'Install Saved Add-ons',
  'install-from-url': 'Install from URLs',
  'clone-account': 'Mirror from Account',
  'sync-order': 'Sync Addon Order',
  'update-addons': 'Update Add-ons',
  'remove-by-tag': 'Remove by Tags',
  'reinstall-all': 'Update All',
  'remove-addons': 'Remove Add-ons',
  'protect-all': 'Protect All',
  'unprotect-all': 'Unprotect All'
}

const ACTION_DESCRIPTIONS: Record<BulkAction, string> = {
  'install-from-library': 'Add saved add-ons from a profile or tag.',
  'add-saved-addons': 'Choose saved add-ons and add them to the selected accounts.',
  'install-from-url': 'Paste add-on links and add them to the selected accounts.',
  'clone-account': 'Copy add-ons from one account to the selected accounts.',
  'sync-order': 'Make selected accounts use the same add-on order.',
  'update-addons': 'Check selected add-ons and use the newest copy available.',
  'remove-by-tag': 'Remove add-ons that use a saved-library tag.',
  'reinstall-all': 'Check every add-on and use the newest copy available.',
  'remove-addons': 'Choose installed add-ons to remove from selected accounts.',
  'protect-all': 'Lock every add-on so tag cleanup leaves them alone.',
  'unprotect-all': 'Unlock every add-on so tag cleanup can remove them again.'
}

const ACTION_GROUPS: Array<{ label: string; actions: BulkAction[] }> = [
  { label: 'Install', actions: ['install-from-library', 'add-saved-addons', 'install-from-url'] },
  { label: 'Sync', actions: ['clone-account', 'sync-order'] },
  { label: 'Manage', actions: ['update-addons', 'remove-by-tag', 'reinstall-all', 'remove-addons'] },
  { label: 'Protection', actions: ['protect-all', 'unprotect-all'] }
]
const ACTION_OPTIONS = ACTION_GROUPS.flatMap(group => group.actions)

const DANGER_ACTIONS = new Set<BulkAction>(['remove-addons', 'remove-by-tag'])
const WARNING_ACTIONS = new Set<BulkAction>(['clone-account', 'reinstall-all', 'unprotect-all'])

type PreviewTone = 'muted' | 'success' | 'warning' | 'destructive'

type PreviewStat = {
  label: string
  value: string | number
  detail?: string
  tone?: PreviewTone
}

type PreviewAccountRow = {
  id: string
  name: string
  detail: string
  tone?: PreviewTone
}

type PreviewAddon = {
  id: string
  name: string
  logo?: string
  detail: string
  tone?: PreviewTone
}

type BatchPreview = {
  title: string
  description: string
  targetCount: number
  stats: PreviewStat[]
  addons: PreviewAddon[]
  rows: PreviewAccountRow[]
  notes: string[]
  tone: PreviewTone
}

type ResultSummary = {
  added: number
  updated: number
  removed: number
  skipped: number
  protected: number
  rows: PreviewAccountRow[]
}

function getReceiptLabels(action?: BulkAction) {
  if (action === 'protect-all') {
    return {
      added: 'added',
      updated: 'locked',
      removed: 'removed',
      skipped: 'skipped',
      protected: 'already locked',
      protectedIsWarning: false,
    }
  }

  if (action === 'unprotect-all') {
    return {
      added: 'added',
      updated: 'unlocked',
      removed: 'removed',
      skipped: 'skipped',
      protected: 'already unlocked',
      protectedIsWarning: false,
    }
  }

  if (action === 'clone-account') {
    return {
      added: 'copied',
      updated: 'matched',
      removed: 'removed',
      skipped: 'skipped',
      protected: 'left alone',
      protectedIsWarning: true,
    }
  }

  if (action === 'sync-order') {
    return {
      added: 'added',
      updated: 'moved',
      removed: 'removed',
      skipped: 'skipped',
      protected: 'already in place',
      protectedIsWarning: false,
    }
  }

  return {
    added: 'added',
    updated: 'updated',
    removed: 'removed',
    skipped: 'skipped',
    protected: 'left alone',
    protectedIsWarning: true,
  }
}

function getAccountName(account?: StremioAccount) {
  return account?.name || account?.email || (account?.id ? `${account.id.substring(0, 8)}...` : 'Unknown account')
}

function getAddonDisplayName(addon: AddonDescriptor) {
  return addon.metadata?.customName || addon.manifest?.name || 'Add-on'
}

function savedAddonToPreview(addon: SavedAddon, detail: string, tone: PreviewTone = 'success'): PreviewAddon {
  return {
    id: addon.id,
    name: addon.name || addon.manifest.name || 'Saved add-on',
    logo: addon.metadata?.customLogo || addon.manifest.logo,
    detail,
    tone,
  }
}

function descriptorToPreview(addon: AddonDescriptor, detail: string, tone: PreviewTone = 'success'): PreviewAddon {
  return {
    id: normalizeAddonUrl(addon.transportUrl) || addon.manifest?.id || getAddonDisplayName(addon),
    name: getAddonDisplayName(addon),
    logo: addon.metadata?.customLogo || addon.manifest?.logo,
    detail,
    tone,
  }
}

function linkToPreview(url: string): PreviewAddon {
  let name = 'Pasted link'
  try {
    const normalized = normalizeAddonUrl(url)
    const parsed = new URL(normalized.startsWith('http') ? normalized : `https://${normalized}`)
    name = parsed.hostname.replace(/^www\./, '')
  } catch {
    name = url.replace(/^https?:\/\//, '').slice(0, 32) || 'Pasted link'
  }

  return {
    id: url,
    name,
    detail: 'Will check',
    tone: 'success',
  }
}

function uniquePreviewAddons(addons: PreviewAddon[]) {
  const seen = new Set<string>()
  const unique: PreviewAddon[] = []

  for (const addon of addons) {
    const key = addon.id || addon.name
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(addon)
  }

  return unique
}

function countByUrl(account: StremioAccount, urls: string[]) {
  if (urls.length === 0) return 0
  const targetUrls = new Set(urls.map(url => normalizeAddonUrl(url)).filter(Boolean))
  return account.addons.reduce((count, addon) => (
    targetUrls.has(normalizeAddonUrl(addon.transportUrl)) ? count + 1 : count
  ), 0)
}

function countByCanonicalUrl(account: StremioAccount, urls: string[]) {
  if (urls.length === 0) return 0
  const targetUrls = new Set(urls.map(url => getCanonicalAddonUrl(url)).filter(Boolean))
  return account.addons.reduce((count, addon) => (
    targetUrls.has(getCanonicalAddonUrl(addon.transportUrl)) ? count + 1 : count
  ), 0)
}

function countProtectedMatches(account: StremioAccount, urls: string[]) {
  if (urls.length === 0) return 0
  const targetUrls = new Set(urls.map(url => normalizeAddonUrl(url)).filter(Boolean))
  return account.addons.reduce((count, addon) => {
    const matches = targetUrls.has(normalizeAddonUrl(addon.transportUrl))
    return matches && addon.flags?.protected ? count + 1 : count
  }, 0)
}

function countProtectedCanonicalMatches(account: StremioAccount, urls: string[]) {
  if (urls.length === 0) return 0
  const targetUrls = new Set(urls.map(url => getCanonicalAddonUrl(url)).filter(Boolean))
  return account.addons.reduce((count, addon) => {
    const matches = targetUrls.has(getCanonicalAddonUrl(addon.transportUrl))
    return matches && addon.flags?.protected ? count + 1 : count
  }, 0)
}

function createPickFirstPreview(title: string, description: string, targetCount: number, tone: PreviewTone = 'muted'): BatchPreview {
  return {
    title,
    description,
    targetCount,
    tone,
    stats: [],
    addons: [],
    rows: [],
    notes: [],
  }
}

function createProtectionMergeResult(account: StremioAccount | undefined, isProtected: boolean): MergeResult {
  const addons = account?.addons ?? []
  const changed = addons.filter(addon => Boolean(addon.flags?.protected) !== isProtected)
  const unchanged = addons.filter(addon => Boolean(addon.flags?.protected) === isProtected)

  return {
    added: [],
    updated: changed.map((addon) => ({
      addonId: addon.manifest.id,
      oldUrl: '',
      newUrl: addon.transportUrl,
    })),
    removed: [],
    skipped: [],
    protected: unchanged.map((addon) => ({
      addonId: addon.manifest.id,
      name: getAddonDisplayName(addon),
    })),
  }
}

function summarizeResult(result: BulkResult, accounts: StremioAccount[], action?: BulkAction): ResultSummary {
  const accountsById = new Map(accounts.map(account => [account.id, account]))
  const labels = getReceiptLabels(action)

  return result.details.reduce<ResultSummary>((summary, detail) => {
    const added = detail.result.added.length
    const updated = detail.result.updated.length
    const removed = detail.result.removed?.length ?? 0
    const skipped = detail.result.skipped.length
    const protectedCount = detail.result.protected.length

    summary.added += added
    summary.updated += updated
    summary.removed += removed
    summary.skipped += skipped
    summary.protected += protectedCount

    const parts = [
      added > 0 ? `${added} ${labels.added}` : '',
      updated > 0 ? `${updated} ${labels.updated}` : '',
      removed > 0 ? `${removed} ${labels.removed}` : '',
      skipped > 0 ? `${skipped} ${labels.skipped}` : '',
      protectedCount > 0 ? `${protectedCount} ${labels.protected}` : '',
    ].filter(Boolean)
    const protectedWarning = labels.protectedIsWarning && protectedCount > 0

    summary.rows.push({
      id: detail.accountId,
      name: getAccountName(accountsById.get(detail.accountId)),
      detail: parts.length > 0 ? parts.join(', ') : 'Completed',
      tone: skipped > 0 || protectedWarning ? 'warning' : 'success',
    })

    return summary
  }, { added: 0, updated: 0, removed: 0, skipped: 0, protected: 0, rows: [] })
}

function PreviewStatCard({ stat }: { stat: PreviewStat }) {
  return (
    <div className={cn(
      "min-w-0 rounded-xl border bg-background/45 p-2.5",
      stat.tone === 'success' && "border-success/25 bg-success/5",
      stat.tone === 'warning' && "border-warning/25 bg-warning/5",
      stat.tone === 'destructive' && "border-destructive/25 bg-destructive/5",
      (!stat.tone || stat.tone === 'muted') && "border-border/35"
    )}>
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{stat.label}</div>
      <div className="mt-1 truncate text-base font-bold tabular-nums">{stat.value}</div>
      {stat.detail && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{stat.detail}</div>}
    </div>
  )
}

function BatchImpactPreview({ preview, accounts }: { preview: BatchPreview; accounts: StremioAccount[] }) {
  const accountsById = new Map(accounts.map(account => [account.id, account]))

  return (
    <div className={cn(
      "space-y-3 rounded-2xl border border-dashed bg-muted/20 p-3",
      preview.tone === 'warning' && "border-warning/35 bg-warning/5",
      preview.tone === 'destructive' && "border-destructive/35 bg-destructive/5",
      preview.tone === 'success' && "border-success/30 bg-success/5",
      preview.tone === 'muted' && "border-border/45"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Info className="h-3 w-3" />
            Before You Run This
          </h4>
          <p className="mt-1 text-sm font-medium">{preview.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{preview.description}</p>
        </div>
        <div className="shrink-0 rounded-full border border-border/35 bg-background/60 px-2.5 py-1 text-xs font-semibold tabular-nums">
          {preview.targetCount} account{preview.targetCount !== 1 ? 's' : ''}
        </div>
      </div>

      {preview.stats.length > 0 && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {preview.stats.map((stat) => (
            <PreviewStatCard key={stat.label} stat={stat} />
          ))}
        </div>
      )}

      {preview.addons.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase text-muted-foreground">Add-ons this touches</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {preview.addons.slice(0, 8).map((addon) => (
              <div
                key={addon.id}
                className={cn(
                  "flex min-w-[150px] max-w-[190px] items-center gap-2 rounded-xl border border-border/25 bg-background/40 px-2.5 py-2",
                  addon.tone === 'destructive' && "border-destructive/25 bg-destructive/5",
                  addon.tone === 'warning' && "border-warning/25 bg-warning/5",
                  addon.tone === 'success' && "border-success/20 bg-success/5"
                )}
              >
                <AddonIcon
                  name={addon.name}
                  logo={addon.logo}
                  className="h-7 w-7"
                  textClassName="text-[10px]"
                  imageClassName="p-0.5"
                />
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{addon.name}</div>
                  <div className={cn(
                    "truncate text-[11px] text-muted-foreground",
                    addon.tone === 'destructive' && "text-destructive",
                    addon.tone === 'warning' && "text-warning",
                    addon.tone === 'success' && "text-success"
                  )}>
                    {addon.detail}
                  </div>
                </div>
              </div>
            ))}
            {preview.addons.length > 8 && (
              <div className="flex min-w-20 items-center justify-center rounded-xl border border-border/25 bg-background/35 px-3 text-xs font-semibold text-muted-foreground">
                +{preview.addons.length - 8} more
              </div>
            )}
          </div>
        </div>
      )}

      {preview.rows.length > 0 && (
        <div className="space-y-1.5">
          {preview.rows.slice(0, 4).map((row) => {
            const account = accountsById.get(row.id)
            return (
              <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/25 bg-background/35 px-2.5 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  {account && <AccountAvatar account={account} size="xs" showStatus={false} />}
                  <span className="min-w-0 truncate text-xs font-medium">{row.name}</span>
                </span>
                <span className={cn(
                  "max-w-[58%] shrink-0 truncate text-right text-xs text-muted-foreground",
                  row.tone === 'warning' && "text-warning",
                  row.tone === 'destructive' && "text-destructive",
                  row.tone === 'success' && "text-success"
                )}>
                  {row.detail}
                </span>
              </div>
            )
          })}
          {preview.rows.length > 4 && (
            <div className="px-2 text-[11px] text-muted-foreground">+{preview.rows.length - 4} more account{preview.rows.length - 4 !== 1 ? 's' : ''}</div>
          )}
        </div>
      )}

      {preview.notes.length > 0 && (
        <div className="space-y-1 border-t border-border/25 pt-2">
          {preview.notes.map((note) => (
            <p key={note} className="text-[11px] leading-relaxed text-muted-foreground">{note}</p>
          ))}
        </div>
      )}
    </div>
  )
}

function ResultReceipt({ result, accounts, action }: { result: BulkResult; accounts: StremioAccount[]; action: BulkAction }) {
  const summary = summarizeResult(result, accounts, action)
  const accountsById = new Map(accounts.map(account => [account.id, account]))
  const labels = getReceiptLabels(action)
  const hasWarnings = result.failed > 0 || summary.skipped > 0 || (labels.protectedIsWarning && summary.protected > 0)

  return (
    <div className={cn(
      "space-y-3 rounded-2xl border p-3 animate-in fade-in slide-in-from-top-2",
      hasWarnings ? "border-warning/25 bg-warning/10" : "border-success/20 bg-success/10"
    )}>
      <div className="flex items-start gap-2">
        <CheckCircle2 className={cn("mt-0.5 h-4 w-4", hasWarnings ? "text-warning" : "text-success")} />
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-medium", hasWarnings ? "text-warning" : "text-success")}>
            Done: {result.success} account{result.success !== 1 ? 's' : ''} processed, {result.failed} failed
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {summary.added} {labels.added}, {summary.updated} {labels.updated}, {summary.removed} {labels.removed}, {summary.skipped} {labels.skipped}, {summary.protected} {labels.protected}.
          </p>
        </div>
      </div>

      {summary.rows.length > 0 && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {summary.rows.slice(0, 6).map((row) => {
            const account = accountsById.get(row.id)
            return (
              <div key={row.id} className="flex items-center gap-2 rounded-xl border border-border/25 bg-background/35 px-2.5 py-2">
                {account && <AccountAvatar account={account} size="xs" showStatus={false} />}
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{row.name}</div>
                  <div className={cn(
                    "mt-0.5 truncate text-[11px] text-muted-foreground",
                    row.tone === 'warning' && "text-warning",
                    row.tone === 'success' && "text-success"
                  )}>
                    {row.detail}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {result.errors.length > 0 && (
        <ul className="space-y-1 border-t border-border/25 pt-2 text-xs text-destructive">
          {result.errors.map((entry) => (
            <li key={`${entry.accountId}-${entry.error}`}>
              {getAccountName(accounts.find(account => account.id === entry.accountId))}: {entry.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function getActionIcon(action: BulkAction, className = 'h-4 w-4') {
  switch (action) {
    case 'install-from-library':
      return <Library className={className} />
    case 'add-saved-addons':
      return <PlusCircle className={className} />
    case 'install-from-url':
      return <Globe className={className} />
    case 'clone-account':
      return <Copy className={className} />
    case 'sync-order':
      return <GripVertical className={className} />
    case 'update-addons':
      return <FileDown className={className} />
    case 'remove-by-tag':
      return <UserMinus className={className} />
    case 'reinstall-all':
      return <Zap className={className} />
    case 'remove-addons':
      return <Trash2 className={className} />
    case 'protect-all':
      return <ShieldCheck className={className} />
    case 'unprotect-all':
      return <ShieldAlert className={className} />
    default:
      return <LayoutGrid className={className} />
  }
}

export function BatchOperationsDialog({
  selectedAccounts,
  allAccounts = [],
  onClose,
}: BatchOperationsDialogProps) {
  const library = useAddonStore(s => s.library)
  const getAllTags = useAddonStore(s => s.getAllTags)
  const bulkApplySavedAddons = useAddonStore(s => s.bulkApplySavedAddons)
  const bulkRemoveAddons = useAddonStore(s => s.bulkRemoveAddons)
  const bulkReinstallAddons = useAddonStore(s => s.bulkReinstallAddons)
  const bulkInstallFromUrls = useAddonStore(s => s.bulkInstallFromUrls)
  const bulkCloneAccount = useAddonStore(s => s.bulkCloneAccount)
  const bulkRemoveByTag = useAddonStore(s => s.bulkRemoveByTag)
  const bulkSyncOrder = useAddonStore(s => s.bulkSyncOrder)
  const loading = useAddonStore(s => s.loading)
  const bulkProtectAddons = useAccountStore(s => s.bulkProtectAddons)
  const profiles = useProfileStore(s => s.profiles)

  const [action, setAction] = useState<BulkAction>('install-from-library')
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [activeActionIndex, setActiveActionIndex] = useState(0)
  const actionTriggerRef = useRef<HTMLButtonElement>(null)
  const actionMenuRef = useRef<HTMLDivElement>(null)
  const [selectedSavedAddonIds, setSelectedSavedAddonIds] = useState<Set<string>>(new Set())
  const [selectedAddonIds, setSelectedAddonIds] = useState<Set<string>>(new Set())
  const [selectedUpdateAddonIds, setSelectedUpdateAddonIds] = useState<Set<string>>(new Set())
  const [selectedBulkTag, setSelectedBulkTag] = useState<string>('')

  const [filterQuery, setFilterQuery] = useState('')
  const [debouncedFilterQuery, setDebouncedFilterQuery] = useState('')
  const filterTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleFilterChange = (val: string) => {
    setFilterQuery(val)
    if (filterTimeoutRef.current) clearTimeout(filterTimeoutRef.current)
    filterTimeoutRef.current = setTimeout(() => {
      setDebouncedFilterQuery(val)
    }, 150)
  }
  const [urlList, setUrlList] = useState<string>('')
  const [sourceAccountId, setSourceAccountId] = useState<string>('')
  const [overwriteClone, setOverwriteClone] = useState(false)
  const [showProtected, setShowProtected] = useState(true)

  const [installMode, setInstallMode] = useState<'profile' | 'tag'>('profile')
  const [selectedInstallProfileId, setSelectedInstallProfileId] = useState<string>('')
  const [selectedInstallTagName, setSelectedInstallTagName] = useState<string>('')

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [result, setResult] = useState<BulkResult | null>(null)
  const [progress, setProgress] = useState<BulkProgress | null>(null)
  const cancelRequestedRef = useRef(false)
  const isExecuting = progress?.status === 'running' || progress?.status === 'cancelling'
  const selectedActionIndex = ACTION_OPTIONS.indexOf(action)
  const activeAction = ACTION_OPTIONS[activeActionIndex] ?? action
  const actionMenuId = 'batch-action-menu'
  const getActionOptionId = (item: BulkAction) => `batch-action-option-${item}`

  useEffect(() => {
    if (!actionMenuOpen) return

    setActiveActionIndex(selectedActionIndex >= 0 ? selectedActionIndex : 0)
    requestAnimationFrame(() => actionMenuRef.current?.focus())

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (actionMenuRef.current?.contains(target) || actionTriggerRef.current?.contains(target)) return
      setActionMenuOpen(false)
    }

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setActionMenuOpen(false)
      actionTriggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleDocumentKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleDocumentKeyDown, true)
    }
  }, [actionMenuOpen, selectedActionIndex])

  const selectAction = (item: BulkAction) => {
    setAction(item)
    setActionMenuOpen(false)
    requestAnimationFrame(() => actionTriggerRef.current?.focus())
  }

  const handleActionMenuKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const moveActive = (nextIndex: number) => {
      setActionMenuOpen(true)
      setActiveActionIndex((nextIndex + ACTION_OPTIONS.length) % ACTION_OPTIONS.length)
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        moveActive(actionMenuOpen ? activeActionIndex + 1 : Math.max(selectedActionIndex, 0))
        break
      case 'ArrowUp':
        e.preventDefault()
        moveActive(actionMenuOpen ? activeActionIndex - 1 : Math.max(selectedActionIndex, 0))
        break
      case 'Home':
        e.preventDefault()
        moveActive(0)
        break
      case 'End':
        e.preventDefault()
        moveActive(ACTION_OPTIONS.length - 1)
        break
      case 'Enter':
      case ' ':
        if (!actionMenuOpen) return
        e.preventDefault()
        selectAction(activeAction)
        break
      case 'Escape':
        if (!actionMenuOpen) return
        e.preventDefault()
        e.stopPropagation()
        setActionMenuOpen(false)
        actionTriggerRef.current?.focus()
        break
      case 'Tab':
        setActionMenuOpen(false)
        break
    }
  }

  useEffect(() => {
    setSelectedSavedAddonIds(new Set())
    setSelectedAddonIds(new Set())
    setSelectedUpdateAddonIds(new Set())
    setSelectedBulkTag('')
    if (filterTimeoutRef.current) clearTimeout(filterTimeoutRef.current)
    setFilterQuery('') // Reset filter on action switch
    setDebouncedFilterQuery('')
    setError(null)
    setSuccess(false)
    setResult(null)
    setProgress(null)
    cancelRequestedRef.current = false
    setActionMenuOpen(false)
  }, [action])

  const libraryArray = useMemo(() => Object.values(library), [library])

  const sortedSavedAddons = [...libraryArray]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(a => {
      if (!debouncedFilterQuery) return true
      return a.name.toLowerCase().includes(debouncedFilterQuery.toLowerCase()) ||
        a.manifest.name.toLowerCase().includes(debouncedFilterQuery.toLowerCase())
    })

  const allTags = getAllTags()

  const currentTagAddonsCount = selectedInstallTagName
    // filtering logic for tags doesn't need search, but maybe? 
    ? libraryArray.filter((addon: any) => addon.tags.includes(selectedInstallTagName)).length
    : 0

  const isTagAction = action === 'install-from-library' && installMode === 'tag'
  const isInvalidTag = isTagAction && selectedInstallTagName !== '' && currentTagAddonsCount === 0

  const allAddonsRaw = useMemo(() => {
    const allAddonsMap = new Map<string, { addon: AddonDescriptor, accounts: StremioAccount[] }>()

    selectedAccounts.forEach((acc: StremioAccount) => {
      acc.addons.forEach((addon: AddonDescriptor) => {
        const key = getAddonGroupKey(addon)
        if (!allAddonsMap.has(key)) {
          allAddonsMap.set(key, { addon, accounts: [] })
        }
        allAddonsMap.get(key)?.accounts.push(acc)
      })
    })

    return Array.from(allAddonsMap.values())
      .sort((a, b) => (a.addon.manifest.name || '').localeCompare(b.addon.manifest.name || ''))
  }, [selectedAccounts])

  const allAddons = (showProtected
    ? allAddonsRaw
    : allAddonsRaw.filter(item => !item.addon.flags?.protected)
  ).filter(item => {
    if (!debouncedFilterQuery) return true
    return (item.addon.manifest.name || '').toLowerCase().includes(debouncedFilterQuery.toLowerCase())
  })

  const selectedSavedAddonsForPreview = useMemo(
    () => Array.from(selectedSavedAddonIds)
      .map(id => library[id])
      .filter(Boolean),
    [library, selectedSavedAddonIds]
  )

  const installGroupAddons = useMemo(() => {
    if (installMode === 'profile' && selectedInstallProfileId) {
      return selectedInstallProfileId === 'unassigned'
        ? libraryArray.filter(addon => !addon.profileId)
        : libraryArray.filter(addon => addon.profileId === selectedInstallProfileId)
    }
    if (installMode === 'tag' && selectedInstallTagName) {
      return libraryArray.filter(addon => addon.tags.includes(selectedInstallTagName))
    }
    return []
  }, [installMode, libraryArray, selectedInstallProfileId, selectedInstallTagName])

  const urlEntries = useMemo(
    () => urlList.split(/\r?\n/).map(url => url.trim()).filter(Boolean),
    [urlList]
  )

  const sourceAccount = useMemo(
    () => allAccounts.find(account => account.id === sourceAccountId),
    [allAccounts, sourceAccountId]
  )

  const effectiveTargetAccounts = useMemo(() => {
    if ((action === 'clone-account' || action === 'sync-order') && sourceAccountId) {
      return selectedAccounts.filter(account => account.id !== sourceAccountId)
    }
    return selectedAccounts
  }, [action, selectedAccounts, sourceAccountId])

  const batchPreview = useMemo<BatchPreview>(() => {
    const targetCount = effectiveTargetAccounts.length
    const notes = ['This is an estimate. AIOManager checks the account again before making changes.']
    const totalTargetAddons = effectiveTargetAccounts.reduce((total, account) => total + account.addons.length, 0)
    const getInstalledPreviewAddons = (urls: string[], detail: string, tone: PreviewTone, mode: 'url' | 'canonical' = 'url') => {
      if (urls.length === 0) return []
      const targets = new Set(urls.map(url => mode === 'canonical'
        ? getCanonicalAddonUrl(url)
        : normalizeAddonUrl(url)
      ).filter(Boolean))

      return uniquePreviewAddons(
        allAddonsRaw
          .filter(item => targets.has(mode === 'canonical'
            ? getCanonicalAddonUrl(item.addon.transportUrl)
            : normalizeAddonUrl(item.addon.transportUrl)
          ))
          .map(item => descriptorToPreview(item.addon, detail, tone))
      )
    }

    const buildInstallPreview = (addons: typeof libraryArray, title: string, emptyText: string): BatchPreview => {
      const installUrls = addons.map(addon => addon.installUrl)
      if (installUrls.length === 0) {
        return createPickFirstPreview(title, emptyText, targetCount)
      }

      let updates = 0
      let installs = 0
      const rows: PreviewAccountRow[] = effectiveTargetAccounts.map((account) => {
        const existing = countByUrl(account, installUrls)
        const missing = Math.max(0, installUrls.length - existing)
        updates += existing
        installs += missing
        return {
          id: account.id,
          name: getAccountName(account),
          detail: `${missing} to add, ${existing} to update`,
          tone: missing > 0 ? 'success' : 'muted',
        }
      })

      return {
        title,
        description: `${addons.length} add-on${addons.length !== 1 ? 's' : ''} will be added where missing and updated where already installed.`,
        targetCount,
        tone: 'success',
        stats: [
          { label: 'Picked', value: addons.length },
          { label: 'Will add', value: installs, tone: installs > 0 ? 'success' : 'muted' },
          { label: 'Will update', value: updates, tone: updates > 0 ? 'success' : 'muted' },
          { label: 'Accounts', value: targetCount },
        ],
        addons: addons.map(addon => savedAddonToPreview(addon, 'Will add/update')),
        rows,
        notes,
      }
    }

    switch (action) {
      case 'install-from-library': {
        const profileName = selectedInstallProfileId === 'unassigned'
          ? 'Unassigned'
          : profiles.find(profile => profile.id === selectedInstallProfileId)?.name
        const groupName = installMode === 'profile'
          ? (profileName || 'Select a profile')
          : (selectedInstallTagName || 'Select a tag')
        return buildInstallPreview(
          installGroupAddons,
          installGroupAddons.length > 0 ? `Add add-ons from ${groupName}` : 'Pick a group first',
          installMode === 'profile' ? 'Pick a library profile first.' : 'Pick a tag first.'
        )
      }

      case 'add-saved-addons':
        return buildInstallPreview(
          selectedSavedAddonsForPreview,
          selectedSavedAddonsForPreview.length > 0 ? 'Add selected saved add-ons' : 'Pick saved add-ons first',
          'Choose one or more saved add-ons. Nothing will change until you run it.'
        )

      case 'install-from-url': {
        if (urlEntries.length === 0) {
          return createPickFirstPreview('Paste add-on links first', 'Paste one add-on link per line. Nothing will change until you run it.', targetCount)
        }

        let updates = 0
        let installs = 0
        const rows: PreviewAccountRow[] = effectiveTargetAccounts.map((account) => {
          const existing = countByUrl(account, urlEntries)
          const missing = Math.max(0, urlEntries.length - existing)
          updates += existing
          installs += missing
          return {
            id: account.id,
            name: getAccountName(account),
            detail: `${missing} to add, ${existing} to update`,
            tone: missing > 0 ? 'success' : 'muted',
          }
        })

        return {
          title: 'Add pasted links',
          description: `${urlEntries.length} link${urlEntries.length !== 1 ? 's' : ''} will be checked, then added where missing and updated where already installed.`,
          targetCount,
          tone: 'success',
          stats: [
            { label: 'Links', value: urlEntries.length },
            { label: 'Will add', value: installs, tone: installs > 0 ? 'success' : 'muted' },
            { label: 'Will update', value: updates, tone: updates > 0 ? 'success' : 'muted' },
            { label: 'Accounts', value: targetCount },
          ],
          addons: urlEntries.map(url => ({ ...linkToPreview(url), detail: 'Will add/update' })),
          rows,
          notes: [...notes, 'If a link is broken, it will be skipped and shown in the result.'],
        }
      }

      case 'clone-account': {
        if (!sourceAccount) {
          return createPickFirstPreview('Pick an account to copy from', 'Choose the account you want to use as the source. Nothing will change until you run it.', targetCount)
        }

        const sourceAddons = sourceAccount?.addons ?? []
        const sourceUrls = sourceAddons.map(addon => addon.transportUrl)
        const sourceUrlSet = new Set(sourceUrls.map(url => normalizeAddonUrl(url)))
        let missingInstalls = 0
        let removed = 0
        const rows: PreviewAccountRow[] = effectiveTargetAccounts.map((account) => {
          const existing = countByUrl(account, sourceUrls)
          const missing = Math.max(0, sourceAddons.length - existing)
          const targetOnly = overwriteClone
            ? account.addons.filter(addon => !sourceUrlSet.has(normalizeAddonUrl(addon.transportUrl))).length
            : 0
          missingInstalls += missing
          removed += targetOnly
          return {
            id: account.id,
            name: getAccountName(account),
            detail: overwriteClone
              ? `${sourceAddons.length} after copy, ${targetOnly} may be removed`
              : `${missing} to add, current add-ons stay`,
            tone: overwriteClone && targetOnly > 0 ? 'warning' : 'success',
          }
        })

        return {
          title: overwriteClone ? `Make accounts match ${getAccountName(sourceAccount)}` : `Copy missing add-ons from ${getAccountName(sourceAccount)}`,
          description: overwriteClone ? 'Accounts will be changed to match the source account.' : 'Current add-ons stay. Only missing add-ons are copied over.',
          targetCount,
          tone: overwriteClone ? 'warning' : 'success',
          stats: [
            { label: 'Source add-ons', value: sourceAddons.length },
            { label: overwriteClone ? 'May remove' : 'Will add', value: overwriteClone ? removed : missingInstalls, tone: overwriteClone && removed > 0 ? 'warning' : 'success' },
            { label: 'Accounts', value: targetCount },
          ],
          addons: sourceAddons.map(addon => descriptorToPreview(addon, overwriteClone ? 'Will copy' : 'Will add')),
          rows,
          notes: overwriteClone
            ? [...notes, 'Matching can remove add-ons that only exist on the selected accounts.']
            : notes,
        }
      }

      case 'sync-order': {
        if (!sourceAccount) {
          return createPickFirstPreview('Pick an account to match', 'Choose the account whose add-on order should be copied. Nothing will change until you run it.', targetCount)
        }

        const sourceAddons = sourceAccount?.addons ?? []
        const sourceNormUrls = new Set(sourceAddons.map(addon => normalizeAddonUrl(addon.transportUrl)))
        const sourceIds = new Set(sourceAddons.map(addon => addon.manifest.id).filter(Boolean))
        const sourceNames = new Set(sourceAddons.map(addon => addon.manifest.name).filter(Boolean))
        let matched = 0
        const rows: PreviewAccountRow[] = effectiveTargetAccounts.map((account) => {
          const accountMatches = account.addons.filter(addon => (
            sourceNormUrls.has(normalizeAddonUrl(addon.transportUrl)) ||
            sourceIds.has(addon.manifest.id) ||
            sourceNames.has(addon.manifest.name)
          )).length
          matched += accountMatches
          return {
            id: account.id,
            name: getAccountName(account),
            detail: `${accountMatches} of ${account.addons.length} can be moved`,
            tone: accountMatches > 0 ? 'success' : 'muted',
          }
        })

        return {
          title: `Match the order from ${getAccountName(sourceAccount)}`,
          description: 'Only the order changes. Extra add-ons stay at the bottom.',
          targetCount,
          tone: 'muted',
          stats: [
            { label: 'Source list', value: sourceAddons.length },
            { label: 'Can move', value: matched, tone: matched > 0 ? 'success' : 'muted' },
            { label: 'Accounts', value: targetCount },
          ],
          addons: sourceAddons.map(addon => descriptorToPreview(addon, 'Order source', 'muted')),
          rows,
          notes,
        }
      }

      case 'update-addons': {
        const selectedUrls = Array.from(selectedUpdateAddonIds)
        if (selectedUrls.length === 0) {
          return createPickFirstPreview('Pick add-ons to update', 'Choose one or more installed add-ons. Nothing will change until you run it.', targetCount)
        }

        let refreshes = 0
        let lockedIncluded = 0
        const rows: PreviewAccountRow[] = effectiveTargetAccounts.map((account) => {
          const matched = countByCanonicalUrl(account, selectedUrls)
          const protectedMatches = countProtectedCanonicalMatches(account, selectedUrls)
          refreshes += matched
          lockedIncluded += protectedMatches
          return {
            id: account.id,
            name: getAccountName(account),
            detail: protectedMatches > 0 ? `${matched} to check, ${protectedMatches} locked` : `${matched} to check`,
            tone: matched > 0 ? 'success' : 'muted',
          }
        })

        const stats: PreviewStat[] = [
          { label: 'Picked', value: selectedUrls.length },
          { label: 'Will check', value: refreshes, tone: refreshes > 0 ? 'success' : 'muted' },
        ]
        if (lockedIncluded > 0) {
          stats.push({ label: 'Locked included', value: lockedIncluded, detail: 'selected by you', tone: 'warning' })
        }
        stats.push({ label: 'Accounts', value: targetCount })

        return {
          title: 'Update selected add-ons',
          description: 'AIOManager will check these add-ons again and use the newest copy it finds.',
          targetCount,
          tone: 'success',
          stats,
          addons: getInstalledPreviewAddons(selectedUrls, 'Will check', 'success', 'canonical'),
          rows,
          notes,
        }
      }

      case 'remove-by-tag': {
        if (!selectedBulkTag) {
          return createPickFirstPreview('Pick a tag first', 'Choose a tag, then AIOManager will show what would be removed.', targetCount, 'destructive')
        }

        const taggedAddons = selectedBulkTag ? libraryArray.filter(addon => addon.tags.includes(selectedBulkTag)) : []
        const taggedUrls = taggedAddons.map(addon => addon.installUrl)
        let removals = 0
        let protectedSkipped = 0
        const rows: PreviewAccountRow[] = effectiveTargetAccounts.map((account) => {
          const matches = countByUrl(account, taggedUrls)
          const protectedMatches = countProtectedMatches(account, taggedUrls)
          const removable = Math.max(0, matches - protectedMatches)
          removals += removable
          protectedSkipped += protectedMatches
          return {
            id: account.id,
            name: getAccountName(account),
            detail: `${removable} to remove, ${protectedMatches} locked`,
            tone: removable > 0 ? 'destructive' : protectedMatches > 0 ? 'warning' : 'muted',
          }
        })

        return {
          title: `Remove add-ons tagged ${selectedBulkTag}`,
          description: taggedAddons.length > 0 ? `${taggedAddons.length} saved add-on${taggedAddons.length !== 1 ? 's' : ''} use this tag. Locked add-ons are left alone.` : 'No saved add-ons use this tag.',
          targetCount,
          tone: 'destructive',
          stats: [
            { label: 'With tag', value: taggedAddons.length },
            { label: 'Will remove', value: removals, tone: removals > 0 ? 'destructive' : 'muted' },
            { label: 'Left alone', value: protectedSkipped, tone: protectedSkipped > 0 ? 'warning' : 'muted' },
            { label: 'Accounts', value: targetCount },
          ],
          addons: taggedAddons.map(addon => savedAddonToPreview(addon, 'Will remove', 'destructive')),
          rows,
          notes,
        }
      }

      case 'remove-addons': {
        const selectedUrls = Array.from(selectedAddonIds)
        if (selectedUrls.length === 0) {
          return createPickFirstPreview('Pick add-ons to remove', 'Choose one or more installed add-ons. Nothing will change until you run it.', targetCount, 'destructive')
        }

        let removals = 0
        let lockedIncluded = 0
        const rows: PreviewAccountRow[] = effectiveTargetAccounts.map((account) => {
          const matches = countByUrl(account, selectedUrls)
          const protectedMatches = countProtectedMatches(account, selectedUrls)
          removals += matches
          lockedIncluded += protectedMatches
          return {
            id: account.id,
            name: getAccountName(account),
            detail: protectedMatches > 0 ? `${matches} to remove, ${protectedMatches} locked` : `${matches} to remove`,
            tone: matches > 0 ? 'destructive' : 'muted',
          }
        })

        const stats: PreviewStat[] = [
          { label: 'Picked', value: selectedUrls.length },
          { label: 'Will remove', value: removals, tone: removals > 0 ? 'destructive' : 'muted' },
        ]
        if (lockedIncluded > 0) {
          stats.push({ label: 'Locked included', value: lockedIncluded, detail: 'selected by you', tone: 'warning' })
        }
        stats.push({ label: 'Accounts', value: targetCount })

        return {
          title: 'Remove selected add-ons',
          description: 'These add-ons will be removed from any selected account where they are found, including locked ones you selected.',
          targetCount,
          tone: 'destructive',
          stats,
          addons: getInstalledPreviewAddons(selectedUrls, 'Will remove', 'destructive'),
          rows,
          notes,
        }
      }

      case 'reinstall-all': {
        let refreshes = 0
        let lockedIncluded = 0
        const rows: PreviewAccountRow[] = effectiveTargetAccounts.map((account) => {
          const protectedCount = account.addons.filter(addon => addon.flags?.protected).length
          const refreshCount = account.addons.length
          refreshes += refreshCount
          lockedIncluded += protectedCount
          return {
            id: account.id,
            name: getAccountName(account),
            detail: protectedCount > 0 ? `${refreshCount} to check, ${protectedCount} locked` : `${refreshCount} to check`,
            tone: refreshCount > 0 ? 'success' : 'muted',
          }
        })

        const stats: PreviewStat[] = [
          { label: 'On accounts', value: totalTargetAddons },
          { label: 'Will check', value: refreshes, tone: refreshes > 0 ? 'success' : 'muted' },
        ]
        if (lockedIncluded > 0) {
          stats.push({ label: 'Locked included', value: lockedIncluded, detail: 'still checked', tone: 'warning' })
        }
        stats.push({ label: 'Accounts', value: targetCount })

        return {
          title: 'Update every add-on',
          description: 'AIOManager will check every add-on on these accounts and use the newest copy it finds.',
          targetCount,
          tone: 'warning',
          stats,
          addons: uniquePreviewAddons(
            effectiveTargetAccounts.flatMap(account => (
              account.addons
                .map(addon => descriptorToPreview(addon, 'Will check', 'success'))
            ))
          ),
          rows,
          notes,
        }
      }

      case 'protect-all':
      case 'unprotect-all': {
        const enableProtection = action === 'protect-all'
        let changes = 0
        let already = 0
        const rows: PreviewAccountRow[] = effectiveTargetAccounts.map((account) => {
          const protectedCount = account.addons.filter(addon => addon.flags?.protected).length
          const changeCount = enableProtection ? account.addons.length - protectedCount : protectedCount
          const alreadyCount = account.addons.length - changeCount
          changes += changeCount
          already += alreadyCount
          return {
            id: account.id,
            name: getAccountName(account),
            detail: `${changeCount} change${changeCount !== 1 ? 's' : ''}, ${alreadyCount} unchanged`,
            tone: changeCount > 0 ? 'success' : 'muted',
          }
        })

        return {
          title: enableProtection ? 'Lock all add-ons' : 'Unlock all add-ons',
          description: enableProtection ? 'Locked add-ons are left alone by tag-based cleanup.' : 'Unlocked add-ons can be removed by tag-based cleanup again.',
          targetCount,
          tone: enableProtection ? 'success' : 'warning',
          stats: [
            { label: 'On accounts', value: totalTargetAddons },
            { label: 'Will change', value: changes, tone: changes > 0 ? 'success' : 'muted' },
            { label: 'Already okay', value: already },
            { label: 'Accounts', value: targetCount },
          ],
          addons: uniquePreviewAddons(
            effectiveTargetAccounts.flatMap(account => (
              account.addons
                .filter(addon => enableProtection ? !addon.flags?.protected : addon.flags?.protected)
                .map(addon => descriptorToPreview(addon, enableProtection ? 'Will lock' : 'Will unlock', enableProtection ? 'success' : 'warning'))
            ))
          ),
          rows,
          notes,
        }
      }
    }

    return {
      title: ACTION_TITLES[action],
      description: ACTION_DESCRIPTIONS[action],
      targetCount,
      tone: 'muted',
      stats: [
        { label: 'Accounts', value: targetCount },
        { label: 'Add-ons', value: totalTargetAddons },
        { label: 'Will update', value: targetCount },
        { label: 'Mode', value: 'Bulk' },
      ],
      addons: [],
      rows: [],
      notes,
    }
  }, [
    action,
    effectiveTargetAccounts,
    installGroupAddons,
    installMode,
    libraryArray,
    overwriteClone,
    profiles,
    selectedAddonIds,
    selectedBulkTag,
    selectedInstallProfileId,
    selectedInstallTagName,
    selectedSavedAddonsForPreview,
    selectedUpdateAddonIds,
    selectedAccounts.length,
    allAddonsRaw,
    sourceAccount,
    urlEntries,
  ])

  const toggleSavedAddon = (savedAddonId: string) => {
    setSelectedSavedAddonIds((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(savedAddonId)) {
        newSet.delete(savedAddonId)
      } else {
        newSet.add(savedAddonId)
      }
      return newSet
    })
  }

  const toggleAddon = (addonId: string) => {
    setSelectedAddonIds((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(addonId)) {
        newSet.delete(addonId)
      } else {
        newSet.add(addonId)
      }
      return newSet
    })
  }

  const appendBulkResult = (target: BulkResult, update: BulkResult) => {
    target.success += update.success
    target.failed += update.failed
    target.errors.push(...update.errors)
    target.details.push(...update.details)
  }

  const handleCancelOperation = () => {
    cancelRequestedRef.current = true
    setProgress(prev => prev && prev.status === 'running' ? { ...prev, status: 'cancelling' } : prev)
  }

  const handleExecute = async () => {
    if (isExecuting) return

    setError(null)
    setSuccess(false)
    setResult(null)
    cancelRequestedRef.current = false

    const accountsData: BulkAccountTarget[] = selectedAccounts.map((a: StremioAccount) => ({
      id: a.id,
      authKey: a.authKey,
    }))

    const aggregate: BulkResult = {
      success: 0,
      failed: 0,
      errors: [],
      details: [],
    }

    try {
      let targets = accountsData
      let runForAccount: ((target: BulkAccountTarget) => Promise<BulkResult>) | null = null

      switch (action) {
        case 'remove-by-tag': {
          if (!selectedBulkTag) {
            setError('Select a tag')
            return
          }
          runForAccount = (target) => bulkRemoveByTag(selectedBulkTag, [target])
          break
        }

        case 'add-saved-addons': {
          if (selectedSavedAddonIds.size === 0) {
            setError('Choose at least one saved add-on')
            return
          }
          const addonIds = Array.from(selectedSavedAddonIds)
          runForAccount = (target) => bulkApplySavedAddons(addonIds, [target], true)
          break
        }

        case 'remove-addons': {
          if (selectedAddonIds.size === 0) {
            setError('Choose at least one add-on to remove')
            return
          }
          const addonIds = Array.from(selectedAddonIds)
          runForAccount = (target) => bulkRemoveAddons(addonIds, [target], true)
          break
        }

        case 'update-addons': {
          if (selectedUpdateAddonIds.size === 0) {
            setError('Choose at least one add-on to update')
            return
          }
          const addonIds = Array.from(selectedUpdateAddonIds)
          runForAccount = (target) => bulkReinstallAddons(addonIds, [target], true)
          break
        }

        case 'install-from-url': {
          const urls = urlList.split('\n').map(u => u.trim()).filter(u => u.length > 0)
          if (urls.length === 0) {
            setError('Enter at least one URL')
            return
          }
          runForAccount = (target) => bulkInstallFromUrls(urls, [target], true)
          break
        }

        case 'clone-account': {
          if (!sourceAccountId) {
            setError('Select a source account')
            return
          }
          const sourceAccount = allAccounts.find(a => a.id === sourceAccountId)
          if (!sourceAccount) {
            setError('Source account not found')
            return
          }
          targets = accountsData.filter(target => target.id !== sourceAccount.id)
          runForAccount = (target) => bulkCloneAccount(
            { id: sourceAccount.id, authKey: sourceAccount.authKey },
            [target],
            overwriteClone
          )
          break
        }

        case 'sync-order': {
          if (!sourceAccountId) {
            setError('Select a source account')
            return
          }
          if (!allAccounts.find(a => a.id === sourceAccountId)) {
            setError('Source account not found')
            return
          }
          targets = accountsData.filter(target => target.id !== sourceAccountId)
          runForAccount = (target) => bulkSyncOrder(sourceAccountId, [target])
          break
        }

        case 'protect-all':
          runForAccount = async (target) => {
            const targetAccount = selectedAccounts.find(account => account.id === target.id) || allAccounts.find(account => account.id === target.id)
            if (!targetAccount) throw new Error('Account not found')
            await bulkProtectAddons(target.id, true)
            return {
              success: 1,
              failed: 0,
              errors: [],
              details: [{ accountId: target.id, result: createProtectionMergeResult(targetAccount, true) }],
            }
          }
          break

        case 'unprotect-all':
          runForAccount = async (target) => {
            const targetAccount = selectedAccounts.find(account => account.id === target.id) || allAccounts.find(account => account.id === target.id)
            if (!targetAccount) throw new Error('Account not found')
            await bulkProtectAddons(target.id, false)
            return {
              success: 1,
              failed: 0,
              errors: [],
              details: [{ accountId: target.id, result: createProtectionMergeResult(targetAccount, false) }],
            }
          }
          break

        case 'reinstall-all':
          runForAccount = (target) => bulkReinstallAddons(['*'], [target], true)
          break

        case 'install-from-library': {
          const libraryArray = Object.values(library)
          let addonsToInstall: any[] = []
          if (installMode === 'profile' && selectedInstallProfileId) {
            addonsToInstall = selectedInstallProfileId === 'unassigned'
              ? libraryArray.filter(a => !a.profileId)
              : libraryArray.filter(a => a.profileId === selectedInstallProfileId)
          } else if (installMode === 'tag' && selectedInstallTagName) {
            addonsToInstall = libraryArray.filter(a => a.tags.includes(selectedInstallTagName))
          }

          if (addonsToInstall.length === 0) {
            setError('No add-ons found in the selected group')
            return
          }

          const addonIds = addonsToInstall.map(a => a.id)
          runForAccount = (target) => bulkApplySavedAddons(addonIds, [target], true)
          break
        }
      }

      if (!runForAccount) {
        throw new Error('Action failed or not implemented')
      }

      if (targets.length === 0) {
        setError('No accounts to update')
        return
      }

      setProgress({ status: 'running', current: 0, total: targets.length })

      let completedCount = 0
      const workerResults = await mapConcurrent(targets, 5, async (target) => {
        if (cancelRequestedRef.current) {
          return { cancelled: true }
        }

        const targetAccount = selectedAccounts.find(a => a.id === target.id) || allAccounts.find(a => a.id === target.id)
        const accountName = targetAccount?.name || targetAccount?.email || `${target.id.substring(0, 8)}...`

        setProgress({ status: 'running', current: completedCount, total: targets.length, accountName })

        try {
          const accountResult = await runForAccount(target)
          completedCount++
          setProgress({
            status: cancelRequestedRef.current ? 'cancelling' : 'running',
            current: completedCount,
            total: targets.length,
            accountName,
          })
          return { cancelled: false, result: accountResult, error: null, targetId: target.id }
        } catch (err) {
          completedCount++
          setProgress({
            status: cancelRequestedRef.current ? 'cancelling' : 'running',
            current: completedCount,
            total: targets.length,
            accountName,
          })
          return { cancelled: false, result: null, error: err instanceof Error ? err.message : 'Unknown error', targetId: target.id }
        }
      })

      for (const wr of workerResults) {
        if (wr.cancelled) continue
        if (wr.result) {
          appendBulkResult(aggregate, wr.result)
        } else if (wr.error) {
          aggregate.failed++
          aggregate.errors.push({
            accountId: wr.targetId,
            error: wr.error,
          })
        }
      }

      const processed = aggregate.success + aggregate.failed
      const wasCancelled = cancelRequestedRef.current && processed < targets.length

      setResult(aggregate)
      setSuccess(processed > 0)
      setProgress({
        status: wasCancelled ? 'cancelled' : 'complete',
        current: processed,
        total: targets.length,
      })

      if (wasCancelled) {
        setError(`Cancelled after ${processed} of ${targets.length} account${targets.length !== 1 ? 's' : ''}.`)
        return
      }

      if (processed === 0) {
        setError('No accounts were processed')
        return
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed')
      setProgress(null)
    }
  }

  const progressPercent = progress?.total ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 lg:px-6">
      {progress && progress.status !== 'complete' && (
        <div className="rounded-2xl border border-primary/20 bg-primary/10 p-3 animate-in fade-in slide-in-from-top-2">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-primary">
                <Loader2 className={cn("h-4 w-4", progress.status === 'running' && "animate-spin")} />
                {progress.status === 'cancelled'
                  ? 'Operation cancelled'
                  : progress.status === 'cancelling'
                    ? 'Cancelling after current account...'
                    : 'Bulk operation in progress'}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {progress.accountName
                  ? `Processing ${progress.accountName}`
                  : `${progress.current} of ${progress.total} account${progress.total !== 1 ? 's' : ''} processed`}
              </p>
            </div>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-primary">
              {Math.min(progress.current, progress.total)} / {progress.total}
            </span>
          </div>
          <Progress value={progressPercent} shimmer={progress.status === 'running'} className="h-2 bg-background/70" />
          {progress.status !== 'cancelled' && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Cancel stops before the next account; the account currently being processed will finish safely.
            </p>
          )}
        </div>
      )}

      {success && result && (
        <ResultReceipt result={result} accounts={[...selectedAccounts, ...allAccounts]} action={action} />
      )}

      {error && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 animate-in fade-in slide-in-from-top-2">
          <p className="text-sm text-destructive font-medium">{error}</p>
        </div>
      )}

      <div className="space-y-4">
        <Card className="border-border/45 bg-card/70 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <LayoutGrid className="h-4 w-4" />
              Operation Mode
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Choose one bulk operation for {selectedAccounts.length} account{selectedAccounts.length !== 1 ? 's' : ''}.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="action-select">I want to...</Label>
            <div className="relative">
              <button
                ref={actionTriggerRef}
                id="action-select"
                type="button"
                onClick={() => setActionMenuOpen(open => !open)}
                onKeyDown={handleActionMenuKeyDown}
                aria-haspopup="listbox"
                aria-expanded={actionMenuOpen}
                aria-controls={actionMenuOpen ? actionMenuId : undefined}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-border/40 bg-background/70 px-3 py-2 text-left transition-colors hover:border-primary/25 hover:bg-muted/30"
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border",
                    DANGER_ACTIONS.has(action)
                      ? "border-destructive/15 bg-destructive/10 text-destructive"
                      : WARNING_ACTIONS.has(action)
                        ? "border-warning/15 bg-warning/10 text-warning"
                        : "border-primary/15 bg-primary/10 text-primary",
                  )}
                >
                  {getActionIcon(action)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{ACTION_TITLES[action]}</span>
                  <span className="block truncate text-xs text-muted-foreground">{ACTION_DESCRIPTIONS[action]}</span>
                </span>
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", actionMenuOpen && "rotate-180")} />
              </button>

              {actionMenuOpen && (
                <div
                  ref={actionMenuRef}
                  id={actionMenuId}
                  role="listbox"
                  tabIndex={-1}
                  aria-labelledby="action-select"
                  aria-activedescendant={getActionOptionId(activeAction)}
                  onKeyDown={handleActionMenuKeyDown}
                  className="mt-2 max-h-[min(52vh,26rem)] overflow-y-auto overscroll-contain rounded-2xl border border-border/40 bg-background p-1.5 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {ACTION_GROUPS.map((group) => (
                    <div key={group.label} className="py-1">
                      <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</div>
                      {group.actions.map((item) => {
                        const selected = action === item
                        return (
                          <button
                            key={item}
                            id={getActionOptionId(item)}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            tabIndex={-1}
                            onClick={() => {
                              selectAction(item)
                            }}
                            onMouseEnter={() => setActiveActionIndex(ACTION_OPTIONS.indexOf(item))}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                              selected
                                ? "bg-primary/12 text-primary"
                                : item === activeAction
                                  ? "bg-muted/45"
                                  : "hover:bg-muted/45",
                            )}
                          >
                          <span
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border",
                              selected
                                ? "border-primary/20 bg-primary/15 text-primary"
                                :
                              DANGER_ACTIONS.has(item)
                                ? "border-destructive/15 bg-destructive/10 text-destructive"
                                : WARNING_ACTIONS.has(item)
                                  ? "border-warning/15 bg-warning/10 text-warning"
                                  : "border-primary/15 bg-primary/10 text-primary",
                            )}
                          >
                            {getActionIcon(item)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">{ACTION_TITLES[item]}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {ACTION_DESCRIPTIONS[item]}
                            </span>
                          </span>
                          {selected && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          <Card className="overflow-hidden border-border/45 bg-card/80 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border",
                    DANGER_ACTIONS.has(action)
                      ? "border-destructive/20 bg-destructive/10 text-destructive"
                      : WARNING_ACTIONS.has(action)
                        ? "border-warning/20 bg-warning/10 text-warning"
                        : "border-primary/20 bg-primary/12 text-primary",
                  )}
                >
                  {getActionIcon(action, "h-5 w-5")}
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-lg leading-tight">{ACTION_TITLES[action]}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{ACTION_DESCRIPTIONS[action]}</p>
                </div>
              </div>
              <span className="w-fit rounded-full border border-border/40 bg-background/70 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                {selectedAccounts.length} account{selectedAccounts.length !== 1 ? 's' : ''}
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-5">
            {action === 'add-saved-addons' && (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <Label>Select Saved Addons</Label>
                  <div className="flex gap-3 items-center w-full sm:w-auto">
                    <div className="relative flex-1 sm:w-32">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                      <Input
                        placeholder="Filter..."
                        className="h-7 text-xs pl-7 pr-7"
                        value={filterQuery}
                        onChange={e => handleFilterChange(e.target.value)}
                      />
                      {filterQuery && (
                        <button
                          onClick={() => handleFilterChange('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-accent rounded-full transition-colors"
                        >
                          <X className="h-2 w-2 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-primary px-2"
                        onClick={() => setSelectedSavedAddonIds(new Set(sortedSavedAddons.map(a => a.id)))}
                      >
                        All
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-muted-foreground px-2"
                        onClick={() => setSelectedSavedAddonIds(new Set())}
                      >
                        None
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="border rounded-md max-h-60 overflow-y-auto bg-background">
                  {sortedSavedAddons.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-8 text-center italic">
                      No saved add-ons in your library.
                    </p>
                  ) : (
                    <div className="divide-y">
                      {sortedSavedAddons.map((savedAddon) => (
                        <label
                          key={savedAddon.id}
                          className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            className="rounded border-border/40 text-primary focus:ring-primary"
                            checked={selectedSavedAddonIds.has(savedAddon.id)}
                            onChange={() => toggleSavedAddon(savedAddon.id)}
                          />
                          <AddonIcon
                            name={savedAddon.name}
                            logo={savedAddon.metadata?.customLogo || savedAddon.manifest.logo}
                            alt={savedAddon.name}
                            className="h-8 w-8"
                            textClassName="text-xs"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium truncate">{savedAddon.name}</p>
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{savedAddon.manifest.name}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {action === 'install-from-library' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="space-y-1.5 px-1">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Installation Source</p>
                  <div className="flex bg-muted/50 p-1 rounded-xl gap-1 border border-border/40">
                    <Button
                      variant={installMode === 'profile' ? 'secondary' : 'ghost'}
                      className={`flex-1 h-9 text-xs transition-[transform,opacity,box-shadow] duration-200 rounded-lg gap-2 ${installMode === 'profile' ? 'shadow-sm bg-background hover:bg-background' : 'text-muted-foreground hover:text-foreground'}`}
                      onClick={() => setInstallMode('profile')}
                      type="button"
                    >
                      <Library className={`h-3.5 w-3.5 ${installMode === 'profile' ? 'text-primary' : ''}`} />
                      Profiles
                    </Button>
                    <Button
                      variant={installMode === 'tag' ? 'secondary' : 'ghost'}
                      className={`flex-1 h-9 text-xs transition-[transform,opacity,box-shadow] duration-200 rounded-lg gap-2 ${installMode === 'tag' ? 'shadow-sm bg-background hover:bg-background' : 'text-muted-foreground hover:text-foreground'}`}
                      onClick={() => setInstallMode('tag')}
                      type="button"
                    >
                      <Tags className={`h-3.5 w-3.5 ${installMode === 'tag' ? 'text-primary' : ''}`} />
                      Tags
                    </Button>
                  </div>
                </div>

                {installMode === 'profile' ? (
                  <div className="space-y-3 animate-in fade-in duration-300">
                    <div className="space-y-1.5 px-1">
                      <Label className="text-xs font-medium uppercase text-muted-foreground">Select Library Profile</Label>
                      <Select value={selectedInstallProfileId} onValueChange={setSelectedInstallProfileId}>
                        <SelectTrigger className="bg-background/50 border-border/40 h-10">
                          <SelectValue placeholder="Choose a profile..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">
                            <div className="flex items-center gap-2">
                              <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
                              <span>Unassigned Addons</span>
                            </div>
                          </SelectItem>
                          {profiles.map(p => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 animate-in fade-in duration-300">
                    <div className="space-y-1.5 px-1">
                      <Label className="text-xs font-medium uppercase text-muted-foreground">Select Library Tag</Label>
                      <Select value={selectedInstallTagName} onValueChange={setSelectedInstallTagName}>
                        <SelectTrigger className="bg-background/50 border-border/40 h-10">
                          <SelectValue placeholder="Choose a tag..." />
                        </SelectTrigger>
                        <SelectContent>
                          {allTags.map(tag => (
                            <SelectItem key={tag} value={tag}>
                              <div className="flex items-center gap-2">
                                <Tags className="h-3.5 w-3.5 text-primary/60" />
                                <span>{tag}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {((installMode === 'profile' && selectedInstallProfileId) || (installMode === 'tag' && selectedInstallTagName)) && (
                  <div className="p-3 rounded-lg bg-primary/5 border border-primary/10 space-y-2">
                    <p className="text-xs font-semibold uppercase text-primary/70">
                      Addons to Install
                    </p>
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                      {(installMode === 'profile'
                        ? (selectedInstallProfileId === 'unassigned' ? Object.values(library).filter(a => !a.profileId) : Object.values(library).filter(a => a.profileId === selectedInstallProfileId))
                        : Object.values(library).filter(a => a.tags.includes(selectedInstallTagName))
                      ).map(addon => (
                        <div key={addon.id} className="text-xs px-2 py-0.5 bg-background border rounded flex items-center gap-1.5">
                          <AddonIcon
                            name={addon.name}
                            logo={addon.metadata?.customLogo || addon.manifest.logo}
                            className="h-3 w-3"
                            textClassName="text-[8px]"
                            imageClassName="p-0"
                          />
                          <span className="truncate max-w-[120px]">{addon.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {action === 'install-from-url' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Manifest URLs</Label>
                  <p className="text-xs text-muted-foreground">
                    Paste add-on links here, one per line. They will be checked and added to the selected accounts.
                  </p>
                  <textarea
                    className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="https://v3-cinemeta.strem.io/manifest.json&#10;https://opensubtitles.strem.io/manifest.json"
                    value={urlList}
                    onChange={(e) => setUrlList(e.target.value)}
                  />
                </div>
              </div>
            )}

            {(action === 'clone-account' || action === 'sync-order') && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Source Account</Label>
                  <Select value={sourceAccountId} onValueChange={setSourceAccountId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select account to copy from..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allAccounts
                        .filter(acc => !selectedAccounts.some(s => s.id === acc.id))
                        .map((acc) => (
                          <SelectItem key={acc.id} value={acc.id}>
                            <div className="flex items-center gap-2">
                              {acc.emoji && <span className="text-base shrink-0">{acc.emoji}</span>}
                              <span>{acc.name !== acc.email ? acc.name : acc.email}</span>
                            </div>
                          </SelectItem>
                        ))}
                      {allAccounts.filter(acc => !selectedAccounts.some(s => s.id === acc.id)).length === 0 && (
                        <SelectItem value="none" disabled>No other accounts available</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {action === 'clone-account'
                      ? "Add-ons from this account will be copied to the selected accounts."
                      : "Selected accounts will use this account's add-on order. No add-ons will be added or removed."}
                  </p>
                </div>

                {action === 'clone-account' && (
                  <>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-dashed mt-4 animate-in fade-in slide-in-from-top-2">
                      <div className="space-y-0.5">
                        <Label className="text-sm font-semibold flex items-center gap-2">
                          Destructive Mirror
                          {overwriteClone && <AlertTriangle className="h-3 w-3 text-warning" />}
                        </Label>
                        <p className="text-xs text-muted-foreground leading-relaxed pr-8">
                          Replaces selected accounts with this account's add-ons. Add-ons that only exist on selected accounts can be removed.
                        </p>
                      </div>
                      <Switch
                        checked={overwriteClone}
                        onCheckedChange={setOverwriteClone}
                        className="data-[state=checked]:bg-destructive"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {action === 'remove-by-tag' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Select Tag to Remove</Label>
                  <Select value={selectedBulkTag} onValueChange={setSelectedBulkTag}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a tag..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allTags.map(tag => (
                        <SelectItem key={tag} value={tag}>
                          <div className="flex items-center gap-2">
                            <Tags className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{tag}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Add-ons in your library with this tag will be removed from the selected accounts.
                  </p>
                </div>

                {selectedBulkTag && (
                  <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/10 space-y-2 animate-in fade-in slide-in-from-top-2">
                    <p className="text-xs font-semibold uppercase text-destructive/70 flex items-center gap-2">
                      <Trash2 className="h-3 w-3" />
                      Addons to be Removed
                    </p>
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                      {Object.values(library)
                        .filter(a => a.tags.includes(selectedBulkTag))
                        .map(addon => (
                          <div key={addon.id} className="text-xs px-2 py-0.5 bg-background border rounded flex items-center gap-1.5 opacity-70">
                            <AddonIcon
                              name={addon.name}
                              logo={addon.metadata?.customLogo || addon.manifest.logo}
                              className="h-3 w-3"
                              textClassName="text-[8px]"
                              imageClassName="p-0"
                            />
                            <span className="truncate max-w-[120px]">{addon.name}</span>
                          </div>
                        ))}
                      {Object.values(library).filter(a => a.tags.includes(selectedBulkTag)).length === 0 && (
                        <span className="text-xs text-muted-foreground italic">No add-ons found with this tag.</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {action === 'remove-addons' && (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-card p-1 gap-3">
                  <div className="space-y-0.5">
                    <Label>Select Addons to Remove</Label>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="show-prot-remove"
                        checked={showProtected}
                        onCheckedChange={setShowProtected}
                      />
                      <span className="text-xs text-muted-foreground">Show Protected</span>
                    </div>
                  </div>
                  <div className="flex gap-2 items-center w-full sm:w-auto">
                    <div className="relative flex-1 sm:w-32">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                      <Input
                        placeholder="Filter..."
                        className="h-7 text-xs pl-7"
                        value={filterQuery}
                        onChange={e => handleFilterChange(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-primary px-2"
                        onClick={() => setSelectedAddonIds(new Set(allAddons.map(i => i.addon.transportUrl)))}
                      >
                        All
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-muted-foreground px-2"
                        onClick={() => setSelectedAddonIds(new Set())}
                      >
                        None
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="border rounded-md max-h-60 overflow-y-auto bg-background">
                  {allAddons.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-8 text-center italic">No add-ons found on selected accounts.</p>
                  ) : (
                    <div className="divide-y">
                      {allAddons.map((item) => (
                        <label
                          key={item.addon.transportUrl}
                          className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            className="rounded border-border/40 text-destructive focus:ring-destructive"
                            checked={selectedAddonIds.has(item.addon.transportUrl)}
                            onChange={() => toggleAddon(item.addon.transportUrl)}
                          />
                          <AddonIcon
                            name={item.addon.metadata?.customName || item.addon.manifest.name || 'Addon'}
                            logo={item.addon.metadata?.customLogo || item.addon.manifest.logo}
                            alt={item.addon.manifest.name}
                            className="h-8 w-8"
                            textClassName="text-xs"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium truncate">
                                {item.addon.manifest.name}
                                {allAddons.filter(a => a.addon.manifest.name === item.addon.manifest.name).length > 1 && (
                                  <span className="text-xs text-muted-foreground ml-1 font-normal opacity-70">
                                    ({item.addon.transportUrl.slice(-6)})
                                  </span>
                                )}
                              </p>
                              {(item.addon.flags?.protected || item.addon.flags?.official) && (
                                <span className={`text-xs px-1.5 py-0.5 rounded-full whitespace-nowrap ${item.addon.flags?.protected
                                  ? 'bg-warning/10 text-warning'
                                  : 'bg-primary/12 text-primary'
                                  }`}>
                                  {item.addon.flags?.protected ? 'Protected' : 'Official'}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs text-muted-foreground truncate font-mono">{item.addon.manifest.id}</p>
                              <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded truncate max-w-[120px]">
                                {item.accounts.length === selectedAccounts.length ? 'All selected' : item.accounts.map(a => a.name || 'Unknown').join(', ')}
                              </span>
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}


            {action === 'update-addons' && (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-card p-1 gap-3">
                  <div className="space-y-0.5">
                    <Label>Select Addons to Update</Label>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="show-prot-update"
                        checked={showProtected}
                        onCheckedChange={setShowProtected}
                      />
                      <span className="text-xs text-muted-foreground">Show Protected</span>
                    </div>
                  </div>
                  <div className="flex gap-2 items-center w-full sm:w-auto">
                    <div className="relative flex-1 sm:w-32">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                      <Input
                        placeholder="Filter..."
                        className="h-7 text-xs pl-7"
                        value={filterQuery}
                        onChange={e => handleFilterChange(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-primary px-2"
                        onClick={() => setSelectedUpdateAddonIds(new Set(allAddons.map(i => i.addon.transportUrl)))}
                      >
                        All
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-muted-foreground px-2"
                        onClick={() => setSelectedUpdateAddonIds(new Set())}
                      >
                        None
                      </Button>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  Checks selected add-ons again and uses the newest copy available.
                </p>
                <div className="border rounded-md max-h-60 overflow-y-auto bg-background">
                  {allAddons.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-8 text-center italic">No add-ons available.</p>
                  ) : (
                    <div className="divide-y">
                      {allAddons.map((item) => (
                        <label
                          key={item.addon.transportUrl}
                          className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            className="rounded border-border/40 text-primary focus:ring-primary"
                            checked={selectedUpdateAddonIds.has(item.addon.transportUrl)}
                            onChange={() => {
                              setSelectedUpdateAddonIds((prev) => {
                                const newSet = new Set(prev)
                                if (newSet.has(item.addon.transportUrl)) {
                                  newSet.delete(item.addon.transportUrl)
                                } else {
                                  newSet.add(item.addon.transportUrl)
                                }
                                return newSet
                              })
                            }}
                          />
                          <AddonIcon
                            name={item.addon.metadata?.customName || item.addon.manifest.name || 'Addon'}
                            logo={item.addon.metadata?.customLogo || item.addon.manifest.logo}
                            alt={item.addon.manifest.name}
                            className="h-8 w-8"
                            textClassName="text-xs"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium truncate">
                                {item.addon.manifest.name}
                                {allAddons.filter(a => a.addon.manifest.name === item.addon.manifest.name).length > 1 && (
                                  <span className="text-xs text-muted-foreground ml-1 font-normal opacity-70">
                                    ({item.addon.transportUrl.slice(-6)})
                                  </span>
                                )}
                              </p>
                              {(item.addon.flags?.protected || item.addon.flags?.official) && (
                                <span className={`text-xs px-1.5 py-0.5 rounded-full whitespace-nowrap ${item.addon.flags?.protected
                                  ? 'bg-warning/10 text-warning'
                                  : 'bg-primary/12 text-primary'
                                  }`}>
                                  {item.addon.flags?.protected ? 'Protected' : 'Official'}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs text-muted-foreground truncate">v{item.addon.manifest.version}</p>
                              <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded truncate max-w-[120px]">
                                {item.accounts.length === selectedAccounts.length ? 'All selected' : item.accounts.map(a => a.name || 'Unknown').join(', ')}
                              </span>
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {(action === 'protect-all' || action === 'unprotect-all' || action === 'reinstall-all') && (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-muted/30 border border-dashed text-center">
                  <p className="text-sm font-medium">
                    {action === 'reinstall-all'
                      ? `This will check every add-on on the ${selectedAccounts.length} selected accounts.`
                      : `This will ${action === 'protect-all' ? 'lock' : 'unlock'} every add-on on the ${selectedAccounts.length} selected accounts.`
                    }
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {action === 'reinstall-all'
                      ? 'Useful for refreshing add-ons or picking up updates.'
                      : 'Locked add-ons are left alone by tag-based remove tools.'
                    }
                  </p>
                </div>
              </div>
            )}
          </CardContent>
          </Card>
        {!success && <BatchImpactPreview preview={batchPreview} accounts={selectedAccounts} />}
        </div>
      </div>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 pb-4 pt-2 lg:px-6">
        <Button
          type="button"
          variant="subtle"
          onClick={isExecuting ? handleCancelOperation : onClose}
          disabled={progress?.status === 'cancelling'}
          className="h-11 w-full rounded-full font-semibold"
        >
          {isExecuting ? 'Cancel After Current' : success || progress?.status === 'cancelled' ? 'Close' : 'Cancel'}
        </Button>
        <Button
          onClick={handleExecute}
          disabled={loading || isExecuting || success || isInvalidTag}
          className="h-11 w-full gap-2 rounded-full font-semibold"
          type="button"
        >
          {(loading || isExecuting) && <Loader2 className="h-4 w-4 animate-spin" />}
          {isExecuting ? 'Running...' : success ? 'Done' : 'Run'}
        </Button>
      </div>
    </div>
  )
}
