import type { HydraDriverConfig } from './provider'

export type ConnectionType = 'native' | 'hydra-inbound' | 'hydra-outbound'
export type ConnectionStatus = 'active' | 'expired' | 'error' | 'degraded' | 'pending'

export interface Connection {
    id: string
    platform: string
    connectionType: ConnectionType
    driverType?: ConnectionType
    enabled: boolean
    status: ConnectionStatus
    credentials: Record<string, string>
    profileMapping?: Record<string, number>
    lastSync: number
    lastKnownAddonCount: number
    capabilities: string[]
    consecutiveFailures: number
    lastError?: string
    lastErrorAt?: number
    pluginList?: NuvioPluginDescriptor[]
    driverConfig?: HydraDriverConfig
    displayName?: string
}

export interface NuvioPluginDescriptor {
    url: string
    name: string
    enabled: boolean
    sort_order: number
    repo_type?: string
}

export interface PlatformDriver {
    testConnection(credentials: Record<string, string>): Promise<{ ok: boolean; capabilities: string[] }>
    readAddons(credentials: Record<string, string>, options?: { profileId?: string }): Promise<unknown[]>
    writeAddons(credentials: Record<string, string>, addons: unknown[], options?: { profileId?: string }): Promise<void>
    installAddon(credentials: Record<string, string>, addonUrl: string, options?: { profileId?: string }): Promise<void>
    removeAddon(credentials: Record<string, string>, addonUrl: string, options?: { profileId?: string }): Promise<void>
    healthCheck?(addonUrl?: string): Promise<{ healthy: boolean; latencyMs: number }>
}

export function isSyncEligibleConnection(c: Connection): boolean {
    return c.connectionType === 'hydra-outbound' || c.platform !== 'stremio'
}
