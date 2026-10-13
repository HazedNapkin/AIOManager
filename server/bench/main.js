import Fastify from 'fastify'
import db from '../db.js'
import { initializeDatabase } from '../database/setup.js'
import { createReconciler } from '../providers/reconciler.js'
import { createAutopilotEngine } from '../autopilot/engine.js'
import { encrypt } from '../crypto.js'
import { FALLBACK_KEYS, initializeEncryptionKeys } from '../keys.js'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Performance bench for the two hot engines (autopilot scan + account reconcile).
// Runs real engine cycles against an in-memory database with platform endpoints
// mocked at the fetch layer, counts DB queries and outbound requests, and diffs
// against a committed baseline: any count that regresses fails the run.
// Counts are deterministic (all I/O is mocked); wall time is reported, never gated.

const here = dirname(fileURLToPath(import.meta.url))
const BASELINE_PATH = join(here, 'baseline.json')

const ACCOUNTS = 6
const RULES_PER_ACCOUNT = 2
const ADDONS_PER_LIST = 20
const CHAIN_SIZE = 3

const counts = { db: { total: 0, byTable: {} }, fetch: { total: 0, byKind: {} }, rowsWritten: 0 }
let errors = []

function tableOf(sql) {
    const m = String(sql).match(/(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)/i)
    return (m && m[1]) || 'other'
}

function countDb(op, sql) {
    counts.db.total++
    const t = tableOf(sql)
    counts.db.byTable[t] = counts.db.byTable[t] || {}
    counts.db.byTable[t][op] = (counts.db.byTable[t][op] || 0) + 1
    if (op === 'run' && /^\s*(INSERT|UPDATE|REPLACE|DELETE)/i.test(String(sql))) {
        counts.rowsWritten++
    }
}

function countFetch(url) {
    counts.fetch.total++
    const u = String(url)
    let kind = 'other'
    if (u.includes('/manifest')) kind = 'addon-manifest'
    else if (u.includes('/rest/v1/') || u.includes('/auth/v1/')) kind = 'nuvio-rpc'
    else if (u.includes('/api/collections/') || u.includes('/api/health')) kind = 'realstream'
    else if (u.includes('stremio') || u.includes('cinemeta')) kind = 'stremio-api'
    counts.fetch.byKind[kind] = (counts.fetch.byKind[kind] || 0) + 1
}

function instrumentDb() {
    for (const op of ['query', 'get', 'run']) {
        const orig = db[op].bind(db)
        db[op] = async (sql, params) => {
            countDb(op, sql)
            const t0 = performance.now()
            try {
                return await orig(sql, params)
            } finally {
                counts.db.ms = (counts.db.ms || 0) + (performance.now() - t0)
            }
        }
    }
}

const MANIFEST = { name: 'Bench Addon', id: 'bench.addon', version: '1.0.0', resources: ['catalog'], types: ['movie'], catalogs: [] }

function instrumentFetch() {
    const realFetch = globalThis.fetch
    globalThis.fetch = async (url) => {
        countFetch(url)
        const t0 = performance.now()
        const res = await realMockResponder(url)
        counts.fetch.ms = (counts.fetch.ms || 0) + (performance.now() - t0)
        return res
    }
    return () => { globalThis.fetch = realFetch }
}

async function realMockResponder(url) {
    const u = String(url)
    if (u.includes('/rest/v1/')) {
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (u.includes('/auth/v1/token')) {
        return new Response(JSON.stringify({ access_token: 'bench-at', refresh_token: 'bench-rt', expires_at: Math.floor(Date.now() / 1000) + 86400 }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (u.includes('/api/health')) {
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (u.includes('/api/collections/')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify(MANIFEST), { status: 200, headers: { 'content-type': 'application/json' } })
}

function bundle(platform, n) {
    if (platform === 'nuvio') {
        return { accessToken: `at-${n}`, refreshToken: `rt-${n}`, baseUrl: `http://bench-nuvio-${n}.local`, publishableKey: 'pk', expiresAt: Date.now() + 86400000 }
    }
    return { accessToken: `rs-at-${n}`, userId: `u${n}`, baseUrl: `http://bench-rs-${n}.local`, expiresAt: Date.now() + 86400000 }
}

function addon(i, chainUrls) {
    const url = chainUrls[i % chainUrls.length]
    return { url, transportUrl: url, name: `Addon ${i}`, enabled: true, flags: { enabled: true }, manifest: { name: `Addon ${i}`, id: `bench.${i}` } }
}

const CHAIN_URL = (a, r, i) => `http://bench-host-${a}-${r}-${i}/manifest.json`

async function seed() {
    const now = Date.now()
    for (let a = 0; a < ACCOUNTS; a++) {
        const accountId = `bench-acct-${a}`
        const syncUser = `bench-user-${a}`
        for (let c = 0; c < 2; c++) {
            const platform = c === 0 ? 'nuvio' : 'realstream'
            const connId = `bench-conn-${a}-${c}`
            await db.run(
                `INSERT INTO server_credentials (id, sync_user, account_id, account_name, auth_key, connection_id, credential_type, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [`${platform}:${accountId}:${connId}`, syncUser, accountId, `Bench Account ${a}`, encrypt(JSON.stringify(bundle(platform, a)), FALLBACK_KEYS[0]), connId, platform, now]
            )
        }
        for (let r = 0; r < RULES_PER_ACCOUNT; r++) {
            const ruleId = `bench-rule-${a}-${r}`
            const chainUrls = Array.from({ length: CHAIN_SIZE }, (_, i) => CHAIN_URL(a, r, i))
            const addonList = JSON.stringify(Array.from({ length: ADDONS_PER_LIST }, (_, i) => addon(i, chainUrls)))
            await db.run(
                `INSERT INTO autopilot_rules (id, account_id, priority_chain, addon_list, active_url, is_active, is_automatic, last_check, updated_at, name, owner_sync_user, platform, connection_id)
                 VALUES ($1, $2, $3, $4, $5, 1, 1, $6, $7, $8, $9, $10, $11)`,
                [ruleId, accountId, JSON.stringify(chainUrls), addonList, chainUrls[0], now - 3600000, now - 3600000, `Bench Rule ${a}-${r}`, syncUser, 'connection', r === 0 ? `bench-conn-${a}-0` : null]
            )
        }
    }
}

function accumulate(s) {
    return {
        dbQueries: s.db?.total ?? s.dbQueries ?? 0,
        outboundRequests: s.fetch?.total ?? s.outboundRequests ?? 0,
        rowsWritten: s.rowsWritten ?? 0,
        dbMs: s.db?.ms ?? s.dbMs ?? 0,
        fetchMs: s.fetch?.ms ?? s.fetchMs ?? 0,
    }
}

function parseDelay(key) {
    return parseInt(String(key).match(/(\d+)ms/)?.[1] || '0', 10)
}

async function runScenarios() {
    const app = Fastify({ logger: false })
    const noop = () => {}
    app.log = { info: noop, debug: noop, warn: (ctx, msg) => { errors.push(String(msg)) }, error: (ctx, msg) => { errors.push(String(msg)) } }
    await initializeDatabase(app)
    await initializeEncryptionKeys(app)

    const restoreFetch = instrumentFetch()
    instrumentDb()
    const timeoutCensus = new Map()
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = (fn, delay, ...args) => {
        if (Number(delay) >= 1) {
            const stack = (new Error().stack || '').split('\n').slice(2, 4).join(' | ').replace(/\s+/g, ' ').slice(0, 200)
            const key = `${delay}ms @ ${stack}`
            timeoutCensus.set(key, (timeoutCensus.get(key) || 0) + 1)
        }
        return realSetTimeout(fn, delay, ...args)
    }
    await seed()

    const reconciler = createReconciler(app)
    const engine = createAutopilotEngine(app, reconciler)

    const results = {}
    const run = async (name, fn) => {
        const before = accumulate(counts)
        const beforeTables = JSON.parse(JSON.stringify(counts.db.byTable))
        const beforeKinds = JSON.parse(JSON.stringify(counts.fetch.byKind))
        const start = Date.now()
        await fn()
        const deltas = accumulate(counts)
        const tableDelta = {}
        for (const [t, ops] of Object.entries(counts.db.byTable)) {
            const prevOps = beforeTables[t] || {}
            const d = {}
            for (const [op, n] of Object.entries(ops)) d[op] = n - (prevOps[op] || 0)
            if (Object.values(d).some(v => v > 0)) tableDelta[t] = d
        }
        const kindDelta = {}
        for (const [k, n] of Object.entries(counts.fetch.byKind)) {
            const d = n - (beforeKinds[k] || 0)
            if (d > 0) kindDelta[k] = d
        }
        results[name] = {
            dbQueries: deltas.dbQueries - before.dbQueries,
            outboundRequests: deltas.outboundRequests - before.outboundRequests,
            rowsWritten: deltas.rowsWritten - before.rowsWritten,
            dbMs: Math.round((counts.db.ms || 0) - (before.dbMs || 0)),
            fetchMs: Math.round((counts.fetch.ms || 0) - (before.fetchMs || 0)),
            dbByTable: tableDelta,
            outboundByKind: kindDelta,
            wallMs: Date.now() - start,
        }
    }

    await run('autopilot.cold', () => engine.runAutopilot())
    await db.run("UPDATE autopilot_rules SET last_check = $1", [Date.now() - 3600000])
    await run('autopilot.warm', () => engine.runAutopilot())
    await run('sync.reconcile', async () => {
        for (let a = 0; a < ACCOUNTS; a++) {
            const conns = await reconciler.resolveConnections(`bench-acct-${a}`, `bench-user-${a}`)
            const list = Array.from({ length: ADDONS_PER_LIST }, (_, i) => addon(i, [CHAIN_URL(a, 0, i % CHAIN_SIZE)]))
            await reconciler.reconcileAccount(`bench-acct-${a}`, `bench-user-${a}`, conns, list).catch(() => {})
        }
    })

    restoreFetch()
    globalThis.setTimeout = realSetTimeout

    results.setTimeouts = Object.fromEntries([...timeoutCensus.entries()].sort((a, b) => b[1] * parseDelay(b[0]) - a[1] * parseDelay(a[0])))

    const correctness = { oneActiveHolds: true, rulesActive: 0 }
    for (let a = 0; a < ACCOUNTS; a++) {
        for (let r = 0; r < RULES_PER_ACCOUNT; r++) {
            const row = await db.get('SELECT active_url, is_active FROM autopilot_rules WHERE id = $1', [`bench-rule-${a}-${r}`])
            if (!row) { correctness.oneActiveHolds = false; continue }
            if (row.is_active === 1) correctness.rulesActive++
        }
    }
    results.correctness = correctness
    results.errors = errors.slice(0, 10)

    return results
}

const gated = (r) => ({
    dbQueries: r.dbQueries,
    outboundRequests: r.outboundRequests,
    rowsWritten: r.rowsWritten,
})

export async function main() {
    const results = await runScenarios()

    if (process.argv.includes('--save')) {
        const baseline = {}
        for (const [name, r] of Object.entries(results)) {
            if (name === 'correctness' || name === 'errors' || name === 'setTimeouts') continue
            baseline[name] = gated(r)
        }
        writeFileSync(BASELINE_PATH, JSON.stringify({ scenarios: baseline }, null, 2) + '\n')
        console.log('baseline saved:')
        for (const [name, m] of Object.entries(baseline)) {
            console.log(`  ${name}: ${m.dbQueries} queries, ${m.outboundRequests} requests, ${m.rowsWritten} writes`)
        }
        process.exit(0)
    }

    console.log(JSON.stringify(results, null, 2))

    if (results.correctness?.oneActiveHolds !== true || (results.errors && results.errors.length > 0)) {
        console.error('\nBENCH CORRECTNESS FAILURE: state did not converge or errors were logged')
        console.error(results.errors)
        process.exit(1)
    }

    if (!existsSync(BASELINE_PATH)) {
        console.error('\nno baseline.json found. Run: npm --prefix server run bench -- --save')
        process.exit(1)
    }

    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).scenarios
    let failed = false
    console.log('\nratchet check (gated on queries / requests / writes):')
    for (const [name, base] of Object.entries(baseline)) {
        const cur = results[name]
        if (!cur) { console.error(`  ${name}: MISSING FROM BENCH RUN`); failed = true; continue }
        for (const metric of ['dbQueries', 'outboundRequests', 'rowsWritten']) {
            const b = base[metric]
            const c = gated(cur)[metric]
            const delta = c - b
            const mark = delta > 0 ? 'REGRESSION' : delta < 0 ? 'improved' : 'ok'
            if (delta > 0) failed = true
            console.log(`  ${name}.${metric}: ${b} -> ${c} (${mark})`)
        }
    }
    if (failed) {
        console.error('\nBENCH REGRESSION: counts above baseline. If the increase is intentional, re-run with --save and commit the new baseline.')
        process.exit(1)
    }
    console.log('\nall counts at or below baseline.')
    process.exit(0)
}
