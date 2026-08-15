export type AddonParamType = 'aiometadata' | 'aiostreams' | null

export const NO_SELECTION = '__none__'

export interface AddonParams {
    tag: string | null
    variant: string | null
}

export interface VariantInfo {
    id: string
    name?: string
    enabled?: boolean
}

interface ManifestLike {
    id?: string
    name?: string
}

const AIOMETADATA_MANIFEST_IDS = ['aio-metadata', 'aiometadata']
const AIOSTREAMS_MANIFEST_IDS = ['community.aiostreams', 'aiostreams']
const AIOMETADATA_URL_PATTERNS = ['aiometadata', 'aio-metadata', 'aiometedata']
const AIOSTREAMS_URL_PATTERNS = ['aiostreams', 'aio-streams']

function urlLooksLikeAio(url: string): boolean {
    const lower = url.toLowerCase()
    return AIOMETADATA_URL_PATTERNS.some(p => lower.includes(p)) || AIOSTREAMS_URL_PATTERNS.some(p => lower.includes(p))
}

export function getAddonParamType(url: string, manifest?: ManifestLike | null): AddonParamType {
    if (manifest) {
        const id = manifest.id?.toLowerCase() || ''
        const name = manifest.name?.toLowerCase() || ''
        if (AIOMETADATA_MANIFEST_IDS.some(k => id.includes(k)) || name.includes('aiometadata')) return 'aiometadata'
        if (AIOSTREAMS_MANIFEST_IDS.some(k => id.includes(k)) || name.includes('aiostreams')) return 'aiostreams'
        return null
    }

    const lower = url.toLowerCase()
    if (AIOMETADATA_URL_PATTERNS.some(p => lower.includes(p))) return 'aiometadata'
    if (AIOSTREAMS_URL_PATTERNS.some(p => lower.includes(p))) return 'aiostreams'
    return null
}

export function extractAddonParams(url: string): { base: string; params: AddonParams } {
    let tag: string | null = null
    let variant: string | null = null
    let base = url
    const isAioUrl = urlLooksLikeAio(url)

    try {
        const parsed = new URL(url)

        if (parsed.searchParams.has('tag')) {
            tag = parsed.searchParams.get('tag')
            parsed.searchParams.delete('tag')
        }

        const pathParts = parsed.pathname.split('/').filter(Boolean)
        const vIndex = pathParts.findIndex((p, i) => p === 'v' && i < pathParts.length - 1)
        if (vIndex >= 0 && isAioUrl) {
            variant = pathParts[vIndex + 1]
            pathParts.splice(vIndex, 2)
            parsed.pathname = '/' + pathParts.join('/')
        }

        if (!variant && isAioUrl) {
            const vParam = parsed.searchParams.get('v')
            if (vParam) {
                variant = vParam
                parsed.searchParams.delete('v')
            }
        }

        base = parsed.toString().replace(parsed.origin, '')
        if (!base.startsWith('http')) {
            base = parsed.origin + base
        }
    } catch {
        const tagMatch = url.match(/[?&]tag=([^&]+)/)
        if (tagMatch) tag = decodeURIComponent(tagMatch[1])

        const vPathMatch = url.match(/\/v\/([^/?]+)/)
        if (vPathMatch && isAioUrl) variant = vPathMatch[1]

        if (!variant && isAioUrl) {
            const vQueryMatch = url.match(/[?&]v=([^&]+)/)
            if (vQueryMatch) variant = decodeURIComponent(vQueryMatch[1])
        }

        if (tag || variant) {
            base = url
                .replace(/[?&]tag=[^&]*/, '')
            if (variant) {
                base = base
                    .replace(/[?&]v=[^&]*/, '')
                    .replace(/\/v\/[^/?]+/, '')
            }
            base = base
                .replace(/&&/g, '&')
                .replace(/\?$/, '')
        }
    }

    return { base, params: { tag, variant } }
}

function applyVariantToBase(base: string, variantId: string, location: 'path' | 'query'): string {
    if (location === 'path') {
        const manifestIdx = base.indexOf('/manifest.json')
        if (manifestIdx >= 0) {
            return `${base.substring(0, manifestIdx)}/v/${variantId}${base.substring(manifestIdx)}`
        }
        return `${base}/v/${variantId}/manifest.json`
    }
    const sep = base.includes('?') ? '&' : '?'
    return `${base}${sep}v=${encodeURIComponent(variantId)}`
}

function applyTagToBase(base: string, tag: string): string {
    const sep = base.includes('?') ? '&' : '?'
    return `${base}${sep}tag=${encodeURIComponent(tag)}`
}

export function buildTaggedUrl(baseUrl: string, tag: string | null): string {
    const { base, params } = extractAddonParams(baseUrl)
    let result = base
    if (params.variant) {
        result = applyVariantToBase(result, params.variant, 'query')
    }
    if (tag && tag.trim()) {
        result = applyTagToBase(result, tag.trim())
    }
    return result
}

export function buildVariantUrl(
    baseUrl: string,
    variantId: string | null,
    location: 'path' | 'query' = 'query'
): string {
    const { base, params } = extractAddonParams(baseUrl)
    let result = base
    if (params.tag) {
        result = applyTagToBase(result, params.tag)
    }
    if (variantId && variantId.trim()) {
        result = applyVariantToBase(result, variantId.trim(), location)
    }
    return result
}

export function hasAddonParams(url: string): boolean {
    const { params } = extractAddonParams(url)
    return params.tag !== null || params.variant !== null
}

export function extractVariantsFromConfig(config: Record<string, unknown>): VariantInfo[] {
    const variants = config?.variants
    if (!Array.isArray(variants)) return []
    return variants
        .filter((v): v is Record<string, unknown> => v && typeof v === 'object' && typeof v.id === 'string')
        .filter(v => v.enabled !== false)
        .map(v => ({
            id: String(v.id),
            name: typeof v.name === 'string' ? v.name : String(v.id),
            enabled: v.enabled !== false,
        }))
}

export function getVariantSelectorLocation(config: Record<string, unknown>): 'path' | 'query' {
    const loc = config?.variantSelectorLocation
    return loc === 'path' ? 'path' : 'query'
}
