import { JellyfinError } from './client.ts'
import type { JellyfinClient, JellyfinItemResult, JellyfinSession } from './types.ts'
import type { JellyfinSecret } from './connection-data.ts'

export type MediaRead<T> =
    | { status: 'success'; data: T; checkedAt: number }
    | { status: 'unsupported' | 'denied' | 'error'; message: string; checkedAt: number }
    | { status: 'waiting'; message: string }

export interface JellyfinMediaReads {
    resume: MediaRead<JellyfinItemResult>
    played: MediaRead<JellyfinItemResult>
    sessions: MediaRead<JellyfinSession[]>
}

export async function captureMediaRead<T>(read: () => Promise<T>, signal: AbortSignal): Promise<MediaRead<T>> {
    try {
        const data = await read()
        signal.throwIfAborted()
        return { status: 'success', data, checkedAt: Date.now() }
    } catch (error) {
        if (signal.aborted) throw error
        const status = error instanceof JellyfinError
            ? error.kind === 'unsupported' ? 'unsupported' : error.kind === 'auth' ? 'denied' : 'error'
            : 'error'
        const message = status === 'unsupported' ? 'This server does not expose this read.'
            : status === 'denied' ? 'The server refused this read. Check your session and this user’s permissions.'
            : 'This read failed. Check the server address, HTTPS and browser access (CORS), then retry.'
        return { status, message, checkedAt: Date.now() }
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
