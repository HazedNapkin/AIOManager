import { STREMIO_API } from '../config.js'
import { enqueueProxyRequest } from '../proxy-queue.js'

export function createStremioDriver() {
    return {
        capabilities: ['addons'],

        async readAddons(authKey) {
            const res = await enqueueProxyRequest(STREMIO_API, () => fetch(`${STREMIO_API}/addonCollectionGet`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'AddonCollectionGet', authKey })
            }))
            if (!res.ok) {
                const body = await res.text().catch(() => '')
                const err = new Error(`Stremio API ${res.status}: ${body}`)
                err.status = res.status
                throw err
            }
            const result = await res.json()
            return result?.result?.addons || []
        },

        async writeAddons(authKey, addons) {
            const res = await enqueueProxyRequest(STREMIO_API, () => fetch(`${STREMIO_API}/addonCollectionSet`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'AddonCollectionSet', authKey, addons })
            }))
            if (!res.ok) {
                const body = await res.text().catch(() => '')
                const err = new Error(`addonCollectionSet returned ${res.status}: ${body}`)
                err.status = res.status
                throw err
            }
            return res.json()
        }
    }
}
