const STALE_MAX = 500
const inflight = new Map<string, Promise<unknown>>()
const staleValues = new Map<string, { value: unknown; ts: number }>()

export function deduped<T>(key: string, fn: () => Promise<T>): Promise<T>
export function deduped<T>(key: string, fn: () => Promise<T>, opts?: { onStale?: (stale: T) => void; staleTtlMs?: number }): Promise<T>
export function deduped<T>(key: string, fn: () => Promise<T>, opts?: { onStale?: (stale: T) => void; staleTtlMs?: number }): Promise<T> {
    const existing = inflight.get(key) as Promise<T> | undefined
    if (existing) return existing

    const promise = fn().then(
        (result) => {
            if (opts?.onStale && opts.staleTtlMs) {
                if (staleValues.size >= STALE_MAX) {
                    const oldest = staleValues.keys().next().value
                    if (oldest) staleValues.delete(oldest)
                }
                staleValues.set(key, { value: result, ts: Date.now() })
            }
            inflight.delete(key)
            return result
        },
        (err) => {
            inflight.delete(key)
            throw err
        }
    )

    inflight.set(key, promise)

    if (opts?.onStale && opts.staleTtlMs) {
        const stale = staleValues.get(key)
        if (stale && Date.now() - stale.ts < opts.staleTtlMs) {
            opts.onStale(stale.value as T)
        }
    }

    return promise
}

export function clearDedupe(key?: string): void {
    if (key) {
        inflight.delete(key)
        staleValues.delete(key)
    } else {
        inflight.clear()
        staleValues.clear()
    }
}

export function getStaleValue<T>(key: string): T | undefined {
    const stale = staleValues.get(key)
    if (stale) return stale.value as T
    return undefined
}