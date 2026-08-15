import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import pinoPretty from 'pino-pretty'
import { env } from './lib/env.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))

export const VERSION = pkg.build ? `${pkg.version} (Build ${pkg.build})` : pkg.version
// Validated + coerced by the schema in lib/env.js; invalid values exit the process at import time.
export const PORT = env.PORT
export const DATA_DIR = env.DATA_DIR
export const PROXY_CONCURRENCY_LIMIT = env.PROXY_CONCURRENCY_LIMIT
export const MAX_QUEUE_SIZE = 500
export const MAX_QUEUE_PER_KEY = 30
export const DOMAIN_THROTTLE_MS = 200
export const IMAGE_PROXY_TIMEOUT_MS = env.IMAGE_PROXY_TIMEOUT_MS
export const IMAGE_PROXY_QUEUE_LIMIT = env.IMAGE_PROXY_QUEUE_LIMIT
export const IMAGE_PROXY_THROTTLE_MS = env.IMAGE_PROXY_THROTTLE_MS
export const IMAGE_CACHE_TTL_MS = env.IMAGE_CACHE_TTL_MS
export const IMAGE_CACHE_MAX_BYTES = env.IMAGE_CACHE_MAX_BYTES
export const IMAGE_CACHE_MAX_ITEM_BYTES = env.IMAGE_CACHE_MAX_ITEM_BYTES
export const AIOSTREAMS_USER_API_THROTTLE_MS = env.AIOSTREAMS_USER_API_THROTTLE_MS
export const STREMIO_API = 'https://api.strem.io/api'
// These three read process.env live on purpose: tests and ops tooling toggle
// them after import. lib/env.js still validates them at boot when present.
export const isUnifiedEnforcement = () => ['1', 'true', 'yes', 'on'].includes(String(process.env.UNIFIED_ENFORCEMENT || '').toLowerCase())
export const isRegistrationsClosed = () => ['1', 'true', 'yes', 'on'].includes(String(process.env.REGISTRATIONS_CLOSED || '').toLowerCase())
export const isReadOnlyReplica = () => ['1', 'true', 'yes', 'on'].includes(String(process.env.READ_ONLY_REPLICA || '').toLowerCase())
export const SECRET_FILE = path.join(DATA_DIR, 'server_secret.key')
export const distPath = path.join(__dirname, '../dist')
export const corsOrigins = env.CORS_ORIGINS

const prettyStream = pinoPretty({
    colorize: true,
    translateTime: 'HH:MM:ss',
    ignore: 'pid,hostname,level,category',
    singleLine: true,
    messageFormat: (log, messageKey) => {
        const levelEmoji = log.level === 30 ? '🔵' : log.level === 40 ? '⚠️' : log.level >= 50 ? '❌' : '📝'
        const levelText = log.level === 30 ? 'INFO ' : log.level === 40 ? 'WARN ' : log.level >= 50 ? 'ERROR' : 'LOG  '
        const categoryMap = {
            'Database': '🗄️ DB   ',
            'Server': '💻 SRV  ',
            'Sync': '🔄 SYNC ',
            'MetaProxy': '🌐 PROXY',
            'Proxy': '🌐 PROXY',
            'Security': '🛡️ SEC  ',
            'Addon Health': '🩺 HLTH '
        }
        const category = categoryMap[log.category] || (log.category ? `📦 ${log.category.padEnd(6)}` : '🚀 MAIN ')

        return `${levelEmoji} ${levelText} | ${category} | ${log[messageKey]}`
    }
})

const filteredStream = {
    write: (chunk) => {
        if (typeof chunk === 'string' && chunk.includes('premature close')) return true
        return prettyStream.write(chunk)
    }
}

export const loggerConfig = env.LOG_PRETTY_PRINT ? {
    level: env.LOG_LEVEL,
    stream: filteredStream
} : { level: env.LOG_LEVEL }

export function ensureDataDirectory(fastify) {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
        fastify.log.info({ category: 'Server' }, `Data directory not found, creating: ${DATA_DIR}`)
    }
}
