import { WatchMigrationError } from './failures.ts'
import type { MigrationFailure } from './types.ts'

type StremioOperation = 'GetUser' | 'DatastoreGet' | 'DatastorePut'

interface RequestOptions {
    authKey: string
    accountId: string
    headers(): Promise<Record<string, string>>
    assertCurrent(): void
    fetch?: typeof fetch
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason) }
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
        signal.addEventListener('abort', abort, { once: true })
    })
}

function retryDelay(value: string | null, attempt: number): number {
    const seconds = value && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : null
    const date = value && seconds === null ? Date.parse(value) : Number.NaN
    const requested = seconds !== null ? seconds * 1000 : Number.isFinite(date) ? date - Date.now() : 1000 * (attempt + 1)
    return Math.min(60_000, Math.max(1000, requested))
}

export function createStremioWatchRequest(options: RequestOptions) {
    return async (type: StremioOperation, body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> => {
        const stage: MigrationFailure['stage'] = type === 'GetUser' ? 'identity' : type === 'DatastorePut' ? 'write' : 'prewrite'
        // Reads may retry a transient transport failure. Never replay a library
        // replacement here: an interrupted write may have reached Stremio already.
        const maxAttempts = type === 'DatastorePut' ? 1 : 3
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            signal.throwIfAborted()
            const headers = await options.headers()
            options.assertCurrent()
            signal.throwIfAborted()
            let response: Response
            try {
                response = await (options.fetch ?? fetch)('/api/stremio-proxy', {
                    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'x-account-context': options.accountId },
                    body: JSON.stringify({ ...body, type, authKey: options.authKey }),
                    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
                    credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
                })
            } catch (error) {
                signal.throwIfAborted()
                const reason = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'network'
                if (attempt + 1 < maxAttempts) {
                    await (options.sleep ?? sleep)(retryDelay(null, attempt), signal)
                    continue
                }
                throw new WatchMigrationError({ stage, reason, attempts: attempt + 1 })
            }
            if (!response.ok) {
                const retryable = response.status === 429 || response.status >= 500
                await response.body?.cancel().catch(() => {})
                if (retryable && attempt + 1 < maxAttempts) {
                    await (options.sleep ?? sleep)(retryDelay(response.headers.get('Retry-After'), attempt), signal)
                    continue
                }
                throw new WatchMigrationError({ stage, reason: response.status === 429 ? 'rate_limited' : 'http', httpStatus: response.status, attempts: attempt + 1 })
            }
            let data: unknown
            try { data = await response.json() }
            catch (error) {
                signal.throwIfAborted()
                const reason = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout'
                    : error instanceof TypeError ? 'network' : 'invalid_response'
                if (reason !== 'invalid_response' && attempt + 1 < maxAttempts) {
                    await (options.sleep ?? sleep)(retryDelay(null, attempt), signal)
                    continue
                }
                throw new WatchMigrationError({ stage, reason, attempts: attempt + 1 })
            }
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new WatchMigrationError({ stage, reason: 'invalid_response', attempts: attempt + 1 })
            const envelope = data as Record<string, unknown>
            if (envelope.error || envelope.result === false || envelope.result === undefined) throw new WatchMigrationError({ stage, reason: 'remote_declined', attempts: attempt + 1 })
            return envelope.result
        }
    }
}
