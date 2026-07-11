import type { Account } from '@/types/account'
import type { AddonDescriptor } from '@/types/addon'


export function getStremioConnection(account: Account) {
    const conn = account.connections?.find(c => c.platform === 'stremio')
    if (conn) return conn
    if (!account.authKey || account.authKey.length <= 60) return null
    return {
        id: `${account.id}:stremio`,
        platform: 'stremio',
        connectionType: 'native' as const,
        enabled: true,
        status: account.status,
        credentials: {
            authKey: account.authKey,
            ...(account.email ? { email: account.email } : {}),
        },
        lastSync: 0,
        lastKnownAddonCount: 0,
        capabilities: ['addons'],
        consecutiveFailures: 0,
    }
}

export function getStremioAuthKey(account: Account): string {
    return getStremioConnection(account)?.credentials?.authKey || ''
}

export function getAccountEmail(account: Account): string | undefined {
    return getStremioConnection(account)?.credentials?.email || account.email
}

export async function pushAddonsToPlatform(account: Account, addons: AddonDescriptor[], accountId: string, options?: { allowCollectionShrink?: boolean; previousCollection?: AddonDescriptor[] }): Promise<void> {
    const context = options?.allowCollectionShrink ? 'Clear All' : accountId
    const stremioKey = getStremioAuthKey(account)
    if (stremioKey) {
        const { getCachedAuthKey, getEncryptionKey } = await import('@/store/accountStore')
        const { updateAddons } = await import('@/api/addons')
        const authKey = await getCachedAuthKey(stremioKey, getEncryptionKey())
        await updateAddons(authKey, addons, context, options)
    }
    const hasNonStremio = (account.connections || []).some(c => c.enabled && (c.connectionType === 'hydra-outbound' || c.platform !== 'stremio'))
    if (hasNonStremio) {
        const { pushToConnections } = await import('@/store/account/accountAddonOps')
        await pushToConnections(account.id, { addons, allowCollectionShrink: options?.allowCollectionShrink })
    }
}
