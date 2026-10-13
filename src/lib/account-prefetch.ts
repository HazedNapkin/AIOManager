// Hover prefetch: warm an account's sync cache while the cursor is over its
// card, so the click lands on already-fresh data. One network touch per account
// per TTL window; failures are swallowed (prefetch must never surface errors).
import { useAccountStore } from '@/store/accountStore'

const lastPrefetch = new Map<string, number>()
const PREFETCH_TTL_MS = 60_000

export function prefetchAccountDetail(accountId: string) {
    const now = Date.now()
    if (now - (lastPrefetch.get(accountId) || 0) < PREFETCH_TTL_MS) return
    lastPrefetch.set(accountId, now)
    void useAccountStore.getState().syncAccount(accountId, false).catch(() => {})
}
