import type { Connection } from '../../types/connection.ts'
import type { JellyfinMediaReads } from './reads.ts'

export interface MediaReadSession {
    credentials: string
    userId: string
    serverId?: string
    checkedAt: number
    startedAt?: number
}

export function jellyfinConnectionReadFailure(reads: JellyfinMediaReads): { status: 'expired' | 'error'; message: string; checkedAt: number; startedAt: number } | undefined {
    const { resume, played } = reads
    if (resume.status !== 'denied' || played.status !== 'denied') return
    const rejected = resume.httpStatus === 401 || played.httpStatus === 401
    return {
        status: rejected ? 'expired' : 'error',
        message: rejected
            ? 'The saved sign-in was rejected. Reconnect this server, then refresh Activity.'
            : 'The server denied Activity reads. Check this user’s permissions or reconnect to the correct user.',
        checkedAt: Math.min(resume.checkedAt, played.checkedAt),
        startedAt: Math.min(resume.startedAt ?? resume.checkedAt, played.startedAt ?? played.checkedAt),
    }
}

export function canApplyMediaReadFailure(connection: Connection, session: MediaReadSession): boolean {
    return connection.platform === 'jellyfin' && connection.enabled
        && connection.credentials.jellyfin === session.credentials
        && connection.mediaServer?.userId === session.userId
        && connection.mediaServer?.serverId === session.serverId
        // A successful verification while this read was in flight wins too.
        && (connection.mediaServer?.lastCheckedAt ?? 0) < (session.startedAt ?? session.checkedAt)
        && (connection.lastErrorAt ?? 0) <= session.checkedAt
}
