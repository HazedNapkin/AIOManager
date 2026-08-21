export interface QRSession {
    qrImage: string
    link: string
    code: string
    expiresAt: number
    pollIntervalMs?: number
    platformData?: unknown
}

export type QRPollOutcome = 'pending' | 'claimed' | 'expired'

export function computeQrPhase(session: QRSession, now: number): 'active' | 'expired' {
    return now >= session.expiresAt ? 'expired' : 'active'
}

export function nextPollDelay(_attempt: number, baseMs: number): number {
    return baseMs
}

export function mapNuvioPollStatus(status: string | undefined | null): QRPollOutcome {
    if (status === 'approved') return 'claimed'
    if (status === 'expired' || status === 'used' || status === 'cancelled') return 'expired'
    return 'pending'
}

export function mapNuvioPollErrorStatus(status: number | undefined): 'expired' | 'pending' {
    if (status === 400 || status === 410) return 'expired'
    return 'pending'
}

export function parseExpiry(raw: unknown, now: number = Date.now()): number {
    if (typeof raw === 'string' && raw.trim() !== '') {
        const numeric = Number(raw)
        if (Number.isFinite(numeric) && numeric !== 0) {
            return numeric > 1e12 ? numeric : numeric * 1000
        }
        const parsed = Date.parse(raw)
        if (!Number.isNaN(parsed)) return parsed
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw > 1e12 ? raw : raw * 1000
    }
    return now + 5 * 60 * 1000
}
