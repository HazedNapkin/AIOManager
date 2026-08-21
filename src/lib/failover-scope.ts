import { normalizeAddonUrlForMatch } from './addon-url.ts'

export interface CustomCheckEntryLike {
    url: string
    appliesTo: string[]
}

export interface ScopeValidationError {
    checkIndex: number
    checkUrl: string
    unmatchedUrl: string
    closestUrl?: string
}

const normChainUrls = (chain: string[]): string[] =>
    chain.filter(url => !!url).map(normalizeAddonUrlForMatch)

export function isUrlInChain(addonUrl: string, chain: string[]): boolean {
    if (!addonUrl) return false
    const normalized = normalizeAddonUrlForMatch(addonUrl)
    return normChainUrls(chain).includes(normalized)
}

export function findStaleScopeEntries(chain: string[], appliesTo: string[]): string[] {
    const normalizedChain = normChainUrls(chain)
    return appliesTo.filter(url => !!url && !normalizedChain.includes(normalizeAddonUrlForMatch(url)))
}

const levenshtein = (a: string, b: string): number => {
    if (a === b) return 0
    if (!a.length) return b.length
    if (!b.length) return a.length
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
        const curr = [i]
        for (let j = 1; j <= b.length; j++) {
            curr[j] = Math.min(
                prev[j] + 1,
                curr[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            )
        }
        prev = curr
    }
    return prev[b.length]
}

const MAX_SUGGESTION_DISTANCE = 0.35

// Closest chain addon to an out-of-chain URL: same path first, then same hostname, then
// the nearest Levenshtein comparison key within a similarity cutoff.
export function findClosestChainAddon(unmatchedUrl: string, chain: string[]): string | undefined {
    if (!unmatchedUrl) return undefined
    const target = normalizeAddonUrlForMatch(unmatchedUrl)
    if (!target) return undefined
    let targetUrl: URL
    try {
        targetUrl = new URL(target)
    } catch {
        return undefined
    }
    const targetPath = targetUrl.pathname.replace(/\/+$/, '')
    const targetHost = targetUrl.hostname

    let best: { url: string; score: number } | undefined
    for (const chainUrl of chain) {
        if (!chainUrl) continue
        const key = normalizeAddonUrlForMatch(chainUrl)
        if (!key || key === target) continue
        let parsed: URL
        try {
            parsed = new URL(key)
        } catch {
            continue
        }
        let score: number
        if (targetPath !== '' && parsed.pathname.replace(/\/+$/, '') === targetPath) {
            score = 0
        } else if (parsed.hostname === targetHost) {
            score = 1
        } else {
            const distance = levenshtein(key, target) / Math.max(key.length, target.length)
            if (distance > MAX_SUGGESTION_DISTANCE) continue
            score = 2 + distance
        }
        if (!best || score < best.score) best = { url: chainUrl, score }
    }
    return best?.url
}

// Editor-only save gate: null means every scoped custom check lands inside the chain.
export function validateCustomCheckScopes(
    chain: string[],
    checks: CustomCheckEntryLike[]
): ScopeValidationError | null {
    const normalizedChain = normChainUrls(chain)
    for (let checkIndex = 0; checkIndex < checks.length; checkIndex++) {
        const check = checks[checkIndex]
        if (!check.url.trim() || check.appliesTo.length === 0) continue
        for (const addonUrl of check.appliesTo) {
            if (!addonUrl) continue
            if (normalizedChain.includes(normalizeAddonUrlForMatch(addonUrl))) continue
            return {
                checkIndex,
                checkUrl: check.url,
                unmatchedUrl: addonUrl,
                closestUrl: findClosestChainAddon(addonUrl, chain),
            }
        }
    }
    return null
}

export const isSameCheckUrl = (a: string, b: string): boolean =>
    !!a && !!b && normalizeAddonUrlForMatch(a) === normalizeAddonUrlForMatch(b)

// Local checks whose non-empty scope an incoming merge is about to widen to [] for the
// same check URL — the pre-clobber snapshot heuristic.
export function findScopedChecksAtRisk(
    localChecks: CustomCheckEntryLike[] | undefined,
    incomingChecks: CustomCheckEntryLike[] | undefined
): CustomCheckEntryLike[] {
    if (!localChecks || !incomingChecks) return []
    return localChecks.filter(local =>
        local.appliesTo.length > 0 &&
        incomingChecks.some(incoming =>
            incoming.appliesTo.length === 0 &&
            isSameCheckUrl(incoming.url, local.url)
        )
    )
}

// Refills only currently-empty scopes from a backup; manual scopes win untouched.
export function restoreScopedChecks(
    currentChecks: CustomCheckEntryLike[],
    backupChecks: CustomCheckEntryLike[]
): CustomCheckEntryLike[] {
    return currentChecks.map(check => {
        if (check.appliesTo.length > 0) return check
        const backup = backupChecks.find(b =>
            b.appliesTo.length > 0 && isSameCheckUrl(b.url, check.url)
        )
        return backup ? { ...check, appliesTo: [...backup.appliesTo] } : check
    })
}

export function getUrlHostname(url: string): string {
    try {
        return new URL(normalizeAddonUrlForMatch(url)).hostname
    } catch {
        return url
    }
}
