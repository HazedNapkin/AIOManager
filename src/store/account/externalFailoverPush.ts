import { type Account } from '@/types/account'
import { determineSourceOfTruth, fetchSoTAddons } from './externalAddonSync'
import { normalizeAddonUrl } from '@/lib/utils'
import type { AddonDescriptor } from '@/types/addon'
import { triggerSync } from '@/lib/sync-trigger'
import { getStremioAuthKey, getCachedAuthKey, getEncryptionKey } from '@/store/accountStore'

export async function backgroundSyncExternal(
    accountId: string,
    account: Account,
    updatedAddons: AddonDescriptor[],
    options?: { allowCollectionShrink?: boolean },
    _trigger = 'unknown',
    isAutopilot = false
) {
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
                
                // If autopilot turned ON an addon and it wasn't in sotAddons
                for (const [url, addon] of changedUrls.entries()) {
                    if (!finalSotAddons.some(sa => normalizeAddonUrl(sa.transportUrl) === url)) {
                        finalSotAddons.push(addon)
                    }
                }
                updatedAddons = finalSotAddons
            } catch (e) {
                console.warn('[ExternalFailoverPush] JIT fetch failed, falling back to pushing local state', e)
            }
        }
    }

    // Push updatedAddons to ALL connections (including SoT)
    const promises: Promise<void>[] = []

    const pushConnections = (account.connections || []).filter(c => c.enabled)
    const { triggerReconciliation } = await import('@/api/connection')
    if (pushConnections.length > 0) {
        promises.push(
            triggerReconciliation(accountId, account.primaryConnectionId, pushConnections, updatedAddons, {
                allowCollectionShrink: options?.allowCollectionShrink
            }).then(() => {}).catch(console.error)
        )
    }

    const stremioKey = getStremioAuthKey(account)
    if (stremioKey) {
        const { updateAddons } = await import('@/api/addons')
        promises.push(
            getCachedAuthKey(stremioKey, getEncryptionKey())
                .then(decryptedKey => updateAddons(decryptedKey, updatedAddons, accountId, {
                    previousCollection: account.addons,
                    allowCollectionShrink: options?.allowCollectionShrink
                }))
                .catch(console.error)
        )
    }

    await Promise.all(promises)

    triggerSync()
}
