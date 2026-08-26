import { useAccountStore, persistAccounts } from '@/store/accountStore'
import { triggerSync } from '@/lib/sync-trigger'
import { toast } from '@/hooks/use-toast'

// Shared API key mutations for the Connections tab and the Settings section

function setAccountApiKey(accountId: string, newKey: string) {
    const { accounts } = useAccountStore.getState()
    const updated = accounts.map(a =>
        a.id === accountId ? { ...a, apiKey: newKey } : a
    )
    useAccountStore.setState({ accounts: updated })
    persistAccounts(updated)
    triggerSync()
}

export function generateAccountApiKey(accountId: string): void {
    setAccountApiKey(accountId, crypto.randomUUID())
    toast({ title: 'API key created', description: 'Use it with your AIOManager URL to connect external services via the Hydra API.' })
}

export function regenerateAccountApiKey(accountId: string): void {
    setAccountApiKey(accountId, crypto.randomUUID())
    toast({ title: 'API key regenerated', description: 'Update any services using the old key.' })
}
