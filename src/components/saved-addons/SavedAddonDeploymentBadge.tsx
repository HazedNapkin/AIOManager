import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Account } from '@/types/account'
import { User } from 'lucide-react'
import { getAccountEmail } from '@/store/accountStore'

interface SavedAddonDeploymentBadgeProps {
  accounts: Account[]
  className?: string
}

function getAccountLabel(account: Account) {
  return account.name || getAccountEmail(account) || 'Unnamed account'
}

export function SavedAddonDeploymentBadge({
  accounts,
  className,
}: SavedAddonDeploymentBadgeProps) {
  if (accounts.length === 0) return null

  const extraCount = Math.max(0, accounts.length - 8)
  const visibleAccounts = accounts.slice(0, 3)
  const tooltipContent = (
    <div className="space-y-0.5 text-left">
      {accounts.slice(0, 8).map(account => (
        <div key={account.id}>{getAccountLabel(account)}</div>
      ))}
      {extraCount > 0 && <div>+{extraCount} more</div>}
    </div>
  )

  return (
    <Tooltip content={tooltipContent} side="top">
      <span
        className={cn(
          'inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border border-border/40 bg-muted/35 px-1.5 text-xs font-medium text-muted-foreground',
          className
        )}
      >
        <span className="flex -space-x-1 overflow-hidden">
          {visibleAccounts.map(account => (
            <span
              key={account.id}
              className="flex h-4 w-4 items-center justify-center rounded-full border border-background bg-background text-xs leading-none shadow-sm"
            >
              {account.emoji ? account.emoji : account.avatar ? <img src={account.avatar} alt="" className="h-full w-full rounded-full object-cover" /> : <User className="h-2.5 w-2.5 text-muted-foreground" />}
            </span>
          ))}
        </span>
        <span className="shrink-0 tabular-nums">
          {accounts.length}
        </span>
      </span>
    </Tooltip>
  )
}
