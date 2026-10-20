// AIOStreams config roundtrip-safety primitives.
//
// Pure leaf module (no store/UI imports, relative .ts imports only) so it stays
// importable under the node:test runner and reusable by callers that do not
// live inside the React tree (scratch-validation/config-roundtrip-safety-20261019).
//
// Contracts verified against upstream AIOStreams main@fbb961d (clone of the
// parent-reviewed pin 6ca32ed2, see the report for the revision note):
//   - GET /api/v1/user?raw=true returns the stored child config; the default
//     response merges the parent. Writers must base edits on the raw view or
//     inherited values get baked into the child.
//   - PUT /api/v1/user persists the submitted config as the child config and
//     has NO concurrency guard: writes are last-write-wins, so safety here is
//     read-before-write plus post-write revalidation, not atomic CAS.
//   - updateUser strips uuid/trusted/ip/activeVariants/autoVariants/
//     healthResults/variantSelectorLocation, GET strips accessKey, and a
//     key-gated instance rejects writes with error code ADDON_PASSWORD_INVALID
//     unless config.accessKey equals the instance's configured access key.

export const AIOSTREAMS_RUNTIME_CONFIG_KEYS = [
    'uuid', 'encryptedPassword', 'trusted', 'ip', 'accessToken',
] as const

export const AIOSTREAMS_TARGET_LOCAL_CONFIG_KEYS = [
    'appliedTemplates',
    'accessKey',
] as const

export const AIOSTREAMS_PARENT_CONFIG_KEYS = [
    'parentConfig', 'parentConfigUuid', 'parentConfigPassword',
    'parentConfigMergeStrategy', 'parentMergeStrategy',
] as const

// Keys the server rewrites or strips during a save/read roundtrip; they can
// never be asserted equal in a readback.
export const AIOSTREAMS_SERVER_REWRITTEN_KEYS = [
    ...AIOSTREAMS_RUNTIME_CONFIG_KEYS,
    'accessKey',
    'activeVariants',
    'autoVariants',
    'healthResults',
    'variantSelectorLocation',
    'showChanges',
] as const

export type AIOStreamsConfig = Record<string, unknown>

export function cloneAIOStreamsConfig(config: AIOStreamsConfig): AIOStreamsConfig {
    return JSON.parse(JSON.stringify(config))
}

export function sanitizeAIOStreamsConfigForCreate(config: AIOStreamsConfig): AIOStreamsConfig {
    const next = cloneAIOStreamsConfig(config)
    for (const key of AIOSTREAMS_RUNTIME_CONFIG_KEYS) delete next[key]
    for (const key of AIOSTREAMS_TARGET_LOCAL_CONFIG_KEYS) delete next[key]
    for (const key of AIOSTREAMS_PARENT_CONFIG_KEYS) delete next[key]
    return next
}

export function sanitizeAIOStreamsConfigForUpdate(config: AIOStreamsConfig): AIOStreamsConfig {
    const next = cloneAIOStreamsConfig(config)
    for (const key of AIOSTREAMS_RUNTIME_CONFIG_KEYS) delete next[key]
    return next
}

/**
 * Shape the config that gets sent to the user create/update endpoints.
 *
 * The `accessKey` field is how a key-gated instance authenticates a config
 * write. Historically AIOManager wrote the user password there, which only
 * works when the instance has no separate access key. An explicit
 * `instanceAccessKey` (supplied by the user, never guessed) takes precedence;
 * the password fallback keeps older ungated instances working.
 */
export function buildAIOStreamsWriteConfig(
    config: AIOStreamsConfig,
    password: string,
    instanceAccessKey?: string
): AIOStreamsConfig {
    const next = cloneAIOStreamsConfig(config)
    next.accessKey = typeof instanceAccessKey === 'string' && instanceAccessKey.length > 0
        ? instanceAccessKey
        : password
    return next
}

/** Typed failure for writes rejected by a key-gated AIOStreams instance. */
export class AIOStreamsAccessKeyError extends Error {
    readonly code = 'AIOS_INSTANCE_ACCESS_KEY_REQUIRED'
    constructor(message: string) {
        super(message)
        this.name = 'AIOStreamsAccessKeyError'
    }
}

/** Typed failure for a wrong uuid/password pair (distinct from the access-key gate). */
export class AIOStreamsAuthError extends Error {
    readonly code = 'AIOS_AUTH_FAILED'
    constructor(message: string) {
        super(message)
        this.name = 'AIOStreamsAuthError'
    }
}

export interface AIOStreamsUpstreamError {
    success?: boolean
    error?: { code?: unknown; message?: unknown } | string | null
}

function upstreamErrorCode(json: AIOStreamsUpstreamError | undefined | null): { code: string; message: string } {
    const err = json?.error
    if (typeof err === 'string') return { code: '', message: err }
    const code = typeof err?.code === 'string' ? err.code : ''
    const message = typeof err?.message === 'string' && err.message.length > 0
        ? err.message
        : 'AIOStreams rejected the request'
    return { code, message }
}

/**
 * Turn an upstream AIOS failure body ({ success:false, error:{ code, message } })
 * into a useful, typed Error. Returns null for success responses so callers
 * keep their happy path untouched.
 */
export function interpretAIOStreamsWriteFailure(json: AIOStreamsUpstreamError | undefined | null): Error | null {
    if (!json || json.success === true) return null
    const { code, message } = upstreamErrorCode(json)
    if (code === 'ADDON_PASSWORD_INVALID') {
        return new AIOStreamsAccessKeyError(
            'This AIOStreams instance requires its instance access key for config changes. ' +
            'The config password alone is not accepted. Enter the instance access key ' +
            '(set via the instance dashboard or CONFIG_ACCESS_KEY) and try again.'
        )
    }
    if (code === 'USER_INVALID_DETAILS') {
        return new AIOStreamsAuthError(`AIOStreams rejected the credentials: ${message}`)
    }
    if (code === 'PARENT_CONFIG_UNAVAILABLE' || code === 'PARENT_CONFIG_SELF_REFERENCE') {
        return new Error(`Parent config problem on the AIOStreams instance: ${message}`)
    }
    if (code === 'USER_INVALID_CONFIG') {
        return new Error(`AIOStreams rejected the config as invalid: ${message}`)
    }
    return new Error(message)
}

/**
 * Copy the target's own parent-config keys onto a planned write so a full-copy
 * sync keeps the target's inheritance instead of silently re-linking it to the
 * source's parent. When the target has no parent keys, any that leaked in from
 * the source are removed — the source's parent reference must never travel.
 */
export function preserveAIOStreamsParentLinkage(
    planned: AIOStreamsConfig,
    targetRaw: AIOStreamsConfig
): AIOStreamsConfig {
    const targetHasParent = AIOSTREAMS_PARENT_CONFIG_KEYS.some(key => targetRaw[key] !== undefined)
    if (targetHasParent) {
        for (const key of AIOSTREAMS_PARENT_CONFIG_KEYS) {
            if (targetRaw[key] !== undefined) planned[key] = cloneValue(targetRaw[key])
            else delete planned[key]
        }
    } else {
        for (const key of AIOSTREAMS_PARENT_CONFIG_KEYS) delete planned[key]
    }
    return planned
}

// -- Readback verification ----------------------------------------------------

function cloneValue(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value))
}

/** Key-sorted JSON so server-side key reordering does not read as a change. */
export function stableStringify(value: unknown): string {
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

function isServerRewritten(key: string): boolean {
    return (AIOSTREAMS_SERVER_REWRITTEN_KEYS as readonly string[]).includes(key)
}

export interface AIOStreamsReadbackVerification {
    /** True when every requested field persisted and nothing protected was lost. */
    ok: boolean
    /** Requested fields whose stored value differs from the planned value. */
    mismatchedFields: string[]
    /** Protected fields (e.g. parent linkage, target-local state) that did not survive. */
    lostFields: string[]
}

/**
 * Semantically verify a raw readback after a config write.
 *
 * - `planned` is the payload that was sent (post-sanitize).
 * - `readback` is a RAW (`?raw=true`) fetch of the same config after the write.
 * - `fields` are the top-level keys the caller asked to persist; each must deep-
 *   equal (key-sorted) its planned value, including deletions (planned lacks the
 *   key => readback must lack it too).
 * - `preWrite`, when provided, is the raw fetch the write was based on; every
 *   `preservedFields` key must survive unchanged into the readback.
 *
 * The upstream PUT has no version guard, so a mismatch here usually means a
 * concurrent writer won; surface it, never auto-retry.
 */
export function verifyAIOStreamsWriteReadback(args: {
    planned: AIOStreamsConfig
    readback: AIOStreamsConfig
    fields: string[]
    preWrite?: AIOStreamsConfig
    preservedFields?: string[]
}): AIOStreamsReadbackVerification {
    const { planned, readback, fields, preWrite, preservedFields } = args
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
    if (preWrite && preservedFields?.length) {
        for (const field of preservedFields) {
            if (isServerRewritten(field)) continue
            const before = preWrite[field]
            const after = readback[field]
            if (before === undefined) continue // nothing to preserve
            if (after === undefined || stableStringify(before) !== stableStringify(after)) {
                lostFields.push(field)
            }
        }
    }

    return { ok: mismatchedFields.length === 0 && lostFields.length === 0, mismatchedFields, lostFields }
}
