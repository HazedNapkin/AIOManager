export interface PremiumStatus {
    active: boolean
    lifetime: boolean
    expiresAt: number | null
}

const LIFETIME_YEAR = 2099

const INACTIVE: PremiumStatus = { active: false, lifetime: false, expiresAt: null }

export function parsePremiumExpire(raw: unknown, now: number = Date.now()): PremiumStatus {
    if (typeof raw !== 'string') return INACTIVE
    const expiresAt = Date.parse(raw)
    if (Number.isNaN(expiresAt) || expiresAt <= now) return INACTIVE
    const lifetime = new Date(expiresAt).getUTCFullYear() >= LIFETIME_YEAR
    return { active: true, lifetime, expiresAt }
}
