import { isSafeUrlResolved } from '../utils/ssrf.js'

const DEFAULT_TIMEOUT = 15000
const HEALTH_TIMEOUT = 8000

export async function createHydraClient(config) {
    const base = (config.baseUrl || '').replace(/\/+$/, '')
    if (!base || !(await isSafeUrlResolved(base))) {
        throw new Error('Unsafe or private Hydra baseUrl')
    }

    const makeHeaders = () => {
        if (config.authType === 'api-key') {
            return { [config.authHeader || 'X-API-Key']: config.authValue || '' }
        }
        if (config.authType === 'bearer') {
            return { 'Authorization': `Bearer ${config.authValue || ''}` }
        }
        if (config.authType === 'basic') {
            return { 'Authorization': `Basic ${Buffer.from(config.authValue || '').toString('base64')}` }
        }
        return {}
    }

    return {
        async status() {
            const r = await fetch(`${base}/hydra/status`, {
                headers: makeHeaders(),
                signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
            })
            if (!r.ok) throw new Error(`Hydra status failed: ${r.status}`)
            return r.json()
        },

        async readAddons() {
            const r = await fetch(`${base}/hydra/addons`, {
                headers: makeHeaders(),
                signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
            })
            if (!r.ok) throw new Error(`Hydra readAddons failed: ${r.status}`)
            const body = await r.json()
            return body.addons ?? body
        },

        async writeAddons(addons) {
            const r = await fetch(`${base}/hydra/addons`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...makeHeaders() },
                body: JSON.stringify({ addons }),
                signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
            })
            if (!r.ok) throw new Error(`Hydra writeAddons failed: ${r.status}`)
            return r.json()
        },

        async healthCheck(addonUrl) {
            const encoded = encodeURIComponent(addonUrl)
            const r = await fetch(`${base}/hydra/addons/${encoded}/health`, {
                headers: makeHeaders(),
                signal: AbortSignal.timeout(HEALTH_TIMEOUT),
            })
            return r.ok
        },
    }
}
