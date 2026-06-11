import type { Connection } from '@/types/connection'
import type { createNuvioDriver } from '@/lib/drivers/nuvio'

type NuvioDriver = ReturnType<typeof createNuvioDriver>

export interface NuvioLibraryItem {
    content_id: string
    content_type?: string
    name?: string
    poster?: string
    poster_shape?: string
    background?: string
    description?: string
    release_info?: string
    imdb_rating?: string | number
    genres?: string[]
    addon_base_url?: string
    added_at?: number
}

export interface NuvioCollection {
    id?: string
    title?: string
    backdropImageUrl?: string
    pinToTop?: boolean
    viewMode?: string
    showAllTab?: boolean
    folders?: Array<Record<string, unknown>>
}

async function withNuvio<T>(
    accountId: string,
    conn: Connection,
    fn: (driver: NuvioDriver, accessToken: string, profileId?: string | number) => Promise<T>,
): Promise<T> {
    const { fetchConnectionToken } = await import('@/api/connection')
    const { nuvioDriverFor } = await import('@/lib/drivers/factory')
    const token = await fetchConnectionToken(accountId, conn.id, 'nuvio')
    const profileId = token.profileId ?? conn.credentials?.profileId
    return fn(nuvioDriverFor(conn), token.accessToken, profileId)
}

export function readNuvioLibrary(accountId: string, conn: Connection): Promise<NuvioLibraryItem[]> {
    return withNuvio(accountId, conn, (d, t, p) => d.readLibrary(t, p)) as Promise<NuvioLibraryItem[]>
}

export function readNuvioCollections(accountId: string, conn: Connection): Promise<NuvioCollection[]> {
    return withNuvio(accountId, conn, (d, t, p) => d.readCollections(t, p)) as Promise<NuvioCollection[]>
}

export interface NuvioProfileRow {
    id: string
    profile_index: number
    name: string
    avatar_color_hex?: string
}

export function readNuvioProfiles(accountId: string, conn: Connection): Promise<NuvioProfileRow[]> {
    return withNuvio(accountId, conn, async (d, t) => {
        const rows = await d.pullProfiles(t)
        return rows.map(r => ({
            id: String(r.id ?? ''),
            profile_index: Number(r.profile_index ?? r.profileIndex ?? 0),
            name: String(r.name ?? 'Profile'),
            avatar_color_hex: typeof r.avatar_color_hex === 'string' ? r.avatar_color_hex : undefined,
        }))
    })
}

export function renameNuvioProfile(accountId: string, conn: Connection, profileId: string, name: string): Promise<unknown> {
    return withNuvio(accountId, conn, (d, t) => d.renameProfile(t, profileId, name))
}

export function createNuvioProfile(accountId: string, conn: Connection, params: { profileIndex: number; name: string; avatarColorHex?: string }): Promise<unknown> {
    return withNuvio(accountId, conn, (d, t) => d.createProfile(t, params))
}

export function deleteNuvioProfile(accountId: string, conn: Connection, profileId: string | number): Promise<unknown> {
    return withNuvio(accountId, conn, (d, t) => d.deleteProfile(t, profileId))
}
