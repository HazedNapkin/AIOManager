// Consecutive-failure circuit breaker for per-account library fetches.
//
// The trace mining across 31k scanAccount rows: p50 199ms, but a dead or dying
// platform pins its fetch at the full ACTIVITY_FETCH_TIMEOUT_MS (10s walls, 50x
// a healthy scan), serially, EVERY cycle - the cycle is a 5-minute timer, so a
// dead platform never gets cheaper on its own. The breaker skips accounts whose
// fetch keeps failing, with exponential backoff per consecutive failure, and a
// single success clears the record entirely.

export function createFailureBreaker({
    threshold = 2,
    baseMs = 5 * 60_000,
    maxMs = 60 * 60_000,
    now = () => Date.now(),
    maxEntries = 10_000,
} = {}) {
    // { failures: number, until: number, lastFailureAt: number }
    const entries = new Map()
    const enabled = baseMs > 0 && threshold > 0 && maxMs > 0

    const prune = () => {
        if (entries.size <= maxEntries) return
        const sorted = [...entries.entries()].sort((a, b) => a[1].lastFailureAt - b[1].lastFailureAt)
        const overflow = sorted.length - maxEntries
        for (let i = 0; i < overflow; i++) entries.delete(sorted[i][0])
    }

    return {
        recordFailure(key) {
            if (!enabled) return
            const prev = entries.get(key)
            const failures = (prev?.failures ?? 0) + 1
            const until = failures >= threshold
                ? now() + Math.min(maxMs, baseMs * Math.pow(2, failures - threshold))
                : 0
            entries.set(key, { failures, until, lastFailureAt: now() })
            prune()
        },

        recordSuccess(key) {
            entries.delete(key)
        },

        // { skip, failures } | null (null = unknown key, never failed)
        shouldSkip(key) {
            if (!enabled) return null
            const entry = entries.get(key)
            if (!entry) return null
            if (entry.until > now()) return { skip: true, failures: entry.failures, until: entry.until }
            return { skip: false, failures: entry.failures, until: entry.until }
        },

        isTripped(key) {
            const s = this.shouldSkip(key)
            return Boolean(s?.skip)
        },

        size() {
            return entries.size
        },
    }
}
