export interface NuvioDiscovery {
    backendUrl: string
    publishableKey?: string
    capabilities: { emailPasswordAuth: boolean; tvLogin: boolean }
}

// self_hosted is unreliable (the official backend reports true) — never surfaced or branched on.
export function parseNuvioDiscovery(raw: unknown): NuvioDiscovery | null {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
    const row = raw as Record<string, unknown>
    const backendUrl = typeof row.backend_url === 'string' ? row.backend_url.trim().replace(/\/+$/, '') : ''
    if (!backendUrl) return null
    const caps = (row.capabilities !== null && typeof row.capabilities === 'object' && !Array.isArray(row.capabilities)
        ? row.capabilities
        : {}) as Record<string, unknown>
    const publishableKey = typeof row.publishable_key === 'string' ? row.publishable_key.trim() : ''
    return {
        backendUrl,
        publishableKey: publishableKey || undefined,
        capabilities: {
            emailPasswordAuth: caps.email_password_auth === true,
            tvLogin: caps.tv_login === true,
        },
    }
}

export async function discoverNuvioBackend(baseUrl: string, timeoutMs = 8000): Promise<NuvioDiscovery | null> {
    const trimmed = (baseUrl || '').trim().replace(/\/+$/, '')
    if (!trimmed) return null
    try {
        const res = await fetch(`${trimmed}/.well-known/nuvio`, { signal: AbortSignal.timeout(timeoutMs) })
        if (!res.ok) return null
        return parseNuvioDiscovery(await res.json())
    } catch {
        return null
    }
}
