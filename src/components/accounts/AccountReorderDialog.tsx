import { ReorderDialog } from '@/components/ui/reorder-dialog'
import { Account } from '@/types/account'
import { AccountReorderRow, SortableAccountCard } from './SortableAccountCard'
import { useAccounts } from '@/hooks/useAccounts'

interface AccountReorderDialogProps {
  accounts: Account[]
  open: boolean
  onOpenChange: (open: boolean) => void
  isPrivacyMode?: boolean
}

export function AccountReorderDialog({
  accounts,
  open,
  onOpenChange,
  isPrivacyMode = false,
}: AccountReorderDialogProps) {
  const { reorderAccounts } = useAccounts()

  return (
    <ReorderDialog<Account>
      title="Reorder Accounts"
      description="Drag accounts to change their order. Save to apply."
      items={accounts}
      getId={(account) => account.id}
      renderRow={(account) => (
        <SortableAccountCard
          account={account}
          isPrivacyMode={isPrivacyMode}
          compact
        />
      )}
      renderOverlay={(account) => (
        <AccountReorderRow account={account} isPrivacyMode={isPrivacyMode} isOverlay />
      )}
      onSave={(ordered) => reorderAccounts(ordered.map((a) => a.id))}
      saveErrorMessage="Failed to save account order"
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="max-w-2xl max-h-[90vh] sm:max-h-[85vh] flex flex-col"
      bodyClassName="flex-1 overflow-y-auto py-2 sm:py-4"
    />
  )
}
