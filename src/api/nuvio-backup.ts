import { resilientFetch } from '@/lib/api-resilience'
import { useSyncStore, getSyncApiPath } from '@/store/syncStore'
import { deriveSyncToken } from '@/lib/crypto'

async function getAuthHeaders(): Promise<Record<string, string>> {
    const { auth } = useSyncStore.getState()
    if (!auth?.id || !auth?.password) throw new Error('Not authenticated')
    return {
        'Content-Type': 'application/json',
        'x-sync-user': auth.id,
        'x-sync-password': await deriveSyncToken(auth.password),
    }
}

export async function downloadNuvioBackup(accountId: string, connectionId: string): Promise<void> {
    const base = getSyncApiPath(useSyncStore.getState().serverUrl)
    const res = await resilientFetch(`${base}/providers/nuvio/backup-export`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ accountId, connectionId }),
        timeout: 30000,
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(body.error || `Backup download failed (${res.status})`)
    }

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const now = new Date()
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const a = document.createElement('a')
    a.href = url
    a.download = `nuvio-backup-${date}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}
