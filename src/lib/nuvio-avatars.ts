export interface NuvioAvatar {
    id: string
    displayName: string
    storagePath: string
    category?: string
    bgColor?: string
}

interface CataloguedAvatar {
    avatar: NuvioAvatar
    sortOrder: number
}

export function mapAvatarRows(rows: unknown): NuvioAvatar[] {
    if (!Array.isArray(rows)) return []
    const catalogued: CataloguedAvatar[] = []
    for (const raw of rows) {
        if (raw === null || typeof raw !== 'object') continue
        const row = raw as Record<string, unknown>
        if (row.is_active === false) continue
        const id = typeof row.id === 'number' ? String(row.id) : typeof row.id === 'string' ? row.id : ''
        if (!id) continue
        const sortOrder = Number(row.sort_order)
        catalogued.push({
            avatar: {
                id,
                displayName: typeof row.display_name === 'string' ? row.display_name : '',
                storagePath: typeof row.storage_path === 'string' ? row.storage_path : '',
                category: typeof row.category === 'string' ? row.category : undefined,
                bgColor: typeof row.bg_color === 'string' ? row.bg_color : undefined,
            },
            sortOrder: Number.isFinite(sortOrder) ? sortOrder : Number.MAX_SAFE_INTEGER,
        })
    }
    return catalogued
        .sort((a, b) => a.sortOrder - b.sortOrder || a.avatar.displayName.localeCompare(b.avatar.displayName))
        .map(e => e.avatar)
}

export function avatarImageUrl(baseUrl: string, storagePath: string): string {
    const base = (baseUrl || '').trim().replace(/\/+$/, '')
    const path = (storagePath || '').trim().replace(/^\/+/, '')
    return `${base}/storage/v1/object/public/avatars/${path}`
}
