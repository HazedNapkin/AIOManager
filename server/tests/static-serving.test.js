process.env.ENCRYPTION_KEY = 'test-encryption-key-32bytes-long!!'

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import fastifyStatic from '@fastify/static'

import { setupTestEnv, cleanupTestEnv } from './helpers.js'

let app
let tmpRoot

before(async () => {
    app = await setupTestEnv()
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aioman-static-'))
    fs.writeFileSync(path.join(tmpRoot, 'index.html'), '<!DOCTYPE html><html><head><title>AIOManager</title></head><body><div id="root"></div></body></html>')
    fs.writeFileSync(path.join(tmpRoot, 'app.js'), 'console.log("ok")')

    await app.register(fastifyStatic, {
        root: tmpRoot,
        prefix: '/',
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache')
        },
    })

    app.setNotFoundHandler((request, reply) => {
        if (request.url.startsWith('/api')) {
            reply.status(404)
            return { error: `API route ${request.method}:${request.url} not found` }
        }
        reply.header('Cache-Control', 'no-cache')
        return reply.sendFile('index.html')
    })

    await app.ready()
})

after(() => {
    cleanupTestEnv()
    fs.rmSync(tmpRoot, { recursive: true, force: true })
})

test('GET / serves the SPA index as HTML (static serving does not throw)', async () => {
    const res = await app.inject({ method: 'GET', url: '/' })
    assert.equal(res.statusCode, 200, `body: ${res.body.slice(0, 200)}`)
    assert.ok(res.headers['content-type'].includes('text/html'), `content-type: ${res.headers['content-type']}`)
    assert.ok(res.body.includes('<div id="root">'))
})

test('html responses carry no-cache or equivalent revalidation directives', async () => {
    const res = await app.inject({ method: 'GET', url: '/' })
    const cc = res.headers['cache-control'] || ''
    assert.ok(
        cc.includes('no-cache') || cc.includes('no-store') || cc.includes('max-age=0'),
        `expected revalidation directive on html, got: ${cc || 'none'}`
    )
})

test('unknown SPA routes fall back to index.html while /api 404s stay JSON', async () => {
    const spa = await app.inject({ method: 'GET', url: '/accounts' })
    assert.equal(spa.statusCode, 200)
    assert.ok(spa.headers['content-type'].includes('text/html'))

    const api = await app.inject({ method: 'GET', url: '/api/definitely-not-a-route' })
    assert.equal(api.statusCode, 404)
    assert.equal(api.json().error, 'API route GET:/api/definitely-not-a-route not found')
})

test('non-HTML static assets serve without the no-cache header', async () => {
    const res = await app.inject({ method: 'GET', url: '/app.js' })
    assert.equal(res.statusCode, 200)
    assert.notEqual(res.headers['cache-control'], 'no-cache')
})

test('index.js static setHeaders uses the raw Node response API, not Fastify reply', async () => {
    // The setHeaders callback receives Node's ServerResponse (setHeader), never a
    // Fastify reply (header). A reply.* call there throws on every static response
    // over a real socket and takes the whole SPA down — inject cannot reproduce the
    // socket path, so this guards the registration source directly.
    const source = fs.readFileSync(path.resolve(import.meta.dirname, '../index.js'), 'utf8')
    const m = source.match(/setHeaders:\s*\((\w+),\s*\w+\)\s*=>\s*\{[\s\S]*?\}/)
    assert.ok(m, 'static setHeaders registration not found in server/index.js')
    const rawResName = m[1]
    assert.equal(rawResName, 'res', `setHeaders first param should be named 'res' to signal raw Node response, got '${rawResName}'`)
    const body = m[0]
    assert.ok(!body.includes('reply.'), 'setHeaders must not call Fastify reply API (reply.header throws on raw ServerResponse)')
    assert.ok(body.includes('res.setHeader'), 'setHeaders must use res.setHeader for raw Node response')
})
