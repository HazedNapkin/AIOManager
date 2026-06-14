import { useAccountStore } from '@/store/accountStore'

export function useAccounts() {
  const accounts = useAccountStore((state) => state.accounts)
  const loading = useAccountStore((state) => state.loadingAccounts.size > 0)
  const error = useAccountStore((state) => state.error)

  const addAccountByAuthKey = useAccountStore((state) => state.addAccountByAuthKey)
  const addAccountByCredentials = useAccountStore((state) => state.addAccountByCredentials)
  const addLocalAccount = useAccountStore((state) => state.addLocalAccount)
  const removeAccount = useAccountStore((state) => state.removeAccount)
  const syncAccount = useAccountStore((state) => state.syncAccount)
  const syncAllAccounts = useAccountStore((state) => state.syncAllAccounts)
  const clearError = useAccountStore((state) => state.clearError)

  return {
    accounts,
    loading,
    error,
    addAccountByAuthKey,
    addAccountByCredentials,
    addLocalAccount,
    removeAccount,
    syncAccount,
    syncAllAccounts,
    repairAccount: useAccountStore((state) => state.repairAccount),
    updateAccount: useAccountStore((state) => state.updateAccount),
    reorderAccounts: useAccountStore((state) => state.reorderAccounts),
    clearError,
  }
}
