import { lookup } from 'dns/promises'

const DNS_REBIND_DOMAINS = [
    'nip.io', 'sslip.io', 'localtest.me', 'xip.io', 'nip.name',
    'hackertarget.com', 'burpcollaborator.net', 'oastify.com',
    'requestbin.net', 'webhook.site'
]

const ALLOW_PRIVATE = process.env.SSRF_ALLOW_PRIVATE === 'true' || process.env.SSRF_ALLOW_PRIVATE === '1'

const isPrivateIPv4 = (ip) => {
    const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (!m) return false
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10)
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 198 && (b === 18 || b === 19)) return true
    return false
}

const isPrivateIPv6 = (ip) => {
    const h = ip.toLowerCase()
    if (h === '::1' || h === '::') return true
    if (/^f[cd]/.test(h)) return true          // unique local fc00::/7
    if (h.startsWith('fe80')) return true        // link-local
    if (h.startsWith('::ffff:')) return isPrivateIPv4(h.slice(7))  // IPv4-mapped
    return false
}

export const isPrivateIp = (ip) => isPrivateIPv4(ip) || isPrivateIPv6(ip)

export const isSafeUrl = (url) => {
    try {
        const u = new URL(url)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false

        const hostname = u.hostname.toLowerCase().replace(/^\[(.+)\]$/, '$1')

        if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '::1' || hostname === '::' || hostname === '[::]') return false
        if (hostname === 'host.docker.internal' || hostname === 'host.internal') return false
        if (/^127\./.test(hostname)) return false
        if (/^10\./.test(hostname)) return false
        if (/^192\.168\./.test(hostname)) return false
        if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false
        if (/^169\.254\./.test(hostname)) return false
        if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname)) return false
        if (/^198\.1[89]\./.test(hostname)) return false
        if (/^fc00:/i.test(hostname) || /^fd/i.test(hostname)) return false
        if (/^fe80:/i.test(hostname)) return false
        if (/^::ffff:/i.test(hostname)) return false
        if (/^0(?:\.0){0,3}$/.test(hostname)) return false

        if (/^\d+$/.test(hostname)) {
            const num = parseInt(hostname, 10)
            if (num === 0 || num === 2130706433 || (num >= 167772160 && num <= 184549375) || (num >= 2886729728 && num <= 2887778303) || (num >= 3232235520 && num <= 3232301055)) return false
        }
        if (/^0[0-7]+(\.|$)/.test(hostname)) return false
        if (/^0x[0-9a-f]+(\.|$)/i.test(hostname)) return false

        const domain = hostname.split('.').slice(-2).join('.')
        if (DNS_REBIND_DOMAINS.some(d => domain === d || hostname.endsWith('.' + d))) return false

        if (u.pathname.match(/\.(mp4|mkv|avi|mov|wmv|flv|webm)$/i)) return false

        return true
    } catch (e) { return false }
}

// Closes the DNS-rebind gap that isSafeUrl (a string check) can't: a public-looking hostname
// that resolves to a private address. Returns false only when DNS clearly resolves to a private
// IP; on resolution failure it defers to isSafeUrl (returns true) so transient DNS issues don't
// block legitimate public hosts. Use at SSRF-sensitive entry points that fetch user URLs.
export const resolveAndValidateHost = async (hostname) => {
    if (ALLOW_PRIVATE) return true
    const host = String(hostname || '').toLowerCase().replace(/^\[(.+)\]$/, '$1')
    if (!host) return false

    try {
        const records = await lookup(host, { all: true })
        if (!Array.isArray(records) || records.length === 0) {
            return true
        }
        return !records.some(r => isPrivateIp(r.address))
    } catch {
        return true
    }
}

export const isSafeUrlResolved = async (url) => {
    if (!isSafeUrl(url)) return false
    try {
        return await resolveAndValidateHost(new URL(url).hostname)
    } catch {
        return false
    }
}
