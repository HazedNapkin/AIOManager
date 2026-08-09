import db from '../db.js'

const MAX_ENTRIES = 10_000
const MAX_BYTES = 100 * 1024 * 1024
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
const PERMANENT_TTL = 10 * 365 * 24 * 60 * 60 * 1000

let logger = console

export function setLogger(instance) {
    logger = instance || console
}

export function jitteredTtl(baseTtl) {
    if (!Number.isFinite(baseTtl) || baseTtl <= 0) return baseTtl
    const offset = (Math.random() * 2 - 1) * baseTtl * 0.1
    return Math.max(1, Math.round(baseTtl + offset))
}

class LruEntry {
    constructor(value, expiresAt, bytes) {
        this.value = value
        this.expiresAt = expiresAt
        this.bytes = bytes
    }
}

class MetadataCache {
    constructor() {
        this.l1 = new Map()
        this.l1Bytes = 0
        this.pendingRequests = new Map()
        this.cleanupTimer = null
        this.stats = {
            l1_evictions_total: 0,
            dedup_hits_total: 0,
            l1_hits_total: 0,
            l2_hits_total: 0,
            misses_total: 0,
            db_inserts_total: 0,
            db_deletes_total: 0,
            db_updates_total: 0,
            stale_served_total: 0,
            last_cleanup_deleted: 0,
            last_cleanup_at: 0,
        }
    }

    _now() {
        return Date.now()
    }

    _byteSize(value) {
        if (value == null) return 0
        if (typeof value === 'string') return Buffer.byteLength(value, 'utf8')
        try {
            return Buffer.byteLength(JSON.stringify(value), 'utf8')
        } catch {
            return 1024
        }
    }

    _evictOne() {
        const oldestKey = this.l1.keys().next().value
        if (oldestKey === undefined) return
        const entry = this.l1.get(oldestKey)
        if (entry) this.l1Bytes -= entry.bytes
        this.l1.delete(oldestKey)
        this.stats.l1_evictions_total++
    }

    _enforceLruLimits() {
        while (this.l1.size > MAX_ENTRIES) this._evictOne()
        while (this.l1Bytes > MAX_BYTES && this.l1.size > 0) this._evictOne()
    }

    _setL1(key, value, expiresAt) {
        const bytes = this._byteSize(value)
        const existing = this.l1.get(key)
        if (existing) this.l1Bytes -= existing.bytes
        this.l1.delete(key)
        this.l1.set(key, new LruEntry(value, expiresAt, bytes))
        this.l1Bytes += bytes
        this._enforceLruLimits()
    }

    _getL1(key, now) {
        const entry = this.l1.get(key)
        if (!entry) return null
        if (entry.expiresAt && entry.expiresAt < now) {
            this.l1Bytes -= entry.bytes
            this.l1.delete(key)
            return null
        }
        this.l1.delete(key)
        this.l1.set(key, entry)
        return entry.value
    }

    async _getL2(key, now) {
        try {
            const row = await db.get(
                'SELECT response, expires_at FROM metadata_cache WHERE key = $1',
                [key]
            )
            if (!row) return null
            const expiresAt = Number(row.expires_at)
            const raw = row.response
            if (!raw || typeof raw !== 'string') {
                await this._deleteL2Row(key).catch(() => {})
                return null
            }
            let parsed
            try {
                parsed = JSON.parse(raw)
            } catch {
                await this._deleteL2Row(key).catch(() => {})
                return null
            }
            if (expiresAt && expiresAt < now) {
                return { expired: true, value: parsed, expiresAt }
            }
            return { expired: false, value: parsed, expiresAt }
        } catch (err) {
            logger.warn && logger.warn(`[MetadataCache] L2 read failed for key prefix=${key.split(':')[0]}: ${err && err.message}`)
            return null
        }
    }

    async _deleteL2Row(key) {
        try {
            const res = await db.run(
                'DELETE FROM metadata_cache WHERE key = $1',
                [key]
            )
            this.stats.db_deletes_total += Number(res?.changes || 0)
        } catch (err) {
            logger.warn && logger.warn(`[MetadataCache] L2 delete failed: ${err && err.message}`)
        }
    }

    async _insertL2(key, responseText, expiresAt, now) {
        try {
            if (db.type === 'postgres') {
                await db.run(
                    `INSERT INTO metadata_cache (key, response, expires_at, created_at)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (key) DO UPDATE SET
                       expires_at = EXCLUDED.expires_at,
                       created_at = EXCLUDED.created_at,
                       response = CASE WHEN metadata_cache.response IS DISTINCT FROM EXCLUDED.response
                         THEN EXCLUDED.response ELSE metadata_cache.response END`,
                    [key, responseText, expiresAt, now]
                )
            } else {
                await db.run(
                    `INSERT INTO metadata_cache (key, response, expires_at, created_at)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT(key) DO UPDATE SET
                       expires_at = excluded.expires_at,
                       created_at = excluded.created_at,
                       response = CASE WHEN response IS NOT excluded.response
                         THEN excluded.response ELSE response END`,
                    [key, responseText, expiresAt, now]
                )
            }
            this.stats.db_inserts_total++
        } catch (err) {
            logger.warn && logger.warn(`[MetadataCache] L2 insert failed: ${err && err.message}`)
        }
    }

    async get(key, fetcher, options = {}) {
        if (typeof key !== 'string' || !key) {
            throw new Error('MetadataCache.get requires a non-empty string key')
        }
        if (typeof fetcher !== 'function') {
            throw new Error('MetadataCache.get requires a fetcher function')
        }
        const now = this._now()
        const ttl = Number.isFinite(options.ttl) && options.ttl > 0 ? options.ttl : 0
        const permanent = options.permanent === true
        const baseTtl = permanent ? PERMANENT_TTL : ttl
        const expiresAt = baseTtl > 0 ? now + jitteredTtl(baseTtl) : 0

        const l1Hit = this._getL1(key, now)
        if (l1Hit !== null) {
            this.stats.l1_hits_total++
            return { value: l1Hit, source: 'l1', stale: false }
        }

        const l2Result = await this._getL2(key, now)
        if (l2Result && !l2Result.expired) {
            this.stats.l2_hits_total++
            this._setL1(key, l2Result.value, l2Result.expiresAt || (now + jitteredTtl(baseTtl)))
            return { value: l2Result.value, source: 'l2', stale: false }
        }

        const pending = this.pendingRequests.get(key)
        if (pending) {
            this.stats.dedup_hits_total++
            const value = await pending
            return { value, source: 'dedup', stale: false }
        }

        this.stats.misses_total++

        const promise = (async () => {
            try {
                const fetched = await fetcher()
                if (fetched === undefined || fetched === null) {
                    throw new Error('Fetcher returned empty value')
                }
                const expiresAtForStore = expiresAt || (now + jitteredTtl(PERMANENT_TTL))
                const responseText = typeof fetched === 'string' ? fetched : JSON.stringify(fetched)
                const storedValue = typeof fetched === 'string' ? JSON.parse(fetched) : fetched
                this._setL1(key, storedValue, expiresAtForStore)
                await this._insertL2(key, responseText, expiresAtForStore, now)
                return storedValue
            } catch (err) {
                if (l2Result && l2Result.expired && l2Result.value !== undefined) {
                    this.stats.stale_served_total++
                    this._setL1(key, l2Result.value, now + jitteredTtl(60 * 1000))
                    return { ...((l2Result.value && typeof l2Result.value === 'object') ? l2Result.value : {}), _stale: true }
                }
                throw err
            }
        })()

        this.pendingRequests.set(key, promise)
        try {
            const value = await promise
            return { value, source: 'miss', stale: false }
        } finally {
            this.pendingRequests.delete(key)
        }
    }

    async _l2ExpiresAt(key, now, fallbackBaseTtl) {
        try {
            const row = await db.get('SELECT expires_at FROM metadata_cache WHERE key = $1', [key])
            const exp = Number(row?.expires_at || 0)
            if (exp > now) return exp
            return now + jitteredTtl(fallbackBaseTtl || PERMANENT_TTL)
        } catch {
            return now + jitteredTtl(fallbackBaseTtl || PERMANENT_TTL)
        }
    }

    async cleanupExpired() {
        const now = this._now()
        try {
            const res = await db.run(
                'DELETE FROM metadata_cache WHERE expires_at < $1',
                [now]
            )
            const deleted = Number(res?.changes || 0)
            this.stats.db_deletes_total += deleted
            this.stats.last_cleanup_deleted = deleted
            this.stats.last_cleanup_at = now
            return deleted
        } catch (err) {
            logger.warn && logger.warn(`[MetadataCache] cleanup failed: ${err && err.message}`)
            return 0
        }
    }

    startCleanupJob() {
        if (this.cleanupTimer) return
        const run = async () => {
            try {
                await this.cleanupExpired()
            } catch (err) {
                logger.warn && logger.warn(`[MetadataCache] cleanup job error: ${err && err.message}`)
            }
        }
        this.cleanupTimer = setInterval(run, CLEANUP_INTERVAL_MS)
        if (this.cleanupTimer.unref) this.cleanupTimer.unref()
    }

    stopCleanupJob() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer)
            this.cleanupTimer = null
        }
    }

    clearL1() {
        this.l1.clear()
        this.l1Bytes = 0
    }

    async countL2Expired(now = this._now()) {
        try {
            const row = await db.get('SELECT COUNT(*) AS c FROM metadata_cache WHERE expires_at < $1', [now])
            return Number(row?.c || 0)
        } catch {
            return 0
        }
    }

    async countL2() {
        try {
            const row = await db.get('SELECT COUNT(*) AS c FROM metadata_cache')
            return Number(row?.c || 0)
        } catch {
            return 0
        }
    }

    async getStats() {
        const now = this._now()
        const l2Rows = await this.countL2()
        const l2ExpiredPending = await this.countL2Expired(now)
        const totalHits = this.stats.l1_hits_total + this.stats.l2_hits_total + this.stats.dedup_hits_total
        const totalLookups = totalHits + this.stats.misses_total
        const hitRate = totalLookups > 0 ? (totalHits / totalLookups) * 100 : 0
        const l1Utilization = (this.l1.size / MAX_ENTRIES) * 100

        const stats = {
            l1_entries: this.l1.size,
            l1_max_entries: MAX_ENTRIES,
            l1_bytes: this.l1Bytes,
            l1_max_bytes: MAX_BYTES,
            l1_utilization_pct: Math.round(l1Utilization * 100) / 100,
            l1_evictions_total: this.stats.l1_evictions_total,
            l2_rows: l2Rows,
            l2_expired_pending: l2ExpiredPending,
            pending_requests: this.pendingRequests.size,
            dedup_hits_total: this.stats.dedup_hits_total,
            l1_hits_total: this.stats.l1_hits_total,
            l2_hits_total: this.stats.l2_hits_total,
            misses_total: this.stats.misses_total,
            stale_served_total: this.stats.stale_served_total,
            overall_hit_rate_pct: Math.round(hitRate * 100) / 100,
            db_inserts_total: this.stats.db_inserts_total,
            db_deletes_total: this.stats.db_deletes_total,
            db_updates_total: this.stats.db_updates_total,
            last_cleanup_deleted: this.stats.last_cleanup_deleted,
            last_cleanup_at: this.stats.last_cleanup_at,
        }

        this._runAssertions(stats)
        return stats
    }

    _runAssertions(stats) {
        if (stats.l1_utilization_pct > 90) {
            logger.warn && logger.warn(`[MetadataCache] L1 cache near capacity: ${stats.l1_utilization_pct}%`)
        }
        if (stats.pending_requests > 50) {
            logger.warn && logger.warn(`[MetadataCache] pendingRequests unusually large: ${stats.pending_requests}`)
        }
        if (stats.l2_expired_pending > 1000) {
            logger.warn && logger.warn(`[MetadataCache] cache cleanup overdue: ${stats.l2_expired_pending} expired rows`)
        }
        if (stats.overall_hit_rate_pct < 50 && stats.l2_rows > 1000) {
            logger.warn && logger.warn(`[MetadataCache] cache hit rate below 50%: ${stats.overall_hit_rate_pct}%`)
        }
    }
}

const metadataCache = new MetadataCache()

export { metadataCache, MetadataCache, MAX_ENTRIES, MAX_BYTES, PERMANENT_TTL }
export default metadataCache
