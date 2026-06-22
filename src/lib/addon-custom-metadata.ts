import type { AddonManifest } from '@/types/addon'

type CustomMetadata = {
    customName?: string
    customLogo?: string
    customDescription?: string
    [key: string]: unknown
}

// Mirrors getHostnameIdentifier in addon-identifier.ts. Inlined so this module stays
// dependency-free and unit-testable under `node --test` (no path-alias runtime imports).
function hostnameFallback(transportUrl: string): string {
    try {
        const hostname = new URL(transportUrl).hostname
        return hostname
            .replace(/^www\./, '')
            .replace(/\.[^.]+$/, '')
            .split(/[.-]/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
    } catch {
        return 'Unknown Addon'
    }
}

/**
 * Migrate a custom name/logo/description that a user baked into the live (remote) manifest into
 * explicit metadata fields, so it survives future merges. Inference is absent-only: a field is
 * only filled when the metadata field is missing, so an explicit user value is never overwritten
 * by an inferred one and a later addon self-rename can't be pinned forever.
 */
export function inferCustomMetadata(
    metadata: CustomMetadata,
    remoteManifest: Partial<AddonManifest> | undefined,
    repairedManifest: Partial<AddonManifest> | undefined,
    transportUrl: string,
): CustomMetadata {
    if (!remoteManifest || !repairedManifest) return metadata
    const next = { ...metadata }
    const hostFallback = hostnameFallback(transportUrl)

    if (!next.customName &&
        remoteManifest.name &&
        remoteManifest.name !== repairedManifest.name &&
        remoteManifest.name !== hostFallback) {
        next.customName = remoteManifest.name
    }
    if (!next.customLogo && remoteManifest.logo && remoteManifest.logo !== repairedManifest.logo) {
        next.customLogo = remoteManifest.logo
    }
    const isFallbackDesc = (s: string) => s.startsWith('Addon from ') &&
        (s.includes(hostFallback) || transportUrl.includes(s.split('Addon from ')[1] || '____'))
    if (!next.customDescription &&
        remoteManifest.description &&
        remoteManifest.description !== repairedManifest.description &&
        !isFallbackDesc(remoteManifest.description)) {
        next.customDescription = remoteManifest.description
    }
    return next
}
