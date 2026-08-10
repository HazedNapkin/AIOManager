import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fastifyCompress from '@fastify/compress'
import rateLimit from '@fastify/rate-limit'
import { hashApiKey } from './api-keys.js'
import db from './db.js'
import fs from 'fs'
import { VERSION, PORT, loggerConfig, distPath, corsOrigins, ensureDataDirectory, isRegistrationsClosed, isReadOnlyReplica } from './config.js'
import { initializeEncryptionKeys } from './keys.js'
import { proxyQueue, serverState } from './state.js'
import { initializeDatabase } from './database/setup.js'
import { registerSyncRoutes } from './routes/sync.js'
import { registerProxyRoutes } from './routes/proxy.js'
import { registerAutopilotRoutes } from './routes/autopilot.js'
import { createAutopilotEngine } from './autopilot/engine.js'
import { createActivityEngine } from './activity/engine.js'
import { registerActivityRoutes } from './routes/activity.js'
import { registerHydraRoutes } from './routes/hydra.js'
import { createReconciler } from './providers/reconciler.js'
import { registerProviderRoutes } from './routes/providers.js'
import { registerMetadataKeysRoutes } from './routes/metadata-keys.js'
import { registerMetadataProxyRoutes } from './routes/metadata-proxy.js'
import { registerWatchlistRoutes } from './routes/watchlist.js'

import { traceClientBatch, traceEnabled } from './utils/trace.js'

const fastify = Fastify({
    logger: loggerConfig,
    disableRequestLogging: true,
    bodyLimit: parseInt(process.env.MAX_SYNC_PAYLOAD_SIZE || '104857600')
})

ensureDataDirectory(fastify)
initializeEncryptionKeys(fastify)

if (process.env.CUSTOM_HTML) {
    fastify.log.info({ category: 'Server' }, 'Custom HTML injection active.')
}

const dbPath = await initializeDatabase(fastify)

await fastify.register(cors, {
    origin: corsOrigins
})

await fastify.register(rateLimit, {
    global: false,
    keyGenerator: (request) => {
        // Hydra consumers authenticate by API key (not x-sync-user), so bucket them per-key.
        // Critical on shared/proxied instances where every consumer can share one source IP.
        const apiKey = request.headers['x-api-key']
        if (apiKey) return `k:${hashApiKey(apiKey)}`
        return request.headers['x-sync-user'] || request.ip
    }
})

await fastify.register(fastifyCompress, { global: true })

fastify.addHook('onRequest', async (request) => {
    request.startTime = Date.now()
})

fastify.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; font-src 'self'; frame-src 'self' https://www.youtube.com https://youtube.com; frame-ancestors 'none'; base-uri 'self'; form-action 'none'")
    if (request.protocol === 'https') {
        reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    const start = request.startTime
    if (typeof start === 'number') {
        const timings = []
        if (request.tmdbDuration) timings.push(`tmdb;dur=${Math.round(request.tmdbDuration)}`)
        if (request.dbDuration) timings.push(`db;dur=${Math.round(request.dbDuration)}`)
        timings.push(`total;dur=${Math.round(Date.now() - start)}`)
        reply.header('Server-Timing', timings.join(', '))
    }
})

registerWatchlistRoutes(fastify)

fastify.get('/logo.png', async (_request, reply) => {
    const distLogo = `${distPath}/logo.png`
    const publicLogo = `${distPath.replace(/\/dist$/, '')}/public/logo.png`
    if (fs.existsSync(distLogo)) {
        reply.type('image/png')
        return reply.send(fs.createReadStream(distLogo))
    }
    if (fs.existsSync(publicLogo)) {
        reply.type('image/png')
        return reply.send(fs.createReadStream(publicLogo))
    }
    reply.status(404)
    return { error: 'Logo not found' }
})

if (fs.existsSync(distPath)) {
    await fastify.register(fastifyStatic, {
        root: distPath,
        prefix: '/'
    })

    fastify.setNotFoundHandler((request, reply) => {
        if (request.url.startsWith('/api')) {
            reply.status(404);
            return { error: `API route ${request.method}:${request.url} not found` }
        }
        return reply.sendFile('index.html')
    })

    fastify.setErrorHandler((error, request, reply) => {
        const status = error.statusCode || error.status || 500
        if (status >= 500) {
            request.log.error({ err: error }, `Unhandled error on ${request.method}:${request.url}`)
        }
        reply.status(status >= 400 && status < 600 ? status : 500)
        return { error: error.message || 'Internal Server Error' }
    })
}

fastify.get('/api/health', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
        response: {
            200: {
                type: 'object',
                properties: {
                    status: { type: 'string' },
                    version: { type: 'string' },
                    mode: { type: 'string' },
                    readOnly: { type: 'boolean' },
                    optimized: { type: 'boolean' },
                    database: {
                        type: 'object',
                        properties: {
                            type: { type: 'string' },
                            healthy: { type: 'boolean' }
                        }
                    },
                    autopilot: {
                        type: 'object',
                        properties: {
                            lastRun: { type: 'number' },
                            running: { type: 'boolean' }
                        }
                    }
                }
            }
        }
    }
}, async (request, reply) => {
    const dbHealthy = await db.healthCheck()
    const overallStatus = dbHealthy ? 'ok' : 'degraded'
    const readOnly = isReadOnlyReplica()
    const mode = readOnly ? 'read-only-replica' : 'multi-tenant'

    if (!dbHealthy) {
        reply.status(503);
        return {
            status: 'degraded',
            version: VERSION,
            mode,
            readOnly,
            optimized: true,
            database: { type: db.type, healthy: false },
            autopilot: { lastRun: serverState.lastWorkerRun, running: serverState.isWorkerRunning }
        }
    }

    return {
        status: overallStatus,
        version: VERSION,
        mode,
        readOnly,
        optimized: true,
        database: { type: db.type, healthy: true },
        autopilot: { lastRun: serverState.lastWorkerRun, running: serverState.isWorkerRunning }
    }
})

// Write-readiness probe for status-code-only load balancers: a read-only standby (or an
// unhealthy DB) returns 503 so it is excluded from write routing, while /api/health stays
// 200 to keep the standby reachable for read traffic.
fastify.get('/api/ready', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
        response: {
            200: { type: 'object', properties: { ready: { type: 'boolean' }, readOnly: { type: 'boolean' } } },
            503: { type: 'object', properties: { ready: { type: 'boolean' }, readOnly: { type: 'boolean' } } }
        }
    }
}, async (request, reply) => {
    const readOnly = isReadOnlyReplica()
    const dbHealthy = await db.healthCheck()
    if (readOnly || !dbHealthy) {
        reply.status(503)
        return { ready: false, readOnly }
    }
    return { ready: true, readOnly }
})

fastify.get('/api/config', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    return {
        customHtml: process.env.CUSTOM_HTML || null,
        registrationsClosed: isRegistrationsClosed()
    }
})

// Debug trace sink: client seams batch-POST here so client + server traces land in one
fastify.post('/api/debug/trace', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!traceEnabled()) {
        reply.status(204)
        return null
    }
    traceClientBatch(request.body?.entries)
    reply.status(204)
    return null
})

registerSyncRoutes(fastify)

const reconciler = createReconciler(fastify)
const autopilotEngine = createAutopilotEngine(fastify, reconciler)
const activityEngine = createActivityEngine(fastify)
registerProxyRoutes(fastify, { checkAddonHealthInternal: autopilotEngine.checkAddonHealthInternal })

const start = async () => {
    try {
        const banner = `
 ==============================================================================
      ___   _ _______  __  __
     /   | (_) ____/ |/ / / /___ _____  ____ _____ ____  _____
    / /| |/ / /   / /|_/ / __ \`/ __ \`/ __ \`/ __ \`/ _ \\/ ___/
   / ___ / / /___/ /  / / /_/ / / / / /_/ / /_/ /  __/ /
  /_/  |_\\_\\____/_/  /_/\\__,_/_/ /_/\\__,/\\__, /\\___/_/
                                         /____/
 ==============================================================================
  One manager to rule them all. Local-first, Encrypted, Powerful. v${VERSION}
 ==============================================================================
`;
        console.log(banner);

        registerAutopilotRoutes(fastify, autopilotEngine)
        registerActivityRoutes(fastify, activityEngine)
        registerHydraRoutes(fastify, reconciler)
        registerProviderRoutes(fastify, reconciler)
    registerMetadataKeysRoutes(fastify)
    registerMetadataProxyRoutes(fastify)

        await fastify.listen({ port: PORT, host: '0.0.0.0' })
        fastify.log.info({ category: 'Server' }, `Listening on port ${PORT}`)
        if (db.type === 'sqlite') {
            fastify.log.info({ category: 'Database' }, `Path: ${dbPath}`)
        }
        fastify.log.info({ category: 'Security' }, 'Zero-Knowledge mode active. 🛡️')

        if (isReadOnlyReplica()) {
            fastify.log.info({ category: 'Server' }, 'READ_ONLY_REPLICA mode: passive standby, autopilot and activity workers disabled. Serving read traffic only.')
        } else {
            autopilotEngine.startAutopilotWorker()
            activityEngine.start()
        }
    } catch (err) {
        fastify.log.error(err)
        process.exit(1)
    }
}

const shutdown = async (signal) => {
    console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`)

    try {
        autopilotEngine.stopAutopilotWorker()
        activityEngine.stop()
        proxyQueue.length = 0

        if (serverState.isWorkerRunning) {
            fastify.log.info({ category: 'Server' }, 'Waiting for autopilot worker to finish...')
            for (let i = 0; i < 30 && serverState.isWorkerRunning; i++) {
                await new Promise(r => setTimeout(r, 1000))
            }
            if (serverState.isWorkerRunning) {
                fastify.log.warn({ category: 'Server' }, 'Worker still running after 30s, proceeding with shutdown.')
            }
        }

        await fastify.close()
        fastify.log.info({ category: 'Server' }, 'Fastify closed.')

        if (db) {
            fastify.log.info({ category: 'Database' }, 'Flushing and closing...')
            if (db.type === 'sqlite') {
                await db.pragma('wal_checkpoint(TRUNCATE)')
            }
            await db.close()
            fastify.log.info({ category: 'Database' }, 'Database connection closed cleanly.')
        }

        process.exit(0)
    } catch (err) {
        fastify.log.error({ category: 'Server' }, `Error during shutdown: ${err.message}`)
        process.exit(1)
    }
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
const formatFatalError = (err) => {
    if (err instanceof Error) return err.stack || err.message
    if (err && typeof err === 'object') {
        try { return JSON.stringify(err) } catch { return String(err) }
    }
    return String(err)
}
process.on('unhandledRejection', (reason) => {
    fastify.log.error({ category: 'Server' }, `Unhandled promise rejection: ${formatFatalError(reason)}`)
})
process.on('uncaughtException', (err) => {
    fastify.log.error({ category: 'Server' }, `Uncaught exception: ${formatFatalError(err)}`)
    shutdown('uncaughtException')
})

start()
