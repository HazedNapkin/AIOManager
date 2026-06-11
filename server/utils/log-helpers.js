export const deriveAddonName = (url) => {
    try {
        const hostname = new URL(url).hostname
        return hostname
            .replace(/^www\./, '')
            .replace(/\.[^.]+$/, '')
            .split(/[.-]/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ') || 'Unknown Addon'
    } catch {
        return 'Unknown Addon'
    }
}

export const truncateUrl = (url, maxLen = 80) => {
    const rawUrl = typeof url === 'string' ? url : String(url || '')
    if (!rawUrl) return ''

    try {
        const u = new URL(rawUrl)
        const pathParts = u.pathname.split('/').filter(Boolean)

        const maskSegment = (seg) => {
            if (!seg) return ''
            if (seg.length > 12 || (/[0-9]/.test(seg) && /[a-zA-Z]/.test(seg))) {
                return `${seg.substring(0, 4)}***${seg.substring(seg.length - 4)}`
            }
            return seg
        }

        const safePath = pathParts.length > 0 ? `/${maskSegment(pathParts[0])}` : ''
        return `${u.protocol}//${u.host}${safePath}${u.pathname.length > safePath.length ? '/...' : ''}`
    } catch (e) {
        return rawUrl.length > maxLen ? `${rawUrl.substring(0, maxLen)}...` : rawUrl
    }
}

export const maskContext = (context) => {
    if (!context || context === 'Unknown') return context

    const normalized = String(context).trim()
    const lower = normalized.toLowerCase()
    const systemLabels = ['system check', 'library check', 'auto check', 'auto-update', 'background sync', 'sync manager', 'system', 'library-update-check', 'update-check', 'account import', 'new-login-check', 'autopilot']
    if (systemLabels.some(label => lower.includes(label))) return normalized

    if (normalized.length <= 4) return `${normalized[0]}***${normalized[normalized.length - 1]}`
    return `${normalized.substring(0, 2)}***${normalized.substring(normalized.length - 2)}`
}
