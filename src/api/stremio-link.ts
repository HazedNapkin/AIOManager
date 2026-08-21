import type { QRSession, QRPollOutcome } from '@/lib/qr-device-link'

const STREMIO_LINK_API = 'https://link.stremio.com/api/v2'
// Stremio sends no expiry; the link flow is only valid for ~5 minutes.
const QR_TTL_MS = 5 * 60 * 1000
const POLL_INTERVAL_MS = 3000

interface StremioCreateResponse {
    result?: { success?: boolean; code?: string; link?: string; qrcode?: string }
    error?: { code?: number; message?: string }
}

interface StremioReadResponse {
    result?: { success?: boolean; authKey?: string }
    error?: { code?: number; message?: string }
}

// Same header shape as StremioOAuth (CORS proven in production); window is absent under node --test. Origin is browser-forbidden and silently dropped, so it is omitted.
function stremioLinkInit(): RequestInit {
    const host = typeof window !== 'undefined' ? window.location.host : ''
    return {
        headers: {
            'X-Requested-With': host,
        },
        referrerPolicy: 'no-referrer',
    }
}

export async function createStremioLink(): Promise<QRSession> {
    const res = await fetch(`${STREMIO_LINK_API}/create?type=Create`, stremioLinkInit())
    if (!res.ok) throw new Error('Failed to connect to Stremio')

    const data: StremioCreateResponse = await res.json()
    const result = data?.result
    if (result?.success && result.code && result.link) {
        return {
            qrImage: result.qrcode || '',
            link: result.link,
            code: result.code,
            expiresAt: Date.now() + QR_TTL_MS,
            pollIntervalMs: POLL_INTERVAL_MS,
        }
    }
    throw new Error(data?.error?.message || 'Failed to generate link')
}

export async function pollStremioLink(session: QRSession): Promise<QRPollOutcome> {
    try {
        const res = await fetch(
            `${STREMIO_LINK_API}/read?type=Read&code=${encodeURIComponent(session.code)}`,
            stremioLinkInit()
        )

        if (res.status === 410 || res.status === 404) return 'expired'
        if (!res.ok) return 'pending'

        const data: StremioReadResponse = await res.json()
        if (data?.result?.authKey) {
            session.platformData = { authKey: data.result.authKey }
            return 'claimed'
        }
        if (data?.error) {
            const code = data.error.code
            if (code === 101) return 'pending'
            if (code === 404 || code === 410 || data.error.message?.toLowerCase().includes('expired')) return 'expired'
        }
        return 'pending'
    } catch {
        return 'pending'
    }
}
