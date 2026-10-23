// AIOMetadata config roundtrip-safety primitives.
//
// Pure leaf module (no store/UI imports) so it stays importable under the
// node:test runner and reusable outside the React tree.
//
// Contracts verified against upstream AIOMetadata dev@1b9c6ce:
//   - POST /api/config/load/:uuid returns { success, userUUID, installUrl,
//     config } where config carries the stored `configVersion`/`lastModified`.
//   - PUT /api/config/update/:uuid accepts a top-level `baseVersion`; when the
//     stored config is newer it replies 409 { error, code: 'CONFIG_CHANGED',
//     configVersion } — a typed conflict to surface, never to force through
//     (`force: true` exists upstream and is deliberately never sent here).
//   - The update response echoes the new top-level `configVersion`.
//   - The server stamps `lastModified`/`configVersion` itself and may strip
//     dead OAuth token references (traktTokenId/simklTokenId/simklUser and
//     jellyfinUsers card token refs) during validation.

export type AIOMetadataConfig = Record<string, unknown>

export const AIOMETADATA_SESSION_KEYS = ['sessionId', 'configHash', 'configVersion', 'lastModified'] as const
export const AIOMETADATA_TARGET_LOCAL_KEYS = ['catalogSetupComplete'] as const

// Fields the AIOM server rewrites on every save; never assert them equal.
export const AIOMETADATA_SERVER_REWRITTEN_KEYS = [...AIOMETADATA_SESSION_KEYS] as const

export function cloneAIOMetadataConfig(config: AIOMetadataConfig): AIOMetadataConfig {
    return JSON.parse(JSON.stringify(config))
}

export function sanitizeAIOMetadataConfigForCreate(config: AIOMetadataConfig): AIOMetadataConfig {
    const next = cloneAIOMetadataConfig(config)
    for (const key of [...AIOMETADATA_SESSION_KEYS, ...AIOMETADATA_TARGET_LOCAL_KEYS]) delete next[key]
    return next
}

/** The version of the loaded config, to be threaded through updates as baseVersion. */
export function getAIOMetadataConfigVersion(config: AIOMetadataConfig | undefined | null): number | null {
    const raw = config?.configVersion
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    if (typeof raw === 'string' && raw.trim() !== '') {
        const parsed = Number(raw)
        if (Number.isFinite(parsed)) return parsed
    }
    return null
}

/** Typed 409 CONFIG_CHANGED conflict; carries the server's current version. */
export class AIOMetadataConfigConflictError extends Error {
    readonly code = 'CONFIG_CHANGED'
    readonly currentVersion: number | null
    constructor(message: string, currentVersion: number | null) {
        super(message)
        this.name = 'AIOMetadataConfigConflictError'
        this.currentVersion = currentVersion
    }
}

export interface AIOMetadataUpdateOptions {
    /**
     * The configVersion the caller loaded. The instance rejects the write with
     * 409 CONFIG_CHANGED when it has since moved on. There is deliberately no
     * `force` escape hatch here: stale writes must be reloaded and reapplied.
     */
    baseVersion?: number
}

export interface AIOMetadataUpstreamResponse {
    success?: boolean
    code?: unknown
    configVersion?: unknown
    error?: unknown
}

/**
 * Build the proxy/update body. Kept pure so tests and the upcoming household
 * flows share the exact wire shape (never includes `force`).
 */
export function buildAIOMetadataUpdateBody(args: {
    config: AIOMetadataConfig
    password: string
    addonPassword?: string
    baseVersion?: number
}): Record<string, unknown> {
    const body: Record<string, unknown> = {
        config: args.config,
        password: args.password,
    }
    if (typeof args.addonPassword === 'string' && args.addonPassword.length > 0) {
        body.addonPassword = args.addonPassword
    }
    if (typeof args.baseVersion === 'number' && Number.isFinite(args.baseVersion)) {
        body.baseVersion = args.baseVersion
    }
    return body
}

function normalizeAuthError(message: string): string {
    return message.replace(/uuid\s+or\s+/gi, '').replace(/\binvalid uuid\b/gi, 'Invalid password')
}

function upstreamErrorMessage(json: AIOMetadataUpstreamResponse | undefined | null): string {
    const err = json?.error
    if (typeof err === 'string' && err.length > 0) return err
    if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
        return (err as { message: string }).message
    }
    return 'AIOMetadata rejected the request'
}

/**
 * Generic failure formatting for the non-update AIOM endpoints (save/create),
 * matching the long-standing auth-error normalization.
 */
export function formatAIOMetadataError(json: AIOMetadataUpstreamResponse | undefined | null, fallback: string): string {
    if (!json) return fallback
    return normalizeAuthError(upstreamErrorMessage(json)) || fallback
}

/**
 * Turn an AIOM update failure body into a useful, typed Error. Returns null on
 * success responses. The 409 CONFIG_CHANGED body is `{ error, code,
 * configVersion }` at the top level (not nested under `error`).
 */
export function interpretAIOMetadataUpdateFailure(json: AIOMetadataUpstreamResponse | undefined | null): Error | null {
    if (!json || json.success === true) return null
    if (json.code === 'CONFIG_CHANGED') {
        const version = typeof json.configVersion === 'number' && Number.isFinite(json.configVersion)
            ? json.configVersion
            : null
        return new AIOMetadataConfigConflictError(
            'This AIOMetadata configuration changed elsewhere after it was loaded here. ' +
            'Reload the target and reapply your changes; the stale write was not forced.',
            version
        )
    }
    return new Error(normalizeAuthError(upstreamErrorMessage(json)))
}

// -- Readback verification ----------------------------------------------------

function stableStringify(value: unknown): string {
    const normalize = (input: unknown, ancestors = new WeakSet<object>()): unknown => {
        if (input === undefined) return undefined
        if (input === null || typeof input !== 'object') return input
        const objectInput = input as object
        if (ancestors.has(objectInput)) return '[Circular]'
        ancestors.add(objectInput)
        try {
            if (Array.isArray(input)) {
                return input.map((item) => normalize(item, ancestors)).filter((item) => item !== undefined)
            }
            return Object.keys(input as Record<string, unknown>)
                .sort()
                .reduce<Record<string, unknown>>((acc, key) => {
                    const next = normalize((input as Record<string, unknown>)[key], ancestors)
                    if (next !== undefined) acc[key] = next
                    return acc
                }, {})
        } finally {
            ancestors.delete(objectInput)
        }
    }
    return JSON.stringify(normalize(value))
}

function readPath(config: AIOMetadataConfig | undefined, path: string): unknown {
    if (!config) return undefined
    let current: unknown = config
    for (const segment of path.split('.')) {
        if (current === null || typeof current !== 'object') return undefined
        current = (current as Record<string, unknown>)[segment]
    }
    return current
}

function isServerRewritten(path: string): boolean {
    const top = path.split('.')[0]
    return (AIOMETADATA_SERVER_REWRITTEN_KEYS as readonly string[]).includes(top)
}

export interface AIOMetadataReadbackVerification {
    ok: boolean
    /** Requested fields whose stored value differs from the planned value. */
    mismatchedFields: string[]
    /** Protected fields (dot-paths) that did not survive the write. */
    lostFields: string[]
}

/**
 * Semantically verify a readback after an AIOM update.
 *
 * - `fields` are the top-level keys the caller asked to persist (deletions
 *   included: absent in planned => absent in readback).
 * - `preWrite` + `protectedPaths` catch collateral damage: unknown fields and
 *   destination-owned credentials (e.g. `apiKeys.traktTokenId`,
 *   `apiKeys.simklTokenId`, `simklUser`) must survive unless they were part of
 *   the requested fields. The server may legitimately strip dead token refs,
 *   so a `lostFields` hit is surfaced as a warning, never silently ignored.
 */
export function verifyAIOMetadataWriteReadback(args: {
    planned: AIOMetadataConfig
    readback: AIOMetadataConfig
    fields: string[]
    preWrite?: AIOMetadataConfig
    protectedPaths?: string[]
}): AIOMetadataReadbackVerification {
    const { planned, readback, fields, preWrite, protectedPaths } = args
    const mismatchedFields: string[] = []
    for (const field of fields) {
        if (isServerRewritten(field)) continue
        const plannedHas = planned[field] !== undefined
        const storedHas = readback[field] !== undefined
        if (plannedHas !== storedHas) {
            mismatchedFields.push(field)
            continue
        }
        if (plannedHas && stableStringify(planned[field]) !== stableStringify(readback[field])) {
            mismatchedFields.push(field)
        }
    }

    const lostFields: string[] = []
    if (preWrite && protectedPaths?.length) {
        for (const path of protectedPaths) {
            if (isServerRewritten(path)) continue
            if (fields.some(field => path === field || path.startsWith(`${field}.`))) continue
            const before = readPath(preWrite, path)
            if (before === undefined) continue
            const after = readPath(readback, path)
            if (after === undefined || stableStringify(before) !== stableStringify(after)) {
                lostFields.push(path)
            }
        }
    }

    return { ok: mismatchedFields.length === 0 && lostFields.length === 0, mismatchedFields, lostFields }
}
