export interface SyncioUser {
    username?: string
    email?: string
    stremioAuthKey?: string | null
    isActive?: boolean
    colorIndex?: number | null
}

export interface SyncioAddon {
    name?: string
    manifestUrl?: string
    originalManifest?: Record<string, unknown>
    isActive?: boolean
    resources?: string[]
}

export interface SyncioExport {
    users?: SyncioUser[]
    addons?: SyncioAddon[]
    groups?: unknown[]
    sync?: unknown
}

export interface ParsedSyncioAccount {
    email: string
    authKey: string
    name: string
    colorIndex?: number
}

export interface SyncioImportResult {
    accounts: ParsedSyncioAccount[]
    addons: Array<{ name: string; transportUrl: string }>
    skipped: number
}

export function isSyncioExport(data: unknown): boolean {
    if (typeof data !== 'object' || data === null) return false
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.data)) return false
    if (obj.data && typeof obj.data === 'object') {
        const inner = obj.data as Record<string, unknown>
        return Array.isArray(inner.users) || Array.isArray(inner.addons)
    }
    return Array.isArray(obj.users) || Array.isArray(obj.addons)
}

export function parseSyncioExport(raw: unknown): SyncioImportResult {
    const data = (() => {
        if (typeof raw !== 'object' || raw === null) return {} as SyncioExport
        const obj = raw as Record<string, unknown>
        if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
            return obj.data as SyncioExport
        }
        return raw as SyncioExport
    })()

    const users = Array.isArray(data.users) ? data.users : []
    const addons = Array.isArray(data.addons) ? data.addons : []

    const accounts: ParsedSyncioAccount[] = []
    let skipped = 0

    for (const user of users) {
        if (!user.stremioAuthKey || typeof user.stremioAuthKey !== 'string') {
            skipped++
            continue
        }
        accounts.push({
            email: user.email || user.username || '',
            authKey: user.stremioAuthKey,
            name: user.username || user.email?.split('@')[0] || 'Imported Account',
            colorIndex: typeof user.colorIndex === 'number' ? user.colorIndex : undefined,
        })
    }

    const parsedAddons = addons
        .filter(a => a.manifestUrl && typeof a.manifestUrl === 'string')
        .map(a => ({
            name: a.name || a.originalManifest?.name as string || 'Unknown Addon',
            transportUrl: a.manifestUrl!,
        }))

    return { accounts, addons: parsedAddons, skipped }
}
