import fs from 'fs'
import path from 'path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'url'

const ENABLED = ['1', 'true', 'yes', 'on'].includes((process.env.AIOMAN_TRACE ?? '').toLowerCase())
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TRACE_FILE = path.resolve(process.env.DATA_DIR || './data', 'trace.log')

let stream = null
const getStream = () => {
    if (stream) return stream
    try {
        fs.mkdirSync(path.dirname(TRACE_FILE), { recursive: true })
        stream = fs.createWriteStream(TRACE_FILE, { flags: 'a' })
    } catch {
        return null
    }
    return stream
}

export const traceEnabled = () => ENABLED

export const keyTag = (s) => (s && typeof s === 'string' ? createHash('sha256').update(s).digest('hex').slice(0, 8) : 'none')

export function trace(scope, event, data = {}) {
    if (!ENABLED) return
    const s = getStream()
    if (!s) return
    try {
        s.write(JSON.stringify({ t: new Date().toISOString(), src: 'server', scope, event, ...data }) + '\n')
    } catch {
        /* never throw from a trace */
    }
}

export function traceClientBatch(entries) {
    if (!ENABLED || !Array.isArray(entries)) return
    const s = getStream()
    if (!s) return
    for (const e of entries) {
        try {
            s.write(JSON.stringify({ src: 'client', ...e }) + '\n')
        } catch {
            /* ignore one bad line */
        }
    }
}
