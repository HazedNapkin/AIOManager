import type { Connection, NuvioPluginDescriptor } from '@/types/connection'

function toDescriptor(row: Record<string, unknown>, i: number): NuvioPluginDescriptor {
    return {
        url: String(row.url ?? ''),
        name: String(row.name ?? ''),
        enabled: row.enabled !== false,
        sort_order: Number(row.sort_order ?? i),
        repo_type: row.repo_type != null ? String(row.repo_type) : undefined,
    }
}

export async function readNuvioPlugins(accountId: string, conn: Connection): Promise<NuvioPluginDescriptor[]> {
    const { fetchConnectionToken } = await import('@/api/connection')
    const { nuvioDriverFor } = await import('@/lib/drivers/factory')
    const token = await fetchConnectionToken(accountId, conn.id, 'nuvio')
    const profileId = token.profileId ?? conn.credentials?.profileId
    const rows = await nuvioDriverFor(conn).readPlugins(token.accessToken, profileId)
    return (Array.isArray(rows) ? rows : []).map(toDescriptor).sort((a, b) => a.sort_order - b.sort_order)
}

// sync_push_plugins is full-replace: the list sent is the complete state. Edits are staged and
// pushed on save, so an explicit removal (including the last plugin) propagates, unlike the
// background addon sync which guards against empty pushes.
export async function writeNuvioPlugins(accountId: string, conn: Connection, plugins: NuvioPluginDescriptor[]): Promise<void> {
    const { fetchConnectionToken } = await import('@/api/connection')
    const { nuvioDriverFor } = await import('@/lib/drivers/factory')
    const token = await fetchConnectionToken(accountId, conn.id, 'nuvio')
    const profileId = token.profileId ?? conn.credentials?.profileId
    const ordered = plugins.map((p, i) => ({ ...p, sort_order: i }))
    await nuvioDriverFor(conn).writePlugins(token.accessToken, ordered, profileId)
}
