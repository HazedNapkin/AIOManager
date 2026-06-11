export interface HydraDriverConfig {
    name: string
    baseUrl: string
    authType: 'api-key' | 'bearer' | 'basic' | 'none'
    authHeader?: string
}

export interface HydraStatus {
    name: string
    version: string
    capabilities: string[]
}

export interface ProviderHealth {
    id: string
    name: string
    provider: string
    status: 'none' | 'active' | 'expired' | 'error'
    daysRemaining: number | null
    expiresAt: string | null
    lastChecked: number
    loading?: boolean
    error?: string
}

export interface ProviderState {
    health: Record<string, ProviderHealth>
    isRefreshing: boolean
}
