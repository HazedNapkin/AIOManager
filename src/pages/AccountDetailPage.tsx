import { useParams, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { AddonList } from '@/components/addons/AddonList'
import { useAccountStore } from '@/store/accountStore'
import { useDocumentTitle } from '@/hooks/use-document-title'

export function AccountDetailPage() {
  const { accountId } = useParams<{ accountId: string }>()
  const navigate = useNavigate()
  const accounts = useAccountStore((state) => state.accounts)
  const account = accounts.find((acc) => acc.id === accountId)

  useDocumentTitle(account?.name || 'Account')

  useEffect(() => {
    if (accountId) {
      const account = accounts.find((acc) => acc.id === accountId)
      if (!account) {
        navigate('/', { replace: true })
      }
    }
  }, [accountId, accounts, navigate])

  if (!accountId) {
    navigate('/', { replace: true })
    return null
  }

  return (
    <div className="space-y-6">
      <AddonList accountId={accountId} />
    </div>
  )
}
