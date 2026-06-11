import { AddonManifest, CatalogOverrides } from '@/types/addon'
import { CinemetaManifest, CinemetaConfigState } from '@/types/cinemeta'
import { applyCinemetaConfiguration } from '@/lib/cinemeta-utils'

export function getEffectiveManifest(addon: {
    manifest?: AddonManifest;
    metadata?: { customName?: string; customLogo?: string; customDescription?: string; cinemetaConfig?: CinemetaConfigState };
    catalogOverrides?: CatalogOverrides;
}): AddonManifest {
    const baseManifest = addon.manifest || {
        id: 'unknown',
        name: 'Unknown Addon',
        version: '0.0.0',
        description: '',
        resources: [],
        types: []
    }
    const manifest = {
        ...baseManifest,
        types: baseManifest.types || [],
        resources: baseManifest.resources || [],
        catalogs: baseManifest.catalogs || []
    } as AddonManifest

    if (addon.metadata?.customName) manifest.name = addon.metadata.customName
    if (addon.metadata?.customLogo) manifest.logo = addon.metadata.customLogo
    if (addon.metadata?.customDescription) manifest.description = addon.metadata.customDescription

    if (addon.catalogOverrides?.catalogs) {
        manifest.catalogs = addon.catalogOverrides.catalogs.map(catalog => ({
            ...catalog,
            extra: catalog.extra?.map(extra => ({ ...extra })),
        }))
    } else if (addon.catalogOverrides?.removed && manifest.catalogs) {
        const removedIds = new Set(addon.catalogOverrides.removed)
        manifest.catalogs = manifest.catalogs.filter(cat => !removedIds.has(cat.id))
    }

    if (addon.metadata?.cinemetaConfig) {
        return applyCinemetaConfiguration(manifest as CinemetaManifest, addon.metadata.cinemetaConfig) as AddonManifest
    }

    return manifest
}
