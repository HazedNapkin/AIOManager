// Shared one-active flag derivation, extracted from engine.js for testability.

function normalizeAddonUrl(url) {
    if (!url) return ''
    let normalized = String(url).trim()
    if (!/^(?:https?|stremio):\/\//i.test(normalized)) normalized = `https://${normalized}`
    normalized = normalized.replace(/^stremio:\/\//i, 'https://')
    normalized = normalized.replace(/^http:\/\//i, 'https://')
    normalized = normalized.replace(/\/manifest\.json$/i, '')
    normalized = normalized.replace(/\/+$/, '')
    normalized = normalized.replace(/\?.*$/, '')
    return normalized.toLowerCase()
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
        const idx = normalizedChain.indexOf(normUrl)
        if (idx !== -1) chainIdMap.set(addon.manifest.id, normalizedChain[idx])
    })

    let violationDetected = false
    const updatedList = addonList.map(addon => {
        const normUrl = normalizeAddonUrl(addon.transportUrl)
        let effectiveUrl = normUrl
        let isChainMember = normalizedChain.includes(normUrl)

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
