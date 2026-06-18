import type { Connection, ConnectionStatus } from '@/types/connection'

export function timeAgo(ts?: number | null): string {
    if (!ts) return 'never'
    const diff = Date.now() - ts
    if (diff < 60_000) return 'just now'
    const m = Math.floor(diff / 60_000)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.floor(h / 24)
    if (d < 30) return `${d}d ago`
    return `${Math.floor(d / 30)}mo ago`
}

export type ExpiryState = 'none' | 'ok' | 'expiring' | 'expired'

export interface TokenExpiry {
    state: ExpiryState
    daysLeft: number | null
    label: string | null
}

const AUTO_REFRESH_PLATFORMS = new Set(['nuvio', 'realstream'])

const EXPIRING_THRESHOLD_DAYS = 7

export function tokenExpiry(connection: Connection): TokenExpiry {
    if (AUTO_REFRESH_PLATFORMS.has(connection.platform)) return { state: 'none', daysLeft: null, label: null }
    const raw = connection.credentials?.expiresAt
    if (!raw) return { state: 'none', daysLeft: null, label: null }
    const ts = Number(raw)
    if (!Number.isFinite(ts) || ts <= 0) return { state: 'none', daysLeft: null, label: null }
    const diff = ts - Date.now()
    if (diff <= 0) return { state: 'expired', daysLeft: 0, label: 'Session expired' }
    const days = Math.ceil(diff / 86_400_000)
    if (days <= EXPIRING_THRESHOLD_DAYS) {
        return { state: 'expiring', daysLeft: days, label: days <= 1 ? 'Session expires today' : `Session expires in ${days} days` }
    }
    return { state: 'ok', daysLeft: days, label: `Session valid for ${days} days` }
}

// Connections that expose a refreshable server-side session token we can probe with a "Test"
// action via the token endpoint. Stremio reconciles through the account authKey and Hydra uses a
// static API key (tested at setup), so neither has a per-connection token to probe here.
export function canTestConnection(connection: Connection): boolean {
    return connection.platform === 'nuvio' || connection.platform === 'realstream'
}

export type DisplayStatus = ConnectionStatus | 'expiring'

export function displayStatus(status: ConnectionStatus, expiry: TokenExpiry): DisplayStatus {
    if (status === 'expired') return 'expired'
    if (status === 'active' && expiry.state === 'expiring') return 'expiring'
    if (status === 'active' && expiry.state === 'expired') return 'expired'
    return status
}
