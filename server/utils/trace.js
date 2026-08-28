import fs from 'fs'
import path from 'path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'url'

const ENABLED = ['1', 'true', 'yes', 'on'].includes((process.env.AIOMAN_TRACE ?? '').toLowerCase())
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TRACE_FILE = path.resolve(process.env.DATA_DIR || './data', 'trace.log')

// Size-capped trace log: the active file rotates at AIOMAN_TRACE_MAX_MB (default 10) and the
// last AIOMAN_TRACE_KEEP (default 3) rotated files are kept as trace.log.1 (newest) through
// trace.log.K (oldest). Bounds the data dir at ~(K+1) x max instead of the unbounded
// append-only single file (177.51 MB live) the audit found.
const numEnv = (v, fallback) => {
    const n = Number.parseFloat(v ?? '')
    return Number.isFinite(n) && n > 0 ? n : fallback
}
const TRACE_MAX_BYTES = numEnv(process.env.AIOMAN_TRACE_MAX_MB, 10) * 1024 * 1024
const TRACE_KEEP = Math.max(1, Math.floor(numEnv(process.env.AIOMAN_TRACE_KEEP, 3)))
// Server-side cap on /api/debug/trace batches: the live client flushes ~15 entries per
// batch, so anything larger is an abnormal caller; write only the head.
const CLIENT_BATCH_MAX = 500

const rotatedPath = (i) => `${TRACE_FILE}.${i}`

const shiftRotated = () => {
    // Drop the oldest, shift the rest up, then move the active file to .1. Best effort
    // throughout: a failed rotation must never take down the server or block a trace.
    try { fs.rmSync(rotatedPath(TRACE_KEEP), { force: true }) } catch { /* rotation is best effort */ }
    for (let i = TRACE_KEEP - 1; i >= 1; i--) {
        try { if (fs.existsSync(rotatedPath(i))) fs.renameSync(rotatedPath(i), rotatedPath(i + 1)) } catch { /* rotation is best effort */ }
    }
    try { if (fs.existsSync(TRACE_FILE)) fs.renameSync(TRACE_FILE, rotatedPath(1)) } catch { /* rotation is best effort */ }
}

let stream = null
let streamBytes = 0
let rotating = false

const rotate = () => {
    if (rotating || !stream) return
    rotating = true
    const old = stream
    stream = null
    streamBytes = 0
    // Writes are dropped until the old handle is fully closed and the files are shifted.
    // The shift waits for 'close' (not the end() callback / 'finish'), because the rename
    // needs the handle released - a hard requirement on Windows - and trace is best-effort
    // by contract, so the drop window is acceptable.
    old.end()
    old.on('close', () => {
        try { shiftRotated() } catch { /* rotation is best effort */ }
        rotating = false
    })
}

const getStream = () => {
    if (stream) return stream
    if (rotating) return null
    try {
        fs.mkdirSync(path.dirname(TRACE_FILE), { recursive: true })
        // Pre-open rotation: an oversized file left by a previous run rotates before any
        // handle exists, so the rename is always safe. Seed the byte counter with the
        // existing size so the active file stays bounded by max + one line.
        let size = 0
        try { size = fs.statSync(TRACE_FILE).size } catch { /* missing file = fresh start */ }
        if (size >= TRACE_MAX_BYTES) {
            shiftRotated()
            size = 0
        }
        streamBytes = size
        const created = fs.createWriteStream(TRACE_FILE, { flags: 'a' })
        created.on('error', () => {
            // Trace must never crash the server (ENOSPC, EPERM, ...): drop the dead
            // stream; the next trace() call opens a fresh one.
            if (stream === created) {
                stream = null
                streamBytes = 0
            }
        })
        stream = created
    } catch {
        return null
    }
    return stream
}

const writeLine = (obj) => {
    const s = getStream()
    if (!s) return
    try {
        const line = JSON.stringify(obj) + '\n'
        s.write(line)
        streamBytes += Buffer.byteLength(line)
        if (streamBytes >= TRACE_MAX_BYTES) rotate()
    } catch {
        /* never throw from a trace */
    }
}

export const traceEnabled = () => ENABLED

export const keyTag = (s) => (s && typeof s === 'string' ? createHash('sha256').update(s).digest('hex').slice(0, 8) : 'none')

export function trace(scope, event, data = {}) {
    if (!ENABLED) return
    writeLine({ t: new Date().toISOString(), src: 'server', scope, event, ...data })
}

export async function traced(scope, name, fields, fn) {    const start = Date.now()
    trace(scope, `${name}.start`, fields)
    try {
        const result = await fn()
        trace(scope, `${name}.success`, { ...fields, timing: Date.now() - start })
        return result
    } catch (err) {
        trace(scope, `${name}.error`, { ...fields, error: err?.message, status: err?.status, isAuthError: !!err?.isAuthError, timing: Date.now() - start })
        throw err
    }
}

export function traceClientBatch(entries) {
    if (!ENABLED || !Array.isArray(entries)) return
    for (const e of entries.slice(0, CLIENT_BATCH_MAX)) {
        writeLine({ src: 'client', ...e })
    }
}
