import { createHash } from 'node:crypto'
import db from '../db.js'
import { encrypt, decrypt } from '../crypto.js'
import { PRIMARY_KEY, FALLBACK_KEYS } from '../keys.js'
import { verifyAuth } from '../auth.js'
import { isSafeUrlResolved } from '../utils/ssrf.js'
import { maskContext } from '../utils/log-helpers.js'
import { proxyQueue, proxyQueueKeyCounts, serverState } from '../state.js'

export function registerAutopilotRoutes(fastify, autopilotEngine) {
    async function upsertCredential(owner, accountId, accountName, encryptedAuthKey, credentialType = 'stremio', connectionId = null) {
        if (!encryptedAuthKey && !connectionId) return
        try {
            const credId = connectionId ? `${owner}:${connectionId}` : `${owner}:${accountId}`
            const now = Date.now()
            if (db.type === 'postgres') {
                await db.run(
                    `INSERT INTO server_credentials (id, sync_user, account_id, account_name, auth_key, updated_at, credential_type, connection_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     ON CONFLICT (id) DO UPDATE SET auth_key = EXCLUDED.auth_key, updated_at = EXCLUDED.updated_at, credential_type = EXCLUDED.credential_type, connection_id = EXCLUDED.connection_id`,
                    [credId, owner, accountId, accountName || '', encryptedAuthKey, now, credentialType, connectionId]
                )
            } else {
                await db.run(
                    `INSERT OR REPLACE INTO server_credentials (id, sync_user, account_id, account_name, auth_key, updated_at, credential_type, connection_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [credId, owner, accountId, accountName || '', encryptedAuthKey, now, credentialType, connectionId]
                )
            }
        } catch (credErr) {
            fastify.log.warn({ category: 'Autopilot' }, `Failed to upsert credential for ${maskContext(accountId)}: ${credErr.message}`)
        }
    }
    const { sendNotification, syncStremioLive, getRuleRuntimeState, clearRuleRuntimeState, clearAccountRuleRuntimeState } = autopilotEngine
    const ENFORCEMENT_DEBOUNCE_MS = 30_000
    const MAX_BATCH_STATE_ACCOUNTS = 500
    const enforcementDebounce = new Map()
    let lastDebouncePrune = 0

    const stableStringify = (value) => {
        if (value === undefined) return 'undefined'
        if (value === null || typeof value !== 'object') return JSON.stringify(value)
        if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

        return `{${Object.keys(value)
            .filter(key => value[key] !== undefined)
            .sort()
            .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
            .join(',')}}`
    }

    const plainJsonEqual = (left, right) =>
        stableStringify(left ?? null) === stableStringify(right ?? null)

    const isSafeAutopilotUrl = async (url) =>
        typeof url === 'string' && await isSafeUrlResolved(url.replace(/^stremio:\/\//i, 'https://'))

    const validateRulePayload = async ({ id, accountId, authKey, connectionId, priorityChain, activeUrl, addonList }) => {
        if (!id || !accountId || (!authKey && !connectionId) || !Array.isArray(priorityChain) || priorityChain.length === 0) {
            return 'Missing required Autopilot data'
        }
        const chainResults = await Promise.all(priorityChain.map(isSafeAutopilotUrl))
        if (!chainResults.every(Boolean)) return 'Priority chain contains an unsafe URL'
        if (activeUrl && !(await isSafeAutopilotUrl(activeUrl))) return 'Active URL is unsafe'
        if (addonList && Array.isArray(addonList) && addonList.length > 500) return 'Addon list exceeds maximum size (500)'
        return null
    }

    async function checkPlaintextEqual(existingRule, { authKey, priorityChain, addonList, activeUrl, webhookUrl, is_active, is_automatic, cooldown_ms, messageTemplate, name }) {
        if (!existingRule) return false
        const existingAuthKey = existingRule.auth_key ? decrypt(existingRule.auth_key, FALLBACK_KEYS) : ''
        const existingChainStr = existingRule.priority_chain ? decrypt(existingRule.priority_chain, FALLBACK_KEYS) : ''
        if (existingRule.priority_chain && !existingChainStr) throw new Error('Decryption failed')
        const existingChain = existingChainStr ? JSON.parse(existingChainStr) : []
        const existingAddonList = existingRule.addon_list ? JSON.parse(decrypt(existingRule.addon_list, FALLBACK_KEYS) || 'null') : null
        const existingActiveUrl = existingRule.active_url ? decrypt(existingRule.active_url, FALLBACK_KEYS) : null
        const existingWebhookUrl = existingRule.webhook_url ? decrypt(existingRule.webhook_url, FALLBACK_KEYS) : null

        return existingAuthKey === (authKey || '') &&
            JSON.stringify(existingChain) === JSON.stringify(priorityChain) &&
            JSON.stringify(existingAddonList) === JSON.stringify(addonList ?? null) &&
            (existingActiveUrl || null) === (activeUrl || null) &&
            (existingWebhookUrl || null) === (webhookUrl || null) &&
            !!existingRule.is_active === !!is_active &&
            !!existingRule.is_automatic === !!is_automatic &&
            (existingRule.cooldown_ms ?? null) === (cooldown_ms ?? null) &&
            (existingRule.message_template ?? null) === (messageTemplate ?? null) &&
            existingRule.name === name
    }

    async function upsertRuleRecord({ id, accountId, name, authKey, priorityChain, activeUrl, addonList, webhookUrl, is_active, is_automatic, cooldown_ms, messageTemplate, platform, connectionId }, existingRule, authUser) {
        const effectivePlatform = (platform || 'stremio').toLowerCase()
        const encryptedAuthKey = authKey ? encrypt(authKey, PRIMARY_KEY) : null
        const encryptedChain = encrypt(JSON.stringify(priorityChain), PRIMARY_KEY)
        const encryptedActiveUrl = activeUrl ? encrypt(activeUrl, PRIMARY_KEY) : null
        const encryptedAddonList = addonList ? encrypt(JSON.stringify(addonList), PRIMARY_KEY) : null
        const encryptedWebhookUrl = webhookUrl ? encrypt(webhookUrl, PRIMARY_KEY) : null
        const now = Date.now()
        const resolvedOwner = (existingRule?.owner_sync_user) || authUser

        if (db.type === 'postgres') {
            await db.run(`
                INSERT INTO autopilot_rules (id, account_id, name, auth_key, priority_chain, addon_list, active_url, webhook_url, is_active, is_automatic, updated_at, cooldown_ms, message_template, owner_sync_user, platform, connection_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    auth_key = EXCLUDED.auth_key,
                    priority_chain = EXCLUDED.priority_chain,
                    addon_list = EXCLUDED.addon_list,
                    active_url = EXCLUDED.active_url,
                    webhook_url = EXCLUDED.webhook_url,
                    is_active = EXCLUDED.is_active,
                    is_automatic = EXCLUDED.is_automatic,
                    updated_at = EXCLUDED.updated_at,
                    cooldown_ms = EXCLUDED.cooldown_ms,
                    message_template = EXCLUDED.message_template,
                    owner_sync_user = EXCLUDED.owner_sync_user,
                    platform = EXCLUDED.platform,
                    connection_id = EXCLUDED.connection_id
                WHERE
                    autopilot_rules.name IS DISTINCT FROM EXCLUDED.name OR
                    autopilot_rules.auth_key IS DISTINCT FROM EXCLUDED.auth_key OR
                    autopilot_rules.priority_chain IS DISTINCT FROM EXCLUDED.priority_chain OR
                    autopilot_rules.addon_list IS DISTINCT FROM EXCLUDED.addon_list OR
                    autopilot_rules.active_url IS DISTINCT FROM EXCLUDED.active_url OR
                    autopilot_rules.webhook_url IS DISTINCT FROM EXCLUDED.webhook_url OR
                    autopilot_rules.is_active IS DISTINCT FROM EXCLUDED.is_active OR
                    autopilot_rules.is_automatic IS DISTINCT FROM EXCLUDED.is_automatic OR
                    autopilot_rules.cooldown_ms IS DISTINCT FROM EXCLUDED.cooldown_ms OR
                    autopilot_rules.message_template IS DISTINCT FROM EXCLUDED.message_template OR
                    autopilot_rules.platform IS DISTINCT FROM EXCLUDED.platform OR
                    autopilot_rules.connection_id IS DISTINCT FROM EXCLUDED.connection_id
            `, [id, accountId, name, encryptedAuthKey, encryptedChain, encryptedAddonList, encryptedActiveUrl, encryptedWebhookUrl, is_active ? 1 : 0, is_automatic ? 1 : 0, now, cooldown_ms, messageTemplate || null, resolvedOwner, effectivePlatform, connectionId || null])
        } else {
            await db.run(`
                INSERT INTO autopilot_rules (id, account_id, name, auth_key, priority_chain, addon_list, active_url, webhook_url, is_active, is_automatic, updated_at, cooldown_ms, message_template, owner_sync_user, platform, connection_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    auth_key = excluded.auth_key,
                    priority_chain = excluded.priority_chain,
                    addon_list = excluded.addon_list,
                    active_url = excluded.active_url,
                    webhook_url = excluded.webhook_url,
                    is_active = excluded.is_active,
                    is_automatic = excluded.is_automatic,
                    updated_at = excluded.updated_at,
                    cooldown_ms = excluded.cooldown_ms,
                    message_template = excluded.message_template,
                    owner_sync_user = excluded.owner_sync_user,
                    platform = excluded.platform,
                    connection_id = excluded.connection_id
                WHERE
                    COALESCE(autopilot_rules.name, '') != COALESCE(excluded.name, '') OR
                    autopilot_rules.auth_key IS NOT excluded.auth_key OR
                    autopilot_rules.priority_chain != excluded.priority_chain OR
                    COALESCE(autopilot_rules.addon_list, '') != COALESCE(excluded.addon_list, '') OR
                    COALESCE(autopilot_rules.active_url, '') != COALESCE(excluded.active_url, '') OR
                    COALESCE(autopilot_rules.webhook_url, '') != COALESCE(excluded.webhook_url, '') OR
                    autopilot_rules.is_active != excluded.is_active OR
                    autopilot_rules.is_automatic != excluded.is_automatic OR
                    COALESCE(autopilot_rules.cooldown_ms, 0) != COALESCE(excluded.cooldown_ms, 0) OR
                    COALESCE(autopilot_rules.message_template, '') != COALESCE(excluded.message_template, '') OR
                    COALESCE(autopilot_rules.platform, 'stremio') != COALESCE(excluded.platform, 'stremio') OR
                    autopilot_rules.connection_id IS NOT excluded.connection_id
            `, [id, accountId, name, encryptedAuthKey, encryptedChain, encryptedAddonList, encryptedActiveUrl, encryptedWebhookUrl, is_active ? 1 : 0, is_automatic ? 1 : 0, now, cooldown_ms, messageTemplate || null, resolvedOwner, effectivePlatform, connectionId || null])
        }

        if (effectivePlatform === 'stremio' && encryptedAuthKey) {
            await upsertCredential(resolvedOwner, accountId, name, encryptedAuthKey, 'stremio', null)
        }
        return { resolvedOwner, encryptedAuthKey }
    }

    const hashEnforcementPayload = ({ authKey, safeChain, targetActiveUrl, storedAddons }) =>
        createHash('sha256')
            .update(stableStringify({ authKey, safeChain, targetActiveUrl, storedAddons }))
            .digest('hex')

    const pruneEnforcementDebounce = (now) => {
        if (now - lastDebouncePrune < ENFORCEMENT_DEBOUNCE_MS) return
        lastDebouncePrune = now

        for (const [ruleId, entry] of enforcementDebounce) {
            if (now - entry.timestamp >= ENFORCEMENT_DEBOUNCE_MS) {
                enforcementDebounce.delete(ruleId)
            }
        }
    }

    const shouldDebounceEnforcement = (ruleId, payloadHash) => {
        if (!ruleId) return false

        const now = Date.now()
        pruneEnforcementDebounce(now)

        const entry = enforcementDebounce.get(ruleId)
        if (entry?.payloadHash === payloadHash && now - entry.timestamp < ENFORCEMENT_DEBOUNCE_MS) {
            return true
        }

        enforcementDebounce.set(ruleId, { payloadHash, timestamp: now })
        return false
    }

    const clearDebouncedEnforcement = (ruleId, payloadHash) => {
        const entry = enforcementDebounce.get(ruleId)
        if (entry?.payloadHash === payloadHash) {
            enforcementDebounce.delete(ruleId)
        }
    }

    const parseStabilization = (value) => {
        if (!value) return {}
        try {
            return JSON.parse(decrypt(value, FALLBACK_KEYS) || '{}')
        } catch {
            return {}
        }
    }

    const buildAutopilotState = (rule) => {
        const runtime = getRuleRuntimeState?.(rule.id)
        return {
            id: rule.id,
            name: rule.name || null,
            cooldownMs: rule.cooldown_ms || null,
            priorityChain: rule.priority_chain ? JSON.parse(decrypt(rule.priority_chain, FALLBACK_KEYS) || '[]') : [],
            activeUrl: runtime?.activeUrl ?? (rule.active_url ? decrypt(rule.active_url, FALLBACK_KEYS) : null),
            webhookUrl: rule.webhook_url ? decrypt(rule.webhook_url, FALLBACK_KEYS) : '',
            isActive: rule.is_active === 1,
            isAutomatic: rule.is_automatic === 1,
            lastCheck: runtime?.lastCheck ?? rule.last_check,
            stabilization: runtime?.stabilization ?? parseStabilization(rule.stabilization)
        }
    }

    const buildAutopilotStates = (rules, context) => {
        const states = []
        let skippedCount = 0
        for (const rule of rules || []) {
            try {
                states.push(buildAutopilotState(rule))
            } catch (err) {
                skippedCount++
                fastify.log.warn({ category: 'Autopilot' }, `Skipped unreadable rule ${rule.id} for ${context}: ${err.message}`)
            }
        }
        const response = { states, lastWorkerRun: serverState.lastWorkerRun, lastCycle: serverState.autopilotLastCycleStats }
        if (skippedCount > 0) {
            response.partial = true
            response.skippedCount = skippedCount
        }
        return response
    }

    const loadStoredAddonList = async (id) => {
        try {
            const row = await db.get('SELECT addon_list FROM autopilot_rules WHERE id = $1', [id])
            if (!row?.addon_list) return null

            const decrypted = decrypt(row.addon_list, FALLBACK_KEYS)
            if (!decrypted) return null
            return JSON.parse(decrypted)
        } catch {
            return undefined
        }
    }

    const scheduleRuleEnforcement = async ({ id, accountId, authKey, connectionId, platform, ownerSyncUser, priorityChain, activeUrl, addonList, is_active, is_automatic }) => {
        if (!syncStremioLive || (!authKey && !connectionId) || is_active === 0 || is_active === false || is_automatic === 0 || is_automatic === false) return
        if (!Array.isArray(priorityChain) || priorityChain.length === 0) return

        const chainSafety = await Promise.all(priorityChain.map(isSafeAutopilotUrl))
        const safeChain = priorityChain.filter((_, i) => chainSafety[i])
        if (safeChain.length === 0) return

        const targetActiveUrl = (activeUrl && await isSafeAutopilotUrl(activeUrl)) ? activeUrl : safeChain[0]
        const storedAddons = Array.isArray(addonList) ? addonList : []
        const payloadHash = hashEnforcementPayload({ authKey: authKey || connectionId, safeChain, targetActiveUrl, storedAddons })
        if (shouldDebounceEnforcement(id, payloadHash)) return

        // Route sync is user initiated; enforce immediately so backups are hidden
        // without waiting for the next worker pass or a frontend refresh.
        Promise.resolve()
            .then(() => syncStremioLive({ authKey, platform: (platform || 'stremio').toLowerCase(), connectionId, accountId, ownerSyncUser }, safeChain, targetActiveUrl, accountId, id, storedAddons, false))
            .then(async (reconciledList) => {
                if (id && Array.isArray(reconciledList)) {
                    const storedAddonList = await loadStoredAddonList(id)
                    // encrypt() uses a random IV, so compare plaintext before touching TOAST-heavy addon_list.
                    if (plainJsonEqual(storedAddonList, reconciledList)) return

                    await db.run('UPDATE autopilot_rules SET addon_list = $1, updated_at = $2 WHERE id = $3', [
                        encrypt(JSON.stringify(reconciledList), PRIMARY_KEY),
                        Date.now(),
                        id
                    ])
                }
            })
            .catch(err => {
                clearDebouncedEnforcement(id, payloadHash)
                fastify.log.warn({ category: 'Autopilot' }, `[${maskContext(accountId)}] Immediate enforcement failed after rule sync: ${err.message}`)
            })
    }

    fastify.post('/api/autopilot/sync', { bodyLimit: 1024 * 100, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
        const { id, accountId, name, authKey, connectionId, platform, priorityChain, activeUrl, is_active, is_automatic, addonList, webhookUrl, cooldown_ms, messageTemplate } = request.body

        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const validationError = await validateRulePayload({ id, accountId, authKey, connectionId, priorityChain, activeUrl, addonList })
        if (validationError) {
            reply.status(400);
            return { error: validationError }
        }

        const existingRule = await db.get('SELECT auth_key, priority_chain, addon_list, active_url, webhook_url, is_active, is_automatic, cooldown_ms, message_template, name, owner_sync_user FROM autopilot_rules WHERE id = $1', [id])

        if (existingRule && existingRule.owner_sync_user && existingRule.owner_sync_user !== authUser) {
            reply.status(403);
            return { error: 'Forbidden: rule belongs to another user' }
        }
        if (existingRule && !existingRule.owner_sync_user) {
            reply.status(403);
            return { error: 'Forbidden: rule has no owner and cannot be modified' }
        }

        const rulePayload = { authKey, priorityChain, addonList, activeUrl, webhookUrl, is_active, is_automatic, cooldown_ms, messageTemplate, name }

        try {
            const isEqual = await checkPlaintextEqual(existingRule, rulePayload)
            if (isEqual) {
                fastify.log.info({ category: 'Autopilot' }, `[${maskContext(accountId)}] Rule unchanged, skipping write.`)
                if (authKey) {
                    const encryptedAuthKey = encrypt(authKey, PRIMARY_KEY)
                    await upsertCredential(existingRule.owner_sync_user || authUser, accountId, name, encryptedAuthKey, (platform || 'stremio').toLowerCase(), connectionId || null)
                }
                scheduleRuleEnforcement({ id, accountId, authKey, connectionId, platform, ownerSyncUser: existingRule.owner_sync_user || authUser, priorityChain, activeUrl, addonList, is_active, is_automatic })
                return { success: true, skipped: true }
            }
        } catch (cmpErr) {
            fastify.log.warn({ category: 'Autopilot' }, `[${maskContext(accountId)}] Plaintext comparison failed, falling back to upsert: ${cmpErr.message}`)
        }

        await upsertRuleRecord({ id, accountId, name, ...rulePayload, platform, connectionId }, existingRule, authUser)

        fastify.log.info({ category: 'Autopilot' }, `[${maskContext(accountId)}] Rule synced to server (Swap & Hide Mode).`)
        clearRuleRuntimeState?.(id)
        scheduleRuleEnforcement({ id, accountId, authKey, connectionId, platform, ownerSyncUser: authUser, priorityChain, activeUrl, addonList, is_active, is_automatic })
        return { success: true }
    })


    fastify.post('/api/autopilot/sync-batch', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
        const rules = request.body
        if (!Array.isArray(rules)) return reply.code(400).send({ error: 'Expected array' })
        if (rules.length > 100) return reply.code(400).send({ error: 'Batch too large. Maximum 100 rules per request.' })

        const authUser = await verifyAuth(request)
        if (!authUser) return reply.code(401).send({ error: 'Unauthorized' })

        const results = []
        for (const ruleData of rules) {
            if (!ruleData || typeof ruleData !== 'object') {
                results.push({ id: null, ok: false, error: 'Invalid rule payload' })
                continue
            }
            const { id, accountId, name, authKey, connectionId, platform, priorityChain, activeUrl, is_active, is_automatic, addonList, webhookUrl, cooldown_ms, messageTemplate } = ruleData

            const validationError = await validateRulePayload({ id, accountId, authKey, connectionId, priorityChain, activeUrl, addonList })
            if (validationError) {
                results.push({ id: id || null, ok: false, error: validationError })
                continue
            }

            try {
                const existingRule = await db.get('SELECT auth_key, priority_chain, addon_list, active_url, webhook_url, is_active, is_automatic, cooldown_ms, message_template, name, owner_sync_user FROM autopilot_rules WHERE id = $1', [id])

                if (existingRule && existingRule.owner_sync_user && existingRule.owner_sync_user !== authUser) {
                    results.push({ id, ok: false, error: 'Forbidden' })
                    continue
                }

                const rulePayload = { authKey, priorityChain, addonList, activeUrl, webhookUrl, is_active, is_automatic, cooldown_ms, messageTemplate, name }

                try {
                    const isEqual = await checkPlaintextEqual(existingRule, rulePayload)
                    if (isEqual) {
                        if (authKey) {
                            const encryptedAuthKey = encrypt(authKey, PRIMARY_KEY)
                            await upsertCredential(existingRule.owner_sync_user || authUser, accountId, name, encryptedAuthKey, (platform || 'stremio').toLowerCase(), connectionId || null)
                        }
                        scheduleRuleEnforcement({ id, accountId, authKey, connectionId, platform, ownerSyncUser: existingRule.owner_sync_user || authUser, priorityChain, activeUrl, addonList, is_active, is_automatic })
                        results.push({ id, ok: true, skipped: true })
                        continue
                    }
                } catch (cmpErr) {
                    fastify.log.warn({ category: 'Autopilot' }, `[${maskContext(accountId)}] Plaintext comparison failed, falling back to upsert: ${cmpErr.message}`)
                }

                await upsertRuleRecord({ id, accountId, name, ...rulePayload, platform, connectionId }, existingRule, authUser)

                results.push({ id, ok: true })
                clearRuleRuntimeState?.(id)
                scheduleRuleEnforcement({ id, accountId, authKey, connectionId, platform, ownerSyncUser: authUser, priorityChain, activeUrl, addonList, is_active, is_automatic })
            } catch (e) {
                fastify.log.error({ category: 'Autopilot' }, `[${maskContext(accountId || id)}] Batch sync failed: ${e.message}`)
                results.push({ id, ok: false, error: 'Unable to sync Autopilot rule' })
            }
        }

        return { results }
    })


    fastify.get('/api/autopilot/state/:accountId', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
        const { accountId } = request.params
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const ownerCheck = await db.get('SELECT 1 FROM autopilot_rules WHERE account_id = $1 AND owner_sync_user = $2 LIMIT 1', [accountId, authUser])
        if (!ownerCheck) {
            const hasRules = await db.get('SELECT 1 FROM autopilot_rules WHERE account_id = $1 LIMIT 1', [accountId])
            if (hasRules) { reply.status(403); return { error: 'Forbidden' } }
        }

        try {
            const rules = await db.query(`
                SELECT r.id, r.priority_chain, r.active_url, r.webhook_url, r.is_active, r.is_automatic,
                       COALESCE(s.last_check, r.last_check) AS last_check,
                       COALESCE(s.stabilization, r.stabilization) AS stabilization,
                       r.name, r.cooldown_ms
                FROM autopilot_rules r
                LEFT JOIN autopilot_rule_stats s ON s.rule_id = r.id
                WHERE r.account_id = $1
            `, [accountId])

            return buildAutopilotStates(rules, maskContext(accountId))
        } catch (err) {
            fastify.log.error({ category: 'Autopilot' }, `State fetch failed for ${maskContext(accountId)}: ${err.message}`)
            reply.status(500)
            return { error: 'Unable to load Autopilot state', lastWorkerRun: serverState.lastWorkerRun, lastCycle: serverState.autopilotLastCycleStats }
        }
    })

    fastify.post('/api/autopilot/active-rules', { bodyLimit: 1024 * 64, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const { accountId, activeRuleIds } = request.body || {}
        if (!accountId || !Array.isArray(activeRuleIds)) {
            reply.status(400); return { error: 'accountId and activeRuleIds required' }
        }

        const ids = activeRuleIds.filter(x => typeof x === 'string' && x)
        const now = Date.now()
        try {
            let result
            if (ids.length > 0) {
                const placeholders = ids.map((_, i) => `$${i + 4}`).join(',')
                result = await db.run(
                    `UPDATE autopilot_rules SET is_active = 0, updated_at = $1
                     WHERE account_id = $2 AND owner_sync_user = $3 AND is_active = 1 AND id NOT IN (${placeholders})`,
                    [now, accountId, authUser, ...ids]
                )
            } else {
                result = await db.run(
                    `UPDATE autopilot_rules SET is_active = 0, updated_at = $1
                     WHERE account_id = $2 AND owner_sync_user = $3 AND is_active = 1`,
                    [now, accountId, authUser]
                )
            }
            return { ok: true, deactivated: result?.changes ?? 0 }
        } catch (err) {
            fastify.log.error({ category: 'Autopilot' }, `active-rules prune failed for ${maskContext(accountId)}: ${err.message}`)
            reply.status(500); return { error: 'Failed to reconcile active rules' }
        }
    })

    fastify.get('/api/autopilot/history/:accountId', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
        const { accountId } = request.params
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const ownerCheck = await db.get('SELECT 1 FROM autopilot_rules WHERE account_id = $1 AND owner_sync_user = $2 LIMIT 1', [accountId, authUser])
        if (!ownerCheck) {
            const hasRules = await db.get('SELECT 1 FROM autopilot_rules WHERE account_id = $1 LIMIT 1', [accountId])
            if (hasRules) { reply.status(403); return { error: 'Forbidden' } }
        }

        const history = await db.query('SELECT * FROM failover_history WHERE account_id = $1 ORDER BY timestamp DESC LIMIT 10', [accountId])

        const decryptedHistory = (history || []).map(log => ({
            ...log,
            primary_name: log.primary_name ? decrypt(log.primary_name, FALLBACK_KEYS) : log.primary_name,
            backup_name: log.backup_name ? decrypt(log.backup_name, FALLBACK_KEYS) : log.backup_name,
            message: log.message ? decrypt(log.message, FALLBACK_KEYS) : log.message,
            metadata: log.metadata ? decrypt(log.metadata, FALLBACK_KEYS) : null
        }))

        return { history: decryptedHistory }
    })

    fastify.post('/api/autopilot/test-webhook', { bodyLimit: 1024 * 100, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
        const { webhookUrl, accountName } = request.body
        if (!webhookUrl) {
            reply.status(400);
            return { error: 'Webhook URL required' }
        }
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        if (!(await isSafeUrlResolved(webhookUrl))) {
            reply.status(400);
            return { error: 'Invalid webhook URL' }
        }

        await sendNotification(webhookUrl, {
            type: 'info',
            message: '🚀 **Connectivity Test Successful**\n\nYour AIOManager Autopilot alerts are configured correctly and active.\n\n**Environment**: High-Scale Optimization\n**Encryption**: AES-256 Verified ✅',
            accountName: accountName || 'Test Account',
            activeName: 'System Test'
        })

        return { success: true }
    })

    fastify.delete('/api/autopilot/:id', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
        const { id } = request.params
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const rule = await db.get('SELECT owner_sync_user FROM autopilot_rules WHERE id = $1', [id])
        if (rule && rule.owner_sync_user && rule.owner_sync_user !== authUser) {
            reply.status(403);
            return { error: 'Forbidden' }
        }

        await db.tx(async (tx) => {
            await tx.run('DELETE FROM autopilot_rule_stats WHERE rule_id = $1', [id])
            await tx.run('DELETE FROM autopilot_rules WHERE id = $1', [id])
        })
        clearRuleRuntimeState?.(id)
        return { success: true }
    })

    fastify.delete('/api/autopilot/account/:accountId', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
        const { accountId } = request.params
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const ownerCheck = await db.get('SELECT 1 FROM autopilot_rules WHERE account_id = $1 AND owner_sync_user = $2 LIMIT 1', [accountId, authUser])
        if (!ownerCheck) {
            const hasRules = await db.get('SELECT 1 FROM autopilot_rules WHERE account_id = $1 LIMIT 1', [accountId])
            if (hasRules) { reply.status(403); return { error: 'Forbidden' } }
            return { success: true, deleted: 0 }
        }

        const result = await db.tx(async (tx) => {
            await tx.run('DELETE FROM autopilot_rule_stats WHERE rule_id IN (SELECT id FROM autopilot_rules WHERE account_id = $1 AND owner_sync_user = $2)', [accountId, authUser])
            const r = await tx.run('DELETE FROM autopilot_rules WHERE account_id = $1 AND owner_sync_user = $2', [accountId, authUser])
            await tx.run('DELETE FROM failover_history WHERE account_id = $1 AND rule_id IN (SELECT id FROM autopilot_rules WHERE owner_sync_user = $2)', [accountId, authUser])
            return r
        })
        clearAccountRuleRuntimeState?.(accountId)
        fastify.log.info({ category: 'Autopilot' }, `Bulk-deleted rules for account ${maskContext(accountId)}...`)
        return { success: true, deleted: result?.changes || 0 }
    })

    fastify.delete('/api/autopilot/history/:accountId', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
        const { accountId } = request.params
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const ownerCheck = await db.get('SELECT 1 FROM autopilot_rules WHERE account_id = $1 AND owner_sync_user = $2 LIMIT 1', [accountId, authUser])
        if (!ownerCheck) {
            const hasRules = await db.get('SELECT 1 FROM autopilot_rules WHERE account_id = $1 LIMIT 1', [accountId])
            if (hasRules) { reply.status(403); return { error: 'Forbidden' } }
        }

        const result = await db.run('DELETE FROM failover_history WHERE account_id = $1 AND rule_id IN (SELECT id FROM autopilot_rules WHERE owner_sync_user = $2)', [accountId, authUser])
        fastify.log.info({ category: 'Autopilot' }, `Cleared autopilot history for account ${maskContext(accountId)}`)
        return { success: true, deleted: result?.changes || 0 }
    })


    fastify.get('/api/autopilot/pulse', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const row = await db.get('SELECT COUNT(*) as count FROM autopilot_rules WHERE owner_sync_user = $1 AND is_active = 1', [authUser])
        return { lastWorkerRun: serverState.lastWorkerRun, activeRuleCount: row?.count || 0, lastCycle: serverState.autopilotLastCycleStats }
    })


    fastify.post('/api/autopilot/states', { bodyLimit: 1024 * 100, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
        const { accountIds, limit, offset } = request.body || {}
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }
        if (!Array.isArray(accountIds) || accountIds.length === 0) { return {} }
        if (accountIds.length > MAX_BATCH_STATE_ACCOUNTS) { reply.status(400); return { error: `Too many account IDs (max ${MAX_BATCH_STATE_ACCOUNTS})` } }

        const placeholders = accountIds.map((_, i) => `$${i + 2}`).join(',')
        const rules = await db.query(
            `SELECT r.id, r.account_id, r.priority_chain, r.active_url, r.webhook_url, r.is_active, r.is_automatic,
                    COALESCE(s.last_check, r.last_check) AS last_check,
                    COALESCE(s.stabilization, r.stabilization) AS stabilization,
                    r.name, r.cooldown_ms
             FROM autopilot_rules r
             LEFT JOIN autopilot_rule_stats s ON s.rule_id = r.id
             WHERE r.owner_sync_user = $1 AND r.account_id IN (${placeholders})`,
            [authUser, ...accountIds]
        )

        const allRules = rules || []
        const totalCount = allRules.length
        const slicedRules = (limit != null && offset != null)
            ? allRules.slice(offset, offset + limit)
            : allRules

        const result = {}
        let skippedCount = 0
        for (const rule of slicedRules) {
            if (!result[rule.account_id]) result[rule.account_id] = []
            try {
                result[rule.account_id].push(buildAutopilotState(rule))
            } catch (err) {
                skippedCount++
                fastify.log.error({ category: 'Autopilot' }, `Failed to decrypt rule ${rule.id}: ${err.message}`)
            }
        }
        return {
            states: result,
            lastWorkerRun: serverState.lastWorkerRun,
            totalCount,
            lastCycle: serverState.autopilotLastCycleStats,
            partial: skippedCount > 0,
            skippedCount
        }
    })

    fastify.get('/api/admin/queue-stats', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }
        const stats = Object.fromEntries(proxyQueueKeyCounts)
        return { queueLength: proxyQueue.length, activeRequests: serverState.activeProxyRequests, keyCounts: stats }
    })
}
