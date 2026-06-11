export type VaultProvider =
    | 'real-debrid'
    | 'torbox'
    | 'premiumize'
    | 'alldebrid'
    | 'debrid-link'
    | 'aiostreams'
    | 'other'

export interface VaultKey {
    id: string
    name: string
    provider: VaultProvider
    value: string
    updatedAt: number
    customExpiry?: string
    customAbbr?: string
    customDashboardUrl?: string
    customProviderName?: string
    group?: string
    catalogId?: string
}

export interface VaultState {
    keys: VaultKey[]
    isLocked: boolean
    loading: boolean
    error: string | null
}
