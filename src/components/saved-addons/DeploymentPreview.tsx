import { useMemo, type ReactNode } from 'react'
import { useAccountStore } from '@/store/accountStore'
import { cn, normalizeAddonUrl } from '@/lib/utils'
import type { SavedAddon } from '@/types/saved-addon'
import type { StremioAccount } from '@/types/account'
import { Info, Plus, RefreshCw, ShieldAlert, Trash2, Users } from 'lucide-react'
import { SavedAddonIcon } from './SavedAddonIcon'

interface DeploymentPreviewProps {
  selectedAddonIds: Set<string>
  library: Record<string, SavedAddon>
  accountIds: string[]
  operation?: 'deploy' | 'remove'
  allowProtected?: boolean
}

function AddonPreviewIcon({ name, logo }: { name: string; logo?: string }) {
  return (
    <SavedAddonIcon
      name={name}
      logo={logo}
      className="h-8 w-8"
      textClassName="text-[11px]"
    />
  )
}

type PreviewStat = {
  label: string
  value: number
  detail?: string
  tone?: 'muted' | 'success' | 'warning' | 'destructive'
  icon: ReactNode
}

function PreviewStatCard({ stat }: { stat: PreviewStat }) {
  return (
    <div className={cn(
      "rounded-xl border border-border/35 bg-background/45 p-2.5",
      stat.tone === 'success' && "border-success/25 bg-success/5",
      stat.tone === 'warning' && "border-warning/25 bg-warning/5",
      stat.tone === 'destructive' && "border-destructive/25 bg-destructive/5"
    )}>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {stat.icon}
        <span className="text-[11px] font-semibold uppercase">{stat.label}</span>
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums">{stat.value}</div>
      {stat.detail && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{stat.detail}</div>}
    </div>
  )
}

export function DeploymentPreview({
  selectedAddonIds,
  library,
  accountIds,
  operation = 'deploy',
  allowProtected = true,
}: DeploymentPreviewProps) {
  const accounts = useAccountStore(state => state.accounts)

  const selectedAddons = useMemo(() => (
    Array.from(selectedAddonIds)
      .map(id => library[id])
      .filter(Boolean) as SavedAddon[]
  ), [library, selectedAddonIds])

  const preview = useMemo(() => {
    const accountById = new Map(accounts.map(account => [account.id, account]))
    const targetAccounts = accountIds
      .map(id => accountById.get(id))
      .filter((account): account is StremioAccount => Boolean(account))

    const totals = {
      rows: [] as Array<{
        accountId: string
        accountName: string
        accountEmoji?: string
        installs: number
        refreshes: number
        removals: number
        missing: number
        protectedSkips: number
      }>,
      installs: 0,
      refreshes: 0,
      removals: 0,
      missing: 0,
      protectedSkips: 0,
    }

    targetAccounts.forEach(account => {
      const installedByUrl = new Map(
        account.addons.map(addon => [
          normalizeAddonUrl(addon.transportUrl),
          addon,
        ])
      )

      let installs = 0
      let refreshes = 0
      let removals = 0
      let missing = 0
      let protectedSkips = 0

      selectedAddons.forEach(savedAddon => {
        const existing = installedByUrl.get(normalizeAddonUrl(savedAddon.installUrl))

        if (operation === 'remove') {
          if (!existing) {
            missing += 1
          } else if (existing.flags?.protected && !allowProtected) {
            protectedSkips += 1
          } else {
            removals += 1
          }
          return
        }

        if (!existing) {
          installs += 1
        } else if (existing.flags?.protected && !allowProtected) {
          protectedSkips += 1
        } else {
          refreshes += 1
        }
      })

      const row = {
        accountId: account.id,
        accountName: account.name,
        accountEmoji: account.emoji,
        installs,
        refreshes,
        removals,
        missing,
        protectedSkips,
      }

      totals.rows.push(row)
      totals.installs += row.installs
      totals.refreshes += row.refreshes
      totals.removals += row.removals
      totals.missing += row.missing
      totals.protectedSkips += row.protectedSkips
    })

    return totals
  }, [accountIds, accounts, allowProtected, operation, selectedAddons])

  if (selectedAddons.length === 0 || preview.rows.length === 0) return null

  const stats: PreviewStat[] = operation === 'remove'
    ? [
      {
        label: 'Will remove',
        value: preview.removals,
        tone: preview.removals > 0 ? 'destructive' : 'muted',
        icon: <Trash2 className="h-3.5 w-3.5" />,
      },
      {
        label: 'Not found',
        value: preview.missing,
        detail: 'already absent',
        tone: 'muted',
        icon: <Info className="h-3.5 w-3.5" />,
      },
      ...(preview.protectedSkips > 0 ? [{
        label: 'Locked kept',
        value: preview.protectedSkips,
        detail: 'left alone',
        tone: 'warning' as const,
        icon: <ShieldAlert className="h-3.5 w-3.5" />,
      }] : []),
      {
        label: 'Accounts',
        value: preview.rows.length,
        tone: 'muted' as const,
        icon: <Users className="h-3.5 w-3.5" />,
      },
    ]
    : [
      {
        label: 'Will add',
        value: preview.installs,
        tone: preview.installs > 0 ? 'success' : 'muted',
        icon: <Plus className="h-3.5 w-3.5" />,
      },
      {
        label: 'Will update',
        value: preview.refreshes,
        detail: 'already installed',
        tone: preview.refreshes > 0 ? 'success' : 'muted',
        icon: <RefreshCw className="h-3.5 w-3.5" />,
      },
      ...(preview.protectedSkips > 0 ? [{
        label: 'Locked kept',
        value: preview.protectedSkips,
        detail: 'left alone',
        tone: 'warning' as const,
        icon: <ShieldAlert className="h-3.5 w-3.5" />,
      }] : []),
      {
        label: 'Accounts',
        value: preview.rows.length,
        tone: 'muted' as const,
        icon: <Users className="h-3.5 w-3.5" />,
      },
    ]

  return (
    <div className="rounded-xl border border-border/40 bg-muted/20 p-3 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-foreground">
            {operation === 'remove' ? 'Before you remove' : 'Before you deploy'}
          </div>
          <div className="mt-0.5 text-muted-foreground">
            {operation === 'remove'
              ? 'Selected add-ons are removed where found. Locked add-ons stay.'
              : 'Selected add-ons are added where missing and updated where already installed.'}
          </div>
        </div>
        <div className="shrink-0 rounded-full border border-border/35 bg-background/60 px-2.5 py-1 font-semibold tabular-nums">
          {preview.rows.length} account{preview.rows.length !== 1 ? 's' : ''}
        </div>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {selectedAddons.slice(0, 8).map(addon => {
          const logo = addon.metadata?.customLogo || addon.manifest.logo
          return (
            <div key={addon.id} className="flex min-w-[150px] max-w-[190px] items-center gap-2 rounded-xl border border-border/25 bg-background/40 px-2.5 py-2">
              <AddonPreviewIcon name={addon.name} logo={logo} />
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">{addon.name}</div>
                <div className={cn(
                  "truncate text-[11px]",
                  operation === 'remove' ? "text-destructive" : "text-success"
                )}>
                  {operation === 'remove' ? 'Will remove if found' : 'Will add/update'}
                </div>
              </div>
            </div>
          )
        })}
        {selectedAddons.length > 8 && (
          <div className="flex min-w-20 items-center justify-center rounded-xl border border-border/25 bg-background/35 px-3 text-xs font-semibold text-muted-foreground">
            +{selectedAddons.length - 8} more
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {stats.map(stat => <PreviewStatCard key={stat.label} stat={stat} />)}
      </div>

      <div className="mt-3 max-h-28 space-y-1 overflow-y-auto pr-1">
        {preview.rows.map(row => (
          <div key={row.accountId} className="flex items-center justify-between gap-3 rounded-xl border border-border/25 bg-background/35 px-2.5 py-2">
            <div className="min-w-0 truncate font-medium">
              {row.accountEmoji && <span className="mr-1.5">{row.accountEmoji}</span>}
              {row.accountName}
            </div>
            <div className="shrink-0 text-muted-foreground">
              {operation === 'remove'
                ? `${row.removals} to remove${row.protectedSkips > 0 ? `, ${row.protectedSkips} locked` : ''}`
                : `${row.installs} to add, ${row.refreshes} to update`}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Estimate only. AIOManager checks each account again before changing anything.
      </div>
    </div>
  )
}
