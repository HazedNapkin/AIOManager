import { useAccountStore } from '@/store/accountStore'
import { useAuthStore } from '@/store/authStore'

const lastPrefetch = new Map<string, number>()
const inFlight = new Set<string>()
const PREFETCH_TTL_MS = 60_000

export function prefetchAccountDetail(accountId: string) {
    const auth = useAuthStore.getState()
    if (auth.isLocked || !auth.encryptionKey) return
    if (!useAccountStore.getState().accounts.some(account => account.id === accountId)) return
    if (inFlight.has(accountId)) return
    const now = Date.now()
    const previous = lastPrefetch.get(accountId)
    if (previous !== undefined && now - previous < PREFETCH_TTL_MS) return
    if (lastPrefetch.size >= 256) lastPrefetch.delete(lastPrefetch.keys().next().value!)
    lastPrefetch.set(accountId, now)
    inFlight.add(accountId)
    void useAccountStore.getState().syncAccount(accountId, false)
        .catch(() => {})
        .finally(() => { inFlight.delete(accountId) })
}
