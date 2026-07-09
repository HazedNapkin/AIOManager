import type { Account } from '@/types/account'
import type { AddonDescriptor } from '@/types/addon'


export function getStremioConnection(account: Account) {
    return account.connections?.find(c => c.platform === 'stremio') || null
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
