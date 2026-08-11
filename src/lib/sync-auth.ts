export async function getSyncAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    try {
        const { useSyncStore } = await import('@/store/syncStore')
        const { deriveSyncToken } = await import('@/lib/crypto')
        const auth = useSyncStore.getState().auth
        if (auth.isAuthenticated) {
            headers['x-sync-user'] = auth.id
            headers['x-sync-password'] = await deriveSyncToken(auth.password)
        }
    } catch {}
    return headers
}

export function invalidateSyncAuthCache(): void {}
