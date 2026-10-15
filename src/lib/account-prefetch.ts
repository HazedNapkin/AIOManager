import { useAccountStore } from '@/store/accountStore'
import { useAuthStore } from '@/store/authStore'

let detailPagePromise: Promise<unknown> | null = null

export function prefetchAccountDetail(accountId: string) {
    const auth = useAuthStore.getState()
    if (auth.isLocked || !auth.encryptionKey) return
    if (!useAccountStore.getState().accounts.some(account => account.id === accountId)) return
    if (detailPagePromise) return
    // Hover only warms route code. A real account sync can publish loading and
    // error state, discover connections, and write back to streaming platforms.
    detailPagePromise = import('@/pages/AccountDetailPage').catch(() => {
        detailPagePromise = null
    })
}
