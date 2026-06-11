import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import pinoPretty from 'pino-pretty'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))

export const VERSION = pkg.build ? `${pkg.version} (Build ${pkg.build})` : pkg.version
export const PORT = process.env.PORT || 1610
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
export const PROXY_CONCURRENCY_LIMIT = parseInt(process.env.PROXY_CONCURRENCY_LIMIT || '50')
export const MAX_QUEUE_SIZE = 500
export const MAX_QUEUE_PER_KEY = 30
export const DOMAIN_THROTTLE_MS = 200
export const AIOSTREAMS_USER_API_THROTTLE_MS = Math.max(200, parseInt(process.env.AIOSTREAMS_USER_API_THROTTLE_MS || '1000') || 1000)
export const STREMIO_API = 'https://api.strem.io/api'
export const isUnifiedEnforcement = () => ['1', 'true', 'yes', 'on'].includes(String(process.env.UNIFIED_ENFORCEMENT || '').toLowerCase())
export const SECRET_FILE = path.join(DATA_DIR, 'server_secret.key')
export const distPath = path.join(__dirname, '../dist')
export const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173']

export const loggerConfig = process.env.LOG_PRETTY_PRINT !== 'false' ? {
    stream: pinoPretty({
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
} : true

export function ensureDataDirectory(fastify) {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
        fastify.log.info({ category: 'Server' }, `Data directory not found, creating: ${DATA_DIR}`)
    }
}
