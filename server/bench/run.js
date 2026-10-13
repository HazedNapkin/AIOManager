// Env must be set before any server module import: db.js opens its connection at
// import time and initializeDatabase repoints SQLITE_DB_PATH at DATA_DIR/aio.db,
// so the bench gets its own throwaway DATA_DIR instead of ever touching a real one.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'aiomanager-bench-'))
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'bench-encryption-key-32bytes!'
process.env.SSRF_ALLOW_PRIVATE = '1'
process.env.AIOMAN_TRACE = process.env.AIOMAN_TRACE || ''

const { main } = await import('./main.js')
main().catch(err => { console.error(err); process.exit(1) })
