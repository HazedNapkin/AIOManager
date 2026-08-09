let lastServerEventPull = 0
const SERVER_PULL_THROTTLE_MS = 60_000

export function triggerSync() {
    import('@/store/syncStore').then(({ useSyncStore }) =>
        useSyncStore.getState().syncToRemote(true)
    ).catch(e => { if (import.meta.env?.DEV) console.error(e) })

    const now = Date.now()
    if (now - lastServerEventPull > SERVER_PULL_THROTTLE_MS) {
        lastServerEventPull = now
        import('@/lib/activity-server').then(m => m.fetchAndMergeServerEvents()).catch(() => {})
    }
}
