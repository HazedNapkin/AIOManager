import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import db from '../db.js'
import { setupTestEnv, cleanupTestEnv, mockFetch, encryptForTest } from './helpers.js'
import { registerProviderRoutes } from '../routes/providers.js'
import { registerSyncRoutes } from '../routes/sync.js'
import { createReconciler } from '../providers/reconciler.js'
import { hashSyncPassword } from '../lib/sync-password.js'
import { hashApiKey } from '../api-keys.js'
import { decrypt } from '../crypto.js'
import { FALLBACK_KEYS } from '../keys.js'

// Failover-decision regressions for the connection cache: enforcement and
// resolution must never serve stale credentials, connection writes from any
// writer path must reach the next resolution, and API keys stay bound to the
// sync user that registered them first.

let app, reconciler
const USER = 'decision-user'
const PW = 'pw-decision'

before(async () => {
    app = await setupTestEnv()
    registerProviderRoutes(app, {})
    registerSyncRoutes(app)
    reconciler = createReconciler(app)
    await app.ready()
    await db.run(`INSERT INTO kv_store (key, value, password, updated_at, credential_epoch) VALUES ($1, 'seed', $2, $3, 1)`,
        [USER, await hashSyncPassword(PW), Date.now()])
})

after(() => cleanupTestEnv())

const inject = (method, url, payload) => app.inject({
    method, url,
    headers: { 'x-sync-user': USER, 'x-sync-password': PW },
    ...(payload !== undefined ? { payload } : {}),
})

function seedCred(connId, bundle) {
    return db.run(
        `INSERT INTO server_credentials (id, sync_user, account_id, auth_key, connection_id, credential_type, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'nuvio', $6)`,
        [`nuvio:${USER}:${connId}`, USER, USER, encryptForTest(JSON.stringify(bundle)), connId, Date.now()]
    )
}

async function storedBundle(connId) {
    const row = await db.get('SELECT auth_key FROM server_credentials WHERE sync_user = $1 AND connection_id = $2', [USER, connId])
    return JSON.parse(decrypt(row.auth_key, FALLBACK_KEYS))
}

test('rotation mid-cycle self-heals: resolution after a token refresh serves rotated credentials', async () => {
    const conn = 'rotate-conn'
    await seedCred(conn, { accessToken: 'at-v1', refreshToken: 'rt-v1', expiresAt: Date.now() - 1000 })

    const first = await reconciler.resolveConnections(USER, USER)
    assert.equal(first.length, 1)
    assert.equal(first[0].credentials.refreshToken, 'rt-v1')

    const restore = mockFetch(() => new Response(JSON.stringify({ access_token: 'at-v2', refresh_token: 'rt-v2', expires_at: Math.floor(Date.now() / 1000) + 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }))
    try {
        const res = await inject('POST', `/api/providers/connections/${conn}/token`, { accountId: USER, platform: 'nuvio' })
        assert.equal(res.statusCode, 200, res.body)
    } finally {
        restore.restore()
    }

    const after = await reconciler.resolveConnections(USER, USER)
    assert.equal(after[0].credentials.refreshToken, 'rt-v2', 'resolution must serve the rotated credentials, not a cached stale view')
})

test('credential PUT invalidates the cached view: a new connection appears on the next resolution', async () => {
    const first = await reconciler.resolveConnections(USER, USER)
    assert.equal(first.filter(c => c.id === 'writer-conn').length, 0)

    const res = await inject('POST', '/api/providers/connections/writer-conn/credentials', {
        accountId: USER, credentialType: 'nuvio', credential: { accessToken: 'w-at', refreshToken: 'w-rt', expiresAt: Date.now() + 86400000 },
    })
    assert.equal(res.statusCode, 200, res.body)

    const after = await reconciler.resolveConnections(USER, USER)
    assert.equal(after.filter(c => c.id === 'writer-conn').length, 1, 'a stored connection must be visible to the next resolution')
})

test('a sync push carrying an API key owned by another user succeeds without claiming it', async () => {
    // Mirror the legacy production schema: single-column UNIQUE(api_key_hash), which made
    // this exact push 500 before the collision handling existed.
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_legacy_single_hash ON account_api_keys (api_key_hash)')
    try {
        await db.run(
            `INSERT INTO account_api_keys (account_id, sync_user, api_key_hash, created_at) VALUES ($1, $2, $3, $4)`,
            ['other-acct', 'other-user', hashApiKey('foreign-key-value'), Date.now()]
        )

        const res = await inject('POST', `/api/sync/${USER}`, {
            syncedAt: Date.now(),
            data: { state: 'key-collision', apiKeys: { userAcct: 'foreign-key-value' } },
        })
        assert.equal(res.statusCode, 200, `push must survive the collision: ${res.body}`)

        const rows = await db.query(`SELECT sync_user FROM account_api_keys WHERE api_key_hash = $1`, [hashApiKey('foreign-key-value')])
        assert.equal(rows.length, 1, 'exactly one registration')
        assert.equal(rows[0].sync_user, 'other-user', 'the key stays bound to its original owner')
    } finally {
        await db.exec('DROP INDEX IF EXISTS idx_legacy_single_hash')
        await db.run('DELETE FROM account_api_keys WHERE sync_user = $1', [USER])
    }
})
