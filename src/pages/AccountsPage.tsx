import { AccountList } from '@/components/accounts/AccountList'
import { useDocumentTitle } from '@/hooks/use-document-title'

export function AccountsPage() {
  useDocumentTitle('Accounts')
  return <AccountList />
}
