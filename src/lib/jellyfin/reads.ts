import { JellyfinError } from './client.ts'
import type { JellyfinClient, JellyfinItemResult, JellyfinSession } from './types.ts'
import type { JellyfinSecret } from './connection-data.ts'

export type MediaRead<T> =
    | { status: 'success'; data: T; checkedAt: number }
    | { status: 'unsupported' | 'denied' | 'error'; message: string; checkedAt: number; startedAt?: number; httpStatus?: number }
    | { status: 'waiting'; message: string }

export interface JellyfinMediaReads {
    resume: MediaRead<JellyfinItemResult>
    played: MediaRead<JellyfinItemResult>
    sessions: MediaRead<JellyfinSession[]>
}

export async function captureMediaRead<T>(read: () => Promise<T>, signal: AbortSignal): Promise<MediaRead<T>> {
    const startedAt = Date.now()
    try {
        const data = await read()
        signal.throwIfAborted()
        return { status: 'success', data, checkedAt: Date.now() }
    } catch (error) {
        if (signal.aborted) throw error
        const status = error instanceof JellyfinError
            ? error.kind === 'unsupported' ? 'unsupported' : error.kind === 'auth' ? 'denied' : 'error'
            : 'error'
        const httpStatus = error instanceof JellyfinError ? error.status : undefined
        let message = 'This read failed. Check the server address, HTTPS and browser access (CORS), then retry.'
        if (status === 'unsupported') message = 'This server does not expose this read.'
        else if (status === 'denied') message = httpStatus === 401
            ? 'The saved sign-in was rejected. Reconnect this server, then refresh Activity.'
            : 'The server denied this read. Check this user’s permissions or reconnect to the correct user.'
        return { status, message, startedAt, checkedAt: Date.now(), ...(httpStatus !== undefined ? { httpStatus } : {}) }
    }
}

export async function readJellyfinMedia(client: JellyfinClient, secret: JellyfinSecret, signal: AbortSignal): Promise<JellyfinMediaReads> {
    const [resume, played, sessions] = await Promise.all([
        captureMediaRead(() => client.readResume(secret.accessToken, secret.userId, signal), signal),
        captureMediaRead(() => client.readPlayed(secret.accessToken, secret.userId, signal), signal),
        captureMediaRead(() => client.readSessions(secret.accessToken, secret.userId, signal), signal),
    ])
    return { resume, played, sessions }
}
