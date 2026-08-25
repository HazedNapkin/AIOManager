import { type Account } from '@/types/account'
import { type Connection } from '@/types/connection'
import { getStremioAuthKey, getCachedAuthKey, getEncryptionKey, getAccountById, persistAccounts, sanitizeAddonManifest } from '@/store/accountStore'
import { getAddons } from '@/api/addons'
import { fetchConnectionToken } from '@/api/connection'
import { nuvioDriverFor, realStreamDriverFor } from '@/lib/drivers/factory'
import type { AddonDescriptor } from '@/types/addon'
import { normalizeAddonUrl } from '@/lib/utils'
import { reconcileTombstones } from '@/lib/addon-tombstones'
import { fetchAddonManifest } from '@/api/addons'
import { getEffectiveManifest } from '@/lib/addon-utils'
import type { AccountStore } from '@/store/accountStore'
import { useAuthStore } from '@/store/authStore'

type StoreRef = { getState: () => AccountStore; setState: (partial: Partial<AccountStore> | ((state: AccountStore) => Partial<AccountStore>)) => void }

async function getStore(): Promise<StoreRef> {
    const { useAccountStore } = await import('@/store/accountStore')
    return useAccountStore
}

export type SoT = { type: 'stremio-native' } | { type: 'connection'; conn: Connection }

export function determineSourceOfTruth(account: Account): SoT | null {
    const nuvioConn = account.connections?.find(c => c.enabled && c.platform === 'nuvio')
    if (nuvioConn) return { type: 'connection', conn: nuvioConn }
    
    const stremioConn = account.connections?.find(c => c.enabled && c.platform === 'stremio')
    if (stremioConn) return { type: 'connection', conn: stremioConn }
    
    if (getStremioAuthKey(account)) return { type: 'stremio-native' }
    
    const otherConn = account.connections?.find(c => c.enabled)
    if (otherConn) return { type: 'connection', conn: otherConn }
    
    return null
}

export async function fetchSoTAddons(account: Account, sot: SoT, forceRefresh: boolean): Promise<AddonDescriptor[]> {
    if (sot.type === 'stremio-native' || (sot.type === 'connection' && sot.conn.platform === 'stremio')) {
        const authKey = getStremioAuthKey(account)
        if (!authKey) throw new Error('No Stremio auth key')
        const decryptedKey = await getCachedAuthKey(authKey, getEncryptionKey())
        return getAddons(decryptedKey, account.id, forceRefresh)
    } else {
        const conn = sot.conn
        if (conn.platform === 'nuvio') {
            const { getCachedNuvioToken, setCachedNuvioToken } = await import('@/lib/nuvio-token-cache')
            let token = getCachedNuvioToken(conn.id)
            if (!token) {
                token = await fetchConnectionToken(account.id, conn.id, 'nuvio')
                setCachedNuvioToken(conn.id, token)
            }
            const profileId = conn.credentials?.profileIndex || conn.credentials?.profileId
            const rawAddons = await nuvioDriverFor(conn).readAddons(token.accessToken, profileId) as Record<string, unknown>[]
            return rawAddons.map(r => ({
                transportUrl: String(r.url || ''),
                manifest: sanitizeAddonManifest({ name: String(r.name || '') } as any, String(r.url || '')),
                flags: { enabled: r.enabled !== false }
            })) as AddonDescriptor[]
        } else if (conn.platform === 'realstream') {
            const token = await fetchConnectionToken(account.id, conn.id, 'realstream')
            const userId = conn.credentials?.userId || ''
            const rawAddons = await realStreamDriverFor(conn).readAddons(token.accessToken, userId) as Record<string, unknown>[]
            return rawAddons.map(r => ({
                transportUrl: String(r.manifestUrl || r.baseUrl || ''),
                manifest: sanitizeAddonManifest({ name: String(r.name || '') } as any, String(r.manifestUrl || r.baseUrl || '')),
                flags: { enabled: r.enabled !== false }
            })) as AddonDescriptor[]
        }
        throw new Error(Unsupported SoT platform: )
    }
}

function mergeWithReAnchoring(localAddons: AddonDescriptor[], sotAddons: AddonDescriptor[]): AddonDescriptor[] {
    const sotList = [...sotAddons]
    const disabledAnchors = new Map<string, AddonDescriptor[]>()
    let currentAnchor = ''

    for (const a of localAddons) {
        if (a.flags?.enabled === false) {
            const list = disabledAnchors.get(currentAnchor) || []
            list.push(a)
            disabledAnchors.set(currentAnchor, list)
        } else {
            currentAnchor = normalizeAddonUrl(a.transportUrl)
        }
    }

    const result: AddonDescriptor[] = []
    
    if (disabledAnchors.has('')) {
        const toAdd = disabledAnchors.get('')!
        for (const a of toAdd) {
            if (!sotList.some(s => normalizeAddonUrl(s.transportUrl) === normalizeAddonUrl(a.transportUrl))) {
                result.push(a)
            }
        }
    }

    for (const sa of sotList) {
        const existingLocal = localAddons.find(l => normalizeAddonUrl(l.transportUrl) === normalizeAddonUrl(sa.transportUrl))
        if (existingLocal) {
             result.push({ ...existingLocal, flags: sa.flags })
        } else {
             result.push(sa)
        }
        
        const anchorUrl = normalizeAddonUrl(sa.transportUrl)
        if (disabledAnchors.has(anchorUrl)) {
            const toAdd = disabledAnchors.get(anchorUrl)!
            for (const a of toAdd) {
                if (!sotList.some(s => normalizeAddonUrl(s.transportUrl) === normalizeAddonUrl(a.transportUrl))) {
                    result.push(a)
                }
            }
        }
    }

    return result
}

const phantomDebounceCache = new Map<string, { missingUrls: string[], timestamp: number }>()

export async function syncExternalAddonManagement(id: string, forceRefresh: boolean): Promise<{ changed: boolean, authKeyRefreshed: boolean }> {
    const store = await getStore()
    const account = getAccountById(store.getState().accounts, id)
    if (!account) throw new Error('Account not found')

    const sot = determineSourceOfTruth(account)
    if (!sot) {
        return { changed: false, authKeyRefreshed: false }
    }

    const sotAddons = await fetchSoTAddons(account, sot, forceRefresh)
    
    if (sotAddons.length === 0) {
        console.warn('[ExternalAddonSync] SoT returned empty list. Safeguard triggered, aborting sync.')
        return { changed: false, authKeyRefreshed: false }
    }

    const localUrls = new Set(account.addons.map(a => normalizeAddonUrl(a.transportUrl)))
    const sotUrls = new Set(sotAddons.map(a => normalizeAddonUrl(a.transportUrl)))

    const missingUrls = [...localUrls].filter(url => !sotUrls.has(url))
    
    if (missingUrls.length > 0) {
        const cache = phantomDebounceCache.get(id)
        const now = Date.now()
        if (!cache || (now - cache.timestamp > 5000)) {
            phantomDebounceCache.set(id, { missingUrls, timestamp: now })
            await new Promise(r => setTimeout(r, 5000))
            const reFetched = await fetchSoTAddons(account, sot, forceRefresh)
            if (reFetched.length === 0) {
                return { changed: false, authKeyRefreshed: false }
            }
            
            const reFetchedUrls = new Set(reFetched.map(a => normalizeAddonUrl(a.transportUrl)))
            const stillMissing = missingUrls.filter(url => !reFetchedUrls.has(url))
            
            if (stillMissing.length === 0) {
                sotAddons.splice(0, sotAddons.length, ...reFetched)
            } else {
                sotAddons.splice(0, sotAddons.length, ...reFetched)
            }
        }
    }
    
    phantomDebounceCache.delete(id)
    
    // Fetch manifests for new addons
    for (let i = 0; i < sotAddons.length; i++) {
        if (!localUrls.has(normalizeAddonUrl(sotAddons[i].transportUrl))) {
            try {
                const { manifest } = await fetchAddonManifest(sotAddons[i].transportUrl, id)
                sotAddons[i].manifest = sanitizeAddonManifest(manifest, sotAddons[i].transportUrl)
                sotAddons[i] = { ...sotAddons[i], manifest: getEffectiveManifest(sotAddons[i]) }
            } catch (e) {
                console.warn('[ExternalAddonSync] Failed to fetch manifest for new addon', e)
            }
        }
    }
    
    const finalAddons = mergeWithReAnchoring(account.addons, sotAddons)
    
    const { fingerprintAddonList } = await import('@/lib/addon-fingerprint')
    const addonsChanged = fingerprintAddonList(account.addons) !== fingerprintAddonList(finalAddons)
    
    if (!addonsChanged) {
        return { changed: false, authKeyRefreshed: false }
    }
    
    const updatedAccount = {
        ...account,
        addons: finalAddons,
        deletedAddons: reconcileTombstones(account.deletedAddons, finalAddons),
        lastSync: new Date()
    }
    
    const accounts = store.getState().accounts.map((acc) => (acc.id === id ? updatedAccount : acc))
    store.setState({ accounts })
    persistAccounts(accounts)
    
    const { useAddonStore } = await import('@/store/addonStore')
    await useAddonStore.getState().syncAccountState(id, getStremioAuthKey(updatedAccount), finalAddons).catch(e => { console.error(e) })
    
    if (!useAuthStore.getState().encryptionKey) return { changed: true, authKeyRefreshed: false }
    
    const pushConnections = (updatedAccount.connections || []).filter(c => {
        if (sot.type === 'connection' && c.id === sot.conn.id) return false
        if (sot.type === 'stremio-native' && c.platform === 'stremio') return false
        return c.enabled
    })
    
    const { triggerReconciliation } = await import('@/api/connection')
    if (pushConnections.length > 0) {
        try {
            await triggerReconciliation(id, updatedAccount.primaryConnectionId, pushConnections, finalAddons)
        } catch (e) {
            console.warn('[ExternalAddonSync] Push to other connections failed', e)
        }
    }
    
    if (sot.type !== 'stremio-native' && !(sot.type === 'connection' && sot.conn.platform === 'stremio')) {
        const stremioKey = getStremioAuthKey(updatedAccount)
        if (stremioKey) {
            try {
                const { updateAddons } = await import('@/api/addons')
                const decryptedKey = await getCachedAuthKey(stremioKey, getEncryptionKey())
                await updateAddons(decryptedKey, finalAddons, id, { previousCollection: account.addons })
            } catch (e) {
                console.warn('[ExternalAddonSync] Push to Stremio failed', e)
            }
        }
    }
    
    return { changed: true, authKeyRefreshed: false }
}
