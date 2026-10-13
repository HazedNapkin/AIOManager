// Shared one-active flag derivation, extracted from engine.js for testability.

// Pure string->string; every enforcement pass re-normalizes the same transport URLs
// across fold, guard and manifest-id matching, so memoize.
const _normMemo = new Map()
function normalizeAddonUrl(url) {
    if (!url) return ''
    const key = String(url)
    const hit = _normMemo.get(key)
    if (hit !== undefined) return hit
    let normalized = key.trim()
    if (!/^(?:https?|stremio):\/\//i.test(normalized)) normalized = `https://${normalized}`
    normalized = normalized.replace(/^stremio:\/\//i, 'https://')
    normalized = normalized.replace(/^http:\/\//i, 'https://')
    normalized = normalized.replace(/\/manifest\.json$/i, '')
    normalized = normalized.replace(/\/+$/, '')
    normalized = normalized.replace(/\?.*$/, '')
    normalized = normalized.toLowerCase()
    if (_normMemo.size > 5000) _normMemo.clear()
    _normMemo.set(key, normalized)
    return normalized
}

/**
 * Rewrites the chain members of `list` so exactly the addon at `activeUrl`
 * is enabled and every other chain member is disabled.
 *
 * Chain membership is by normalized transport URL, with the engine's
 * manifest-id fallback: an addon whose URL is NOT in the chain but whose
 * unique manifest id maps to a chain member is treated as that member
 * (the swapped-URL case). Manifest ids that appear more than once in the
 * list are unreliable for that mapping and are skipped.
 *
 * Non-chain addons pass through untouched. `violationDetected` is true when
 * any chain member's stored flag disagreed with the derived state — the
 * engine consumes it for snapshotLooksClean/needsSync; other callers log it.
 *
 * @param {Array} list addon list (objects with transportUrl/flags/manifest)
 * @param {Array} chainUrls chain member URLs (raw or pre-normalized)
 * @param {string} activeUrl the tier that must end up enabled
 * @returns {{ list: Array, violationDetected: boolean }}
 */
export function applyOneActiveFlags(list, chainUrls, activeUrl) {
    const addonList = Array.isArray(list) ? list : []
    const normalizedChain = (Array.isArray(chainUrls) ? chainUrls : []).map(u => normalizeAddonUrl(u))
    const normalizedTarget = normalizeAddonUrl(activeUrl)

    // O(1) membership/index lookups: the naive includes/indexOf scans made the
    // pass O(addons x chain) per call, per chain, per connection, every cycle.
    const chainSet = new Set(normalizedChain)
    const chainIndex = new Map(normalizedChain.map((u, i) => [u, i]))

    // Duplicate manifest ids cannot identify a chain member reliably.
    const idCounts = new Map()
    addonList.forEach(addon => {
        if (!addon.manifest?.id) return
        idCounts.set(addon.manifest.id, (idCounts.get(addon.manifest.id) || 0) + 1)
    })
    const duplicateIds = new Set([...idCounts.entries()].filter(([, c]) => c > 1).map(([id]) => id))

    // manifest id -> chain URL, for addons whose URL was swapped but whose
    // identity still pins them to a chain slot.
    const chainIdMap = new Map()
    addonList.forEach(addon => {
        if (!addon.manifest?.id) return
        if (duplicateIds.has(addon.manifest.id)) return
        const normUrl = normalizeAddonUrl(addon.transportUrl)
        const idx = chainIndex.get(normUrl)
        if (idx !== undefined) chainIdMap.set(addon.manifest.id, normalizedChain[idx])
    })

    let violationDetected = false
    const updatedList = addonList.map(addon => {
        const normUrl = normalizeAddonUrl(addon.transportUrl)
        let effectiveUrl = normUrl
        let isChainMember = chainSet.has(normUrl)

        if (!isChainMember && addon.manifest?.id && chainIdMap.has(addon.manifest.id)) {
            isChainMember = true
            effectiveUrl = chainIdMap.get(addon.manifest.id)
        }

        if (isChainMember) {
            const shouldBeEnabled = effectiveUrl === normalizedTarget
            if (addon.flags?.enabled !== shouldBeEnabled) violationDetected = true
            return {
                ...addon,
                flags: { ...(addon.flags || {}), enabled: shouldBeEnabled }
            }
        }
        return addon
    })

    return { list: updatedList, violationDetected }
}
