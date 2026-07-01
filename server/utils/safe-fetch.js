import { isSafeUrlResolved } from './ssrf.js'

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export async function safeFetchWithRedirects(url, { signal, headers, method = 'HEAD', maxHops = 3, methodFallback = false } = {}) {
    if (!(await isSafeUrlResolved(url))) return null

    const reqHeaders = { 'User-Agent': DEFAULT_USER_AGENT, 'Accept': 'application/json, text/plain, */*', ...(headers || {}) }
    let currentUrl = url

    for (let hop = 0; hop <= maxHops; hop++) {
        let res = await fetch(currentUrl, { method, signal, redirect: 'manual', headers: reqHeaders })
        if (methodFallback && method === 'HEAD' && (res.status === 405 || res.status === 404)) {
            res = await fetch(currentUrl, { method: 'GET', signal, redirect: 'manual', headers: reqHeaders })
        }

        if (res.status >= 300 && res.status < 400) {
            if (hop >= maxHops) return null
            const location = res.headers.get('location')
            if (!location) return null
            let nextUrl
            try { nextUrl = new URL(location, currentUrl).toString() } catch { return null }
            if (!(await isSafeUrlResolved(nextUrl))) return null
            currentUrl = nextUrl
            continue
        }

        return res
    }

    return null
}
