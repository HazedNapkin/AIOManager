import type { Connection, MediaServerIdentity } from '../../types/connection.ts'
import type { JellyfinSecret } from './connection-data.ts'
import { createJellyfinClient, JellyfinError, normalizeJellyfinUrl } from './client.ts'

export { normalizeJellyfinUrl } from './client.ts'

export interface JellyfinLogin {
    baseUrl: string
    method: 'password' | 'token'
    username?: string
    password?: string
    accessToken?: string
    userId?: string
}

export interface JellyfinSession {
    secret: JellyfinSecret
    identity: MediaServerIdentity
}

// The setup flow and media reads share one transport and one verified remote user.
export class JellyfinClient {
    readonly baseUrl: string
    private readonly deviceId: string
    private readonly client: ReturnType<typeof createJellyfinClient>

    constructor(baseUrl: string, deviceId: string, fetcher?: typeof fetch) {
        this.baseUrl = normalizeJellyfinUrl(baseUrl)
        this.deviceId = deviceId
        this.client = createJellyfinClient(this.baseUrl, { deviceId, fetch: fetcher })
    }

    async signIn(login: JellyfinLogin, signal?: AbortSignal): Promise<JellyfinSession> {
        let signedIn
        if (login.method === 'password') {
            if (!login.username?.trim()) throw new Error('Enter your server username')
            signedIn = await this.client.signIn(login.username.trim(), login.password || '', signal)
            signedIn.user = await this.client.getUser(signedIn.accessToken, signedIn.user.Id, signal)
        } else {
            const token = login.accessToken?.trim()
            if (!token) throw new Error('Enter a session token or API key')
            signedIn = await this.client.connectToken(token, login.userId?.trim() || undefined, signal)
        }

        let details: Awaited<ReturnType<typeof this.client.inspect>> | undefined
        try {
            details = await this.client.inspect(signedIn.accessToken, signedIn.user, signal)
        } catch (error) {
            // Product information is optional after verifying the user. A failed
            // authentication or cancellation still invalidates the check.
            if (signal?.aborted || (error instanceof JellyfinError && (error.status === 401 || error.kind === 'aborted'))) throw error
        }
        const product = details?.product || 'compatible'
        const productName = product === 'aiometadata' ? 'AIOMetadata' : product === 'aiostreams' ? 'AIOStreams'
            : product === 'jellyfin' ? 'Jellyfin' : 'Jellyfin-compatible server'
        const userName = typeof signedIn.user.Name === 'string' && signedIn.user.Name.trim()
            ? signedIn.user.Name : signedIn.user.Id
        return {
            secret: { baseUrl: this.baseUrl, accessToken: signedIn.accessToken, deviceId: this.deviceId, userId: signedIn.user.Id },
            identity: {
                product, productName, packageName: details?.packageName,
                serverId: details?.serverId || signedIn.serverId, serverName: details?.serverName,
                version: details?.version, userId: signedIn.user.Id, userName,
                authMethod: login.method, lastCheckedAt: Date.now(),
            },
        }
    }
}

export function validateJellyfinReconnect(connection: Connection, session: JellyfinSession, previous?: JellyfinSecret): void {
    const current = connection.mediaServer
    const wrongUrl = previous && normalizeJellyfinUrl(previous.baseUrl) !== session.secret.baseUrl
    const wrongUser = !current?.userId || current.userId !== session.secret.userId
    const wrongServer = current?.serverId && session.identity.serverId && current.serverId !== session.identity.serverId
    const unverifiedServer = !previous && (!current?.serverId || current.serverId !== session.identity.serverId)
    if (wrongUrl || wrongUser || wrongServer || unverifiedServer) {
        throw new Error('Reconnect to the same server and remote user. Use Add Connection for a different server or user.')
    }
}
