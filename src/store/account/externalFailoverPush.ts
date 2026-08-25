import { type Account } from '@/types/account'
import { getAccountById, persistAccounts } from '@/store/accountStore'
import { determineSourceOfTruth, fetchSoTAddons } from './externalAddonSync'
import { normalizeAddonUrl } from '@/lib/utils'
import type { AddonDescriptor } from '@/types/addon'
import { triggerSync } from '@/lib/sync-trigger'
import { getStremioAuthKey, getCachedAuthKey, getEncryptionKey } from '@/store/accountStore'
import { reconcileTombstones } from '@/lib/addon-tombstones'
import type { AccountStore } from '@/store/accountStore'
import { useAuthStore } from '@/store/authStore'

type StoreRef = { getState: () => AccountStore; setState: (partial: Partial<AccountStore> | ((state: AccountStore) => Partial<AccountStore>)) => void }

async function getStore(): Promise<StoreRef> {
    const { useAccountStore } = await import('@/store/accountStore')
    return useAccountStore
}

export async function backgroundSyncExternal(accountId: string, account: Account, updatedAddons: AddonDescriptor[], options?: { allowCollectionShrink?: boolean }, trigger = 'unknown', isAutopilot = false) {
    const store = await getStore()

    if (isAutopilot) {
        // JIT Fetch-Patch-Push strategy
        const sot = determineSourceOfTruth(account)
        if (sot) {
            try {
                const sotAddons = await fetchSoTAddons(account, sot, true)
                // Patch the missing/added ones based on updatedAddons
                
                // We know 'updatedAddons' is the AIOManager list after the autopilot toggle.
                // We just need to find the diff (the addon that was toggled) and apply it to 'sotAddons'.
                
                const before = account.addons
                const after = updatedAddons
                
                // Find what changed
                const changedUrls = new Map<string, AddonDescriptor>()
                for (const a of after) {
                    const b = before.find(x => normalizeAddonUrl(x.transportUrl) === normalizeAddonUrl(a.transportUrl))
                    if (!b || b.flags?.enabled !== a.flags?.enabled) {
                        changedUrls.set(normalizeAddonUrl(a.transportUrl), a)
                    }
                }
                
                // Patch sotAddons
                const finalSotAddons = sotAddons.map(sa => {
                    const changed = changedUrls.get(normalizeAddonUrl(sa.transportUrl))
                    if (changed) {
                        return { ...sa, flags: changed.flags }
                    }
                    return sa
                })
                
                updatedAddons = finalSotAddons
                
                // Wait, if autopilot turned ON an addon, and it wasn't in sotAddons?
                for (const [url, addon] of changedUrls.entries()) {
                    if (!finalSotAddons.some(sa => normalizeAddonUrl(sa.transportUrl) === url)) {
                        // Insert using anchor? For autopilot it just enables/disables. If it enables an addon not in SoT, just push it.
                        finalSotAddons.push(addon)
                    }
                }
                updatedAddons = finalSotAddons
            } catch (e) {
                console.warn('[ExternalFailoverPush] JIT fetch failed, falling back to pushing local state', e)
            }
        }
    }

    // Now push updatedAddons to ALL connections (including SoT!)
    const promises: Promise<void>[] = []
    
    const sot = determineSourceOfTruth(account)

    const pushConnections = (account.connections || []).filter(c => c.enabled)
    const { triggerReconciliation } = await import('@/api/connection')
    if (pushConnections.length > 0) {
        promises.push(triggerReconciliation(accountId, account.primaryConnectionId, pushConnections, updatedAddons).then(() => {}).catch(console.error))
    }

    const stremioKey = getStremioAuthKey(account)
    if (stremioKey) {
        const { updateAddons } = await import('@/api/addons')
        promises.push(
            getCachedAuthKey(stremioKey, getEncryptionKey())
                .then(decryptedKey => updateAddons(decryptedKey, updatedAddons, accountId, { previousCollection: account.addons }))
                .catch(console.error)
        )
    }

    await Promise.all(promises)

    triggerSync()
}
