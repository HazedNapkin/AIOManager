export type VaultProvider =
    | 'real-debrid'
    | 'torbox'
    | 'premiumize'
    | 'alldebrid'
    | 'debrid-link'
    | 'aiostreams'
    | 'aiometadata'
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
    serverUrl?: string
    addonUuid?: string
}

export interface VaultState {
    keys: VaultKey[]
    isLocked: boolean
    loading: boolean
    error: string | null
}
