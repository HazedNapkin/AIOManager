import { normalizeAddonUrl } from '@/lib/utils'
import { filterResurrected } from '@/lib/addon-tombstones'
import type { Account } from '@/types/account'
import type { AddonDescriptor } from '@/types/addon'
import type { CinemetaManifest } from '@/types/cinemeta'

export interface DiscoveredEntry {
    transportUrl: string
    name: string
    enabled: boolean
    platform: string
    connectionId: string
}

export interface DiscoveryResult {
    discovered: DiscoveredEntry[]
    failedReadConnIds: Set<string>
}

function normalizeRawEntry(platform: string, raw: Record<string, unknown>): { url: string; name: string; enabled: boolean } | null {
    if (platform === 'nuvio') {
        const url = String(raw.url || '')
        if (!url) return null
        return { url, name: String(raw.name || ''), enabled: raw.enabled !== false }
    }
    if (platform === 'realstream') {
        const url = String(raw.manifestUrl || raw.baseUrl || '')
        if (!url) return null
        return { url, name: String(raw.name || ''), enabled: raw.enabled !== false }
    }
    return null
}

export async function discoverFromConnections(account: Account, accountId: string): Promise<DiscoveryResult> {
    const connections = (account.connections || []).filter(
        c => c.enabled && (c.platform === 'nuvio' || c.platform === 'realstream')
    )
    const failedReadConnIds = new Set<string>()
    if (connections.length === 0) return { discovered: [], failedReadConnIds }

    const existingUrls = new Set((account.addons || []).map(a => normalizeAddonUrl(a.transportUrl)))

    const { fetchConnectionToken } = await import('@/api/connection')
    const { nuvioDriverFor, realStreamDriverFor } = await import('@/lib/drivers/factory')

    const discovered: DiscoveredEntry[] = []

    for (const conn of connections) {
        try {
            let rawAddons: Record<string, unknown>[] = []

            if (conn.platform === 'nuvio') {
                const { getCachedNuvioToken, setCachedNuvioToken } = await import('@/lib/nuvio-token-cache')
                let token = getCachedNuvioToken(conn.id)
                if (!token) {
                    token = await fetchConnectionToken(accountId, conn.id, 'nuvio')
                    setCachedNuvioToken(conn.id, token)
                }
                const profileId = conn.credentials?.profileIndex || conn.credentials?.profileId
                rawAddons = await nuvioDriverFor(conn).readAddons(token.accessToken, profileId) as Record<string, unknown>[]
            } else {
                const token = await fetchConnectionToken(accountId, conn.id, 'realstream')
                const userId = conn.credentials?.userId || ''
                if (!userId) { failedReadConnIds.add(conn.id); continue }
                rawAddons = await realStreamDriverFor(conn).readAddons(token.accessToken, userId) as Record<string, unknown>[]
            }

            for (const raw of rawAddons || []) {
                const entry = normalizeRawEntry(conn.platform, raw)
                if (!entry) continue
                const normalizedUrl = normalizeAddonUrl(entry.url)
                if (existingUrls.has(normalizedUrl)) continue
                discovered.push({
                    transportUrl: entry.url,
                    name: entry.name,
                    enabled: entry.enabled,
                    platform: conn.platform,
                    connectionId: conn.id,
                })
                existingUrls.add(normalizedUrl)
            }
        } catch (err) {
            failedReadConnIds.add(conn.id)
            if (import.meta.env.DEV) console.warn(`[Discovery] read failed for ${conn.platform} (${conn.id}):`, err)
        }
    }

    return { discovered, failedReadConnIds }
}

export interface AbsorbResult {
    addons: AddonDescriptor[]
    failedReadConnIds: Set<string>
    changed: boolean
}

export async function absorbConnectionAddons(account: Account, accountId: string): Promise<AbsorbResult> {
    const { discovered: rawDiscovered, failedReadConnIds } = await discoverFromConnections(account, accountId)
    const existing = account.addons || []
    const discovered = filterResurrected(rawDiscovered, existing, account.deletedAddons)
    if (discovered.length === 0) return { addons: existing, failedReadConnIds, changed: false }

    const { fetchAddonManifest } = await import('@/api/addons')
    const { sanitizeAddonManifest } = await import('@/store/accountStore')
    const { getEffectiveManifest } = await import('@/lib/addon-utils')
    const { mergeAddons } = await import('@/lib/utils')
    const { isCinemetaAddon, detectAllPatches, applyCinemetaConfiguration } = await import('@/lib/cinemeta-utils')

    const newDescriptors: AddonDescriptor[] = await Promise.all(discovered.map(async (d) => {
        const base = { transportUrl: d.transportUrl, flags: { enabled: true }, metadata: { lastUpdated: Date.now() } }
        try {
            const { manifest } = await fetchAddonManifest(d.transportUrl, accountId)
            let repaired = sanitizeAddonManifest(manifest, d.transportUrl)
            const probe = { ...base, manifest: repaired } as AddonDescriptor
            if (isCinemetaAddon(probe)) {
                const patches = detectAllPatches(repaired as CinemetaManifest)
                if (patches.searchArtifactsPatched || patches.standardCatalogsPatched || patches.metaResourcePatched) {
                    repaired = applyCinemetaConfiguration(repaired as CinemetaManifest, {
                        removeSearchArtifacts: patches.searchArtifactsPatched,
                        removeStandardCatalogs: patches.standardCatalogsPatched,
                        removeMetaResource: patches.metaResourcePatched,
                    }) as AddonDescriptor['manifest']
                }
            }
            const descriptor = { ...base, manifest: repaired } as AddonDescriptor
            return { ...descriptor, manifest: getEffectiveManifest(descriptor) }
        } catch {
            return { ...base, manifest: sanitizeAddonManifest({ name: d.name } as AddonDescriptor['manifest'], d.transportUrl) } as AddonDescriptor
        }
    }))

    const surviving = newDescriptors
    if (surviving.length === 0) return { addons: existing, failedReadConnIds, changed: false }
    return { addons: mergeAddons(existing, surviving), failedReadConnIds, changed: true }
}

export function invalidateConnectionCache(connectionId?: string) {
    if (connectionId) {
        import('@/lib/nuvio-token-cache').then(({ invalidateNuvioToken }) => {
            invalidateNuvioToken(connectionId)
        }).catch(() => {})
    }
}
