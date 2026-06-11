export function triggerSync() {
    import('@/store/syncStore').then(({ useSyncStore }) =>
        useSyncStore.getState().syncToRemote(true)
    ).catch(e => { if (import.meta.env.DEV) console.error(e) })
}
