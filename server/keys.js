import fs from 'fs'
import { generateRandomKey } from './crypto.js'
import { SECRET_FILE, isReadOnlyReplica } from './config.js'

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
            if (isReadOnlyReplica()) {
                fastify.log.warn({ category: 'Security' }, 'READ_ONLY_REPLICA generated a NEW encryption key because none was found. Replicated data was encrypted with the PRIMARY key and will NOT decrypt with this one, so configs and addons will be empty. Set ENCRYPTION_KEY to the primary value (or copy the primary server_secret.key into this data dir) and restart.')
            } else {
                fastify.log.info({ category: 'Security' }, 'No ENCRYPTION_KEY found. Generated a new random key and saved it to data directory.')
            }
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
