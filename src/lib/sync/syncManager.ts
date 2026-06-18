/**
 * SyncManager
 * Manages pending operations to prevent race conditions during synchronization.
 * Specifically helps avoid "Zombie Addons" by tracking deletions.
 */

export type OperationType = 'remove' | 'add' | 'update'

export interface PendingOperation {
    accountId: string
    targetId: string
    type: OperationType
    timestamp: number
}

class SyncManager {
    private pendingRemovals: Map<string, Map<string, number>> = new Map()
    private observers: Set<() => void> = new Set()

    private static TTL_MS = 24 * 60 * 60 * 1000

    private evictExpired(accountId: string) {
        const map = this.pendingRemovals.get(accountId)
        if (!map) return
        const now = Date.now()
        for (const [url, ts] of map) {
            if (now - ts > SyncManager.TTL_MS) {
                map.delete(url)
            }
        }
        if (map.size === 0) this.pendingRemovals.delete(accountId)
    }

    addPendingRemoval(accountId: string, transportUrl: string) {
        this.evictExpired(accountId)
        if (!this.pendingRemovals.has(accountId)) {
            this.pendingRemovals.set(accountId, new Map())
        }
        this.pendingRemovals.get(accountId)!.set(transportUrl.toLowerCase(), Date.now())
        this.notify()
    }

    removePendingRemoval(accountId: string, transportUrl: string) {
        const map = this.pendingRemovals.get(accountId)
        if (map) {
            map.delete(transportUrl.toLowerCase())
            if (map.size === 0) this.pendingRemovals.delete(accountId)
            this.notify()
        }
    }

    isPendingRemoval(accountId: string, transportUrl: string): boolean {
        this.evictExpired(accountId)
        const map = this.pendingRemovals.get(accountId)
        return map ? map.has(transportUrl.toLowerCase()) : false
    }

    clearAccount(accountId: string) {
        this.pendingRemovals.delete(accountId)
        this.notify()
    }

    subscribe(callback: () => void) {
        this.observers.add(callback)
        return () => this.observers.delete(callback)
    }

    private notify() {
        this.observers.forEach(cb => cb())
    }
}

export const syncManager = new SyncManager()
