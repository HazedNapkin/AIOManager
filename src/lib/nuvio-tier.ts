export type NuvioMemberTier = 'free' | 'supporter' | 'supporter-plus' | 'other'

export interface NuvioMemberStatus {
    tier: NuvioMemberTier
    supporter: boolean
    label: string
    expiresAt?: number
}

const FREE: NuvioMemberStatus = { tier: 'free', supporter: false, label: 'Free' }

// Live shape (probed 2026-08-21): non-supporters get HTTP 200 with []; supporter rows
// carry a `tier` string. Unknown future tiers render as their raw label.
export function parseNuvioMemberAccess(rows: unknown): NuvioMemberStatus {
    if (!Array.isArray(rows)) return FREE
    for (const row of rows) {
        if (typeof row !== 'object' || row === null) continue
        const record = row as Record<string, unknown>
        const raw = record.tier
        if (typeof raw !== 'string' || raw.trim() === '') continue
        return mapTier(raw.trim(), record)
    }
    return FREE
}

function mapTier(tier: string, record?: Record<string, unknown>): NuvioMemberStatus {
    const normalized = tier.toUpperCase().replace(/[\s-]+/g, '_')
    const base = normalized === 'SUPPORTER_PLUS' || normalized === 'SUPPORTER+'
        ? { tier: 'supporter-plus' as const, label: 'Supporter Plus' }
        : normalized === 'SUPPORTER'
            ? { tier: 'supporter' as const, label: 'Supporter' }
            : { tier: 'other' as const, label: tier }
    const expiresAt = parseMemberExpiry(record)
    return expiresAt !== undefined
        ? { supporter: true, ...base, expiresAt }
        : { supporter: true, ...base }
}

// Expiry field name is unconfirmed upstream (probed only through a free account, which
// returns []); pick up whichever datetime field a supporter row carries, if any.
function parseMemberExpiry(record: Record<string, unknown> | undefined): number | undefined {
    if (!record) return undefined
    for (const key of ['expires_at', 'expiresAt', 'current_period_end', 'currentPeriodEnd', 'valid_until', 'validUntil']) {
        const value = record[key]
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
            return value < 1e12 ? value * 1000 : value
        }
        if (typeof value === 'string' && value !== '') {
            const parsed = Date.parse(value)
            if (Number.isFinite(parsed)) return parsed
        }
    }
    return undefined
}
