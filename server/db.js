import Database from 'better-sqlite3'
import pg from 'pg'
const { Pool, types } = pg

types.setTypeParser(types.builtins.INT8, (val) => parseInt(val, 10))

let _sqliteTxQueue = Promise.resolve()

const SQLITE_STMT_CACHE_MAX = 500

class DB {
    constructor() {
        this.type = process.env.DB_TYPE || 'sqlite'
        this.client = null
        this.pool = null
        this.isHealthy = false
        this._stmtCache = new Map()
    }

    _prepare(sql) {
        const sqliteSql = sql.replace(/\$\d+/g, '?')
        let stmt = this._stmtCache.get(sqliteSql)
        if (!stmt) {
            stmt = this.client.prepare(sqliteSql)
            this._stmtCache.set(sqliteSql, stmt)
            if (this._stmtCache.size > SQLITE_STMT_CACHE_MAX) {
                const oldest = this._stmtCache.keys().next().value
                if (oldest !== undefined) this._stmtCache.delete(oldest)
            }
        }
        return stmt
    }

    async init() {
        if (this.type === 'postgres') {
            if (this.pool) return

            console.log('[Database] Connecting to PostgreSQL...')
            const connectionString = process.env.DATABASE_URL
            if (!connectionString) {
                throw new Error('[Database] DATABASE_URL is missing in .env but DB_TYPE is set to postgres')
            }

            const isLocalDb = connectionString.includes('localhost') ||
                connectionString.includes('127.0.0.1') ||
                connectionString.includes('@db:') ||
                connectionString.includes('aiomanager-db')
            const rejectUnauthorized = String(process.env.DB_SSL_REJECT_UNAUTHORIZED || 'false').toLowerCase() !== 'false'
            if (!isLocalDb && !rejectUnauthorized) {
                console.warn('[Database] PostgreSQL SSL certificate verification is disabled by DB_SSL_REJECT_UNAUTHORIZED=false.')
            }

            this.pool = new Pool({
                connectionString,
                ssl: isLocalDb ? false : { rejectUnauthorized },
                max: parseInt(process.env.DB_POOL_SIZE, 10) || 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT, 10) || 10000,
            })

            this.pool.on('error', (err) => {
                console.error('[Database] Unexpected pool error:', err.message)
                this.isHealthy = false
            })

            const maxRetries = parseInt(process.env.DB_MAX_RETRIES, 10) || 5
            let lastError = null

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    const client = await this.pool.connect()
                    client.release()
                    this.isHealthy = true
                    console.log('[Database] Connected to PostgreSQL.')
                    return
                } catch (err) {
                    lastError = err
                    const delay = Math.pow(2, attempt - 1) * 1000
                    console.warn(`[Database] Connection attempt ${attempt}/${maxRetries} failed: ${err.message}`)
                    if (attempt < maxRetries) {
                        console.log(`[Database] Retrying in ${delay / 1000}s...`)
                        await new Promise(resolve => setTimeout(resolve, delay))
                    }
                }
            }

            throw new Error(`[Database] Failed to connect after ${maxRetries} attempts: ${lastError?.message}`)
        } else {
            console.log('[Database] Using SQLite.')
            const dbPath = process.env.SQLITE_DB_PATH || 'data/aio.db'
            this.client = new Database(dbPath)
            this.isHealthy = true
        }
    }

    async healthCheck() {
        try {
            if (this.type === 'postgres') {
                if (!this.pool) return false
                const client = await this.pool.connect()
                try {
                    await client.query('SELECT 1')
                    this.isHealthy = true
                    return true
                } finally {
                    client.release()
                }
            } else {
                if (!this.client) return false
                this.client.prepare('SELECT 1').get()
                this.isHealthy = true
                return true
            }
        } catch (err) {
            console.error('[Database] Health check failed:', err.message)
            this.isHealthy = false
            return false
        }
    }

    async query(sql, params = []) {
        if (this.type === 'postgres') {
            const res = await this.pool.query(sql, params)
            return res.rows
        } else {
            return this._prepare(sql).all(params)
        }
    }

    async get(sql, params = []) {
        if (this.type === 'postgres') {
            const res = await this.pool.query(sql, params)
            return res.rows[0]
        } else {
            return this._prepare(sql).get(params)
        }
    }

    async run(sql, params = []) {
        if (this.type === 'postgres') {
            const res = await this.pool.query(sql, params)
            return { changes: res.rowCount }
        } else {
            const info = this._prepare(sql).run(params)
            return { changes: info.changes }
        }
    }

    async tx(fn) {
        if (this.type === 'postgres') {
            const client = await this.pool.connect()
            try {
                await client.query('BEGIN')
                const result = await fn({
                    query: (sql, params) => client.query(sql, params).then(r => r.rows),
                    get: (sql, params) => client.query(sql, params).then(r => r.rows[0]),
                    run: (sql, params) => client.query(sql, params).then(r => ({ changes: r.rowCount })),
                })
                await client.query('COMMIT')
                return result
            } catch (err) {
                await client.query('ROLLBACK').catch(() => {})
                throw err
            } finally {
                client.release()
            }
        } else {
            const run = async () => {
                this.client.exec('BEGIN')
                try {
                    const sqliteFns = {
                        query: (sql, params = []) => this._prepare(sql).all(params),
                        get: (sql, params = []) => this._prepare(sql).get(params),
                        run: (sql, params = []) => ({ changes: this._prepare(sql).run(params).changes }),
                    }
                    const result = await fn(sqliteFns)
                    this.client.exec('COMMIT')
                    return result
                } catch (err) {
                    try { this.client.exec('ROLLBACK') } catch {}
                    throw err
                }
            }
            const next = _sqliteTxQueue.then(run, run)
            _sqliteTxQueue = next.catch(() => {})
            return next
        }
    }

    async exec(sql) {
        if (this.type === 'postgres') {
            await this.pool.query(sql)
        } else {
            this.client.exec(sql)
        }
    }

    async pragma(sql) {
        if (this.type === 'sqlite') {
            return this.client.pragma(sql)
        }
        return null
    }

    async close() {
        if (this.type === 'postgres') {
            if (this.pool) {
                await this.pool.end()
                this.pool = null
            }
        } else {
            if (this.client) {
                this.client.close()
                this.client = null
            }
            this._stmtCache.clear()
        }
        this.isHealthy = false
    }
}

const db = new DB()
export default db
