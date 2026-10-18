import { Tooltip } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn, maskEmailLevel, maskNameLevel } from '@/lib/utils'
import type { Account } from '@/types/account'
import { User } from 'lucide-react'
import { getAccountEmail } from '@/store/accountStore'
import { useUIStore } from '@/store/uiStore'
import { useShallow } from 'zustand/react/shallow'

interface SavedAddonDeploymentBadgeProps {
  accounts: Account[]
  className?: string
}

export function SavedAddonDeploymentBadge({
  accounts,
  className,
}: SavedAddonDeploymentBadgeProps) {
  const { isPrivacyModeEnabled, privacyLevelNames, privacyLevelEmail } = useUIStore(useShallow(s => ({
    isPrivacyModeEnabled: s.isPrivacyModeEnabled,
    privacyLevelNames: s.privacyLevelNames,
    privacyLevelEmail: s.privacyLevelEmail,
  })))
  const namePrivacy = isPrivacyModeEnabled ? privacyLevelNames : 0
  const emailPrivacy = isPrivacyModeEnabled ? privacyLevelEmail : 0

  if (accounts.length === 0) return null

  // Masked exactly like the account surfaces, and in every user-visible string:
  // tooltip, popover rows and the aria label. Names use the names level; email-shaped
  // labels use the email level. Tokens are never shown.
  const getAccountLabel = (account: Account) => {
    const raw = account.name || getAccountEmail(account) || 'Unnamed account'
    return raw.includes('@') ? maskEmailLevel(raw, emailPrivacy) : maskNameLevel(raw, namePrivacy)
  }

  const extraCount = Math.max(0, accounts.length - 8)
  const hoverText = accounts.length === 1
    ? `In ${getAccountLabel(accounts[0])}'s synced addon list`
    : `In ${accounts.length} accounts' synced addon lists`

  return (
    <Popover>
      <Tooltip content={hoverText} side="top">
        <PopoverTrigger asChild>
          {/* Real button so keyboard activation works natively; click/keys stop
              propagating so the surrounding card/row never opens. */}
          <button
            type="button"
            data-theme-part="badge"
            aria-label={`${hoverText}. Details`}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className={cn(
              'inline-flex h-6 max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-border/40 bg-muted/35 px-1.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/40',
              className
            )}
          >
            <span className="flex -space-x-1 overflow-hidden">
              {accounts.slice(0, 3).map(account => (
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
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="top" className="w-64 p-3 text-left">
        <p className="text-xs font-semibold text-foreground">Installed accounts</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Accounts whose last synced addon list contains this exact configured URL. An account
          not shown may simply not have synced yet.
        </p>
        <div className="mt-2 space-y-0.5">
          {accounts.slice(0, 8).map(account => (
            <div key={account.id} className="truncate text-xs text-foreground/90">{getAccountLabel(account)}</div>
          ))}
          {extraCount > 0 && <div className="text-xs text-muted-foreground">+{extraCount} more</div>}
        </div>
      </PopoverContent>
    </Popover>
  )
}
