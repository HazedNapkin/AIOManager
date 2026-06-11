import fs from 'fs'
import { generateRandomKey } from './crypto.js'
import { SECRET_FILE } from './config.js'

export let PRIMARY_KEY = process.env.ENCRYPTION_KEY
export let FALLBACK_KEYS = []
if (PRIMARY_KEY) FALLBACK_KEYS.push(PRIMARY_KEY)

export function initializeEncryptionKeys(fastify) {
    if (!PRIMARY_KEY) {
        if (fs.existsSync(SECRET_FILE)) {
            PRIMARY_KEY = fs.readFileSync(SECRET_FILE, 'utf8').trim()
            FALLBACK_KEYS = [PRIMARY_KEY]
            fastify.log.info({ category: 'Security' }, 'Loaded persistent encryption key from data directory.')
        } else {
            PRIMARY_KEY = generateRandomKey()
            fs.writeFileSync(SECRET_FILE, PRIMARY_KEY, { encoding: 'utf8', mode: 0o600 })
            FALLBACK_KEYS = [PRIMARY_KEY]
            fastify.log.info({ category: 'Security' }, 'No ENCRYPTION_KEY found. Generated a new random key and saved it to data directory.')
        }
    } else {
        fastify.log.info({ category: 'Security' }, 'Using ENCRYPTION_KEY from environment.')
        if (fs.existsSync(SECRET_FILE)) {
            const fileKey = fs.readFileSync(SECRET_FILE, 'utf8').trim()
            if (fileKey !== PRIMARY_KEY) {
                FALLBACK_KEYS.push(fileKey)
                fastify.log.warn({ category: 'Security' }, 'Detected encryption key mismatch between .env and data directory. Added old key to fallback list.')
            }
        }
    }
}
