export type WatchMediaType = 'movie' | 'episode'

export interface WatchStateRecord {
    id: string
    title: string
    type: WatchMediaType | 'unknown'
    identities: string[]
    season?: number
    episode?: number
    watched?: boolean
    positionMs?: number
    durationMs?: number
    playedAt: number | null
    playCount?: number
    unmodified?: boolean
    notes?: string[]
    fingerprint: string
}

export interface WatchStateEndpoint {
    connectionId: string
    label: string
    subject: string
    scope: string
}

export interface WatchStateSnapshot extends WatchStateEndpoint {
    records: WatchStateRecord[]
    complete: boolean
    notes: string[]
}

export type MigrationProgress = (message: string) => void

export interface WatchStateSource {
    read(signal: AbortSignal, progress?: MigrationProgress): Promise<WatchStateSnapshot>
}

export interface WatchStatePatch {
    watched?: true
    positionMs?: number
    playedAt?: number
    playCount?: number
}

export interface MigrationWriteResult {
    status: 'applied' | 'unchanged' | 'conflict'
    message: string
    record?: WatchStateRecord
}

export interface WatchStateDestination extends WatchStateEndpoint {
    capabilities: { watched: boolean; resume: boolean; dates: boolean; counts?: boolean; combined?: boolean; notes: string[] }
    resolve(record: WatchStateRecord, signal: AbortSignal): Promise<WatchStateRecord[]>
    apply(expected: WatchStateRecord, patch: WatchStatePatch, signal: AbortSignal): Promise<MigrationWriteResult>
}

export interface MigrationOptions {
    watched: boolean
    resume: boolean
}

export interface MigrationRow {
    id: string
    source: WatchStateRecord
    target?: WatchStateRecord
    patch?: WatchStatePatch
    status: 'ready' | 'unchanged' | 'conflict' | 'skipped' | 'unsupported'
    reason: string
    notes: string[]
}

export interface WatchMigrationPlan {
    createdAt: number
    source: WatchStateSnapshot
    destination: WatchStateEndpoint
    options: MigrationOptions
    notes: string[]
    rows: MigrationRow[]
}

export interface MigrationResult {
    rowId: string
    status: 'applied' | 'unchanged' | 'conflict' | 'failed'
    message: string
    completedAt: number
    verified?: Pick<WatchStateRecord, 'watched' | 'positionMs' | 'playedAt' | 'playCount'>
}
