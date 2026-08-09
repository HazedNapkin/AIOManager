import { trace } from '@/lib/trace'

const DEV = import.meta.env?.DEV

function truncUrl(url: string, max = 90): string {
    return url.length > max ? url.slice(0, max - 3) + '...' : url
}

export async function authedFetch(url: string, options?: RequestInit): Promise<Response> {
    const start = performance.now()
    try {
        const { useSyncStore } = await import('@/store/syncStore')
        const { deriveSyncToken } = await import('@/lib/crypto')
        const auth = useSyncStore.getState().auth
        const headers: Record<string, string> = { ...(options?.headers as Record<string, string>) }
        if (auth.isAuthenticated) {
            headers['x-sync-user'] = auth.id
            headers['x-sync-password'] = await deriveSyncToken(auth.password)
        }
        const res = await fetch(url, { ...options, headers })
        const durMs = Math.round(performance.now() - start)
        trace('fetch', res.ok ? 'ok' : 'fail', { url: truncUrl(url), method: options?.method || 'GET', status: res.status, durMs })
        if (DEV) {
            if (res.ok) console.log(`[fetch] ${durMs}ms ${res.status} ${truncUrl(url)}`)
            else console.warn(`[fetch] ${durMs}ms ${res.status} ${truncUrl(url)}`)
        }
        return res
    } catch (err) {
        const durMs = Math.round(performance.now() - start)
        const errName = err instanceof Error ? err.name : 'Unknown'
        trace('fetch', 'err', { url: truncUrl(url), method: options?.method || 'GET', errName, durMs })
        if (DEV) {
            if (errName !== 'AbortError') console.warn(`[fetch] ${durMs}ms ERR ${errName} ${truncUrl(url)}`)
        }
        return fetch(url, options)
    }
}

export async function proxyFetchJson<T>(path: string, signal?: AbortSignal): Promise<T | null> {
    const start = performance.now()
    try {
        const res = await authedFetch(`/api/metadata/${path}`, { signal })
        if (!res.ok) {
            const durMs = Math.round(performance.now() - start)
            trace('proxy', 'fail', { path: truncUrl(path), status: res.status, durMs })
            if (DEV) console.warn(`[proxy] ${durMs}ms ${res.status} ${path}`)
            return null
        }
        const data = await res.json() as T
        const durMs = Math.round(performance.now() - start)
        trace('proxy', 'ok', { path: truncUrl(path), status: 200, durMs })
        if (DEV) console.log(`[proxy] ${durMs}ms 200 ${truncUrl(path)}`)
        return data
    } catch (err) {
        const durMs = Math.round(performance.now() - start)
        const errName = err instanceof Error ? err.name : 'Unknown'
        trace('proxy', 'err', { path: truncUrl(path), errName, durMs })
        if (DEV) {
            if (errName !== 'AbortError') console.warn(`[proxy] ${durMs}ms ERR ${errName} ${path}`)
        }
        return null
    }
}

export async function requireJson<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await authedFetch(url, options)
    if (!res.ok) {
        const body = await res.text().catch(() => '')
        const err = new Error(`Request failed: ${res.status} ${res.statusText} ${truncUrl(url)}`)
        ;(err as any).status = res.status
        ;(err as any).body = body
        throw err
    }
    return res.json() as Promise<T>
}

export async function traceAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (!DEV) return fn()
    const start = performance.now()
    try {
        const result = await fn()
        console.log(`[trace] ${name}: ${Math.round(performance.now() - start)}ms`)
        return result
    } catch (err) {
        console.warn(`[trace] ${name}: FAILED (${Math.round(performance.now() - start)}ms)`, err)
        throw err
    }
}
