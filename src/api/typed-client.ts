import createClient from 'openapi-fetch'

import type { components, paths } from './schema'
import { getSyncAuthHeaders } from '@/lib/sync-auth'

export type { components, paths }

const client = createClient<paths>({ baseUrl: '' })

client.use({
    async onRequest({ request }) {
        const headers = await getSyncAuthHeaders()
        for (const [name, value] of Object.entries(headers)) {
            request.headers.set(name, value)
        }
        return request
    },
})

export { client as typedClient }
