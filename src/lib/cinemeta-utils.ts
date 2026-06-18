import { CinemetaManifest, CinemetaConfigState, CinemetaPatchStatus } from '@/types/cinemeta'
import { AddonDescriptor } from '@/types/addon'

export function detectSearchArtifactsPatched(manifest: CinemetaManifest): boolean {
  if (!manifest || !Array.isArray(manifest.catalogs)) return false
  const catalogs = manifest.catalogs || []

  const hasSearchMovie = catalogs.some((c) => c.id === 'cinemeta.search' && c.type === 'movie')
  const hasSearchSeries = catalogs.some((c) => c.id === 'cinemeta.search' && c.type === 'series')

  const topMovie = catalogs.find((c) => c.id === 'top' && c.type === 'movie')
  const topSeries = catalogs.find((c) => c.id === 'top' && c.type === 'series')

  const topMovieHasSearchExtra =
    topMovie && Array.isArray(topMovie.extra) && topMovie.extra.some((e) => e.name === 'search')
  const topSeriesHasSearchExtra =
    topSeries && Array.isArray(topSeries.extra) && topSeries.extra.some((e) => e.name === 'search')

  return !hasSearchMovie && !hasSearchSeries && !topMovieHasSearchExtra && !topSeriesHasSearchExtra
}

export function detectStandardCatalogsPatched(manifest: CinemetaManifest): boolean {
  if (!manifest || !Array.isArray(manifest.catalogs)) return false
  const catalogs = manifest.catalogs || []

  const hasPopularMovie = catalogs.some((c) => c.id === 'top' && c.type === 'movie')
  const hasPopularSeries = catalogs.some((c) => c.id === 'top' && c.type === 'series')
  const hasNewMovie = catalogs.some((c) => c.id === 'year' && c.type === 'movie')
  const hasNewSeries = catalogs.some((c) => c.id === 'year' && c.type === 'series')
  const hasFeaturedMovie = catalogs.some((c) => c.id === 'imdbRating' && c.type === 'movie')
  const hasFeaturedSeries = catalogs.some((c) => c.id === 'imdbRating' && c.type === 'series')

  const popularMovieCatalog = catalogs.find((c) => c.id === 'top' && c.type === 'movie')
  const popularSeriesCatalog = catalogs.find((c) => c.id === 'top' && c.type === 'series')

  const isPopularMovieModified = Boolean(
    popularMovieCatalog &&
    Array.isArray(popularMovieCatalog.extra) &&
    popularMovieCatalog.extra.some((e) => e.name === 'search' && e.isRequired === true)
  )
  const isPopularSeriesModified = Boolean(
    popularSeriesCatalog &&
    Array.isArray(popularSeriesCatalog.extra) &&
    popularSeriesCatalog.extra.some((e) => e.name === 'search' && e.isRequired === true)
  )

  const allCatalogsRemoved =
    !hasPopularMovie &&
    !hasPopularSeries &&
    !hasNewMovie &&
    !hasNewSeries &&
    !hasFeaturedMovie &&
    !hasFeaturedSeries

  const popularModifiedAndOthersRemoved =
    hasPopularMovie &&
    hasPopularSeries &&
    isPopularMovieModified &&
    isPopularSeriesModified &&
    !hasNewMovie &&
    !hasNewSeries &&
    !hasFeaturedMovie &&
    !hasFeaturedSeries

  return allCatalogsRemoved || popularModifiedAndOthersRemoved
}

export function detectMetaResourcePatched(manifest: CinemetaManifest): boolean {
  const resources = Array.isArray(manifest.resources) ? manifest.resources : []
  return !resources.some(r =>
    r === 'meta' ||
    (typeof r === 'object' && r !== null && ((r as { name?: string; value?: string }).name === 'meta' || (r as { name?: string; value?: string }).value === 'meta'))
  )
}

export function removeCinemetaSearchArtifacts(manifest: CinemetaManifest): CinemetaManifest {
  const modifiedCatalogs = (manifest.catalogs || [])
    .filter((catalog) => catalog.id !== 'cinemeta.search')
    .map((catalog) => ({
      ...catalog,
      extra: catalog.extra?.filter((extra) => extra.name !== 'search'),
    }))

  return {
    ...manifest,
    catalogs: modifiedCatalogs,
  }
}

export function removeCinemetaStandardCatalogs(
  manifest: CinemetaManifest,
  keepSearchExtras: boolean
): CinemetaManifest {
  const standardCatalogIds = ['top', 'year', 'imdbRating']

  if (keepSearchExtras) {
    const modifiedCatalogs = (manifest.catalogs || []).map((catalog) => {
      if (catalog.id === 'top') {
        return {
          ...catalog,
          extra: catalog.extra?.map((extra) =>
            extra.name === 'search' ? { ...extra, isRequired: true } : extra
          ),
        }
      }
      return catalog
    })

    return {
      ...manifest,
      catalogs: modifiedCatalogs.filter(
        (catalog) => catalog.id !== 'year' && catalog.id !== 'imdbRating'
      ),
    }
  }

  return {
    ...manifest,
    catalogs: (manifest.catalogs || []).filter(
      (catalog) => !standardCatalogIds.some((id) => catalog.id === id)
    ),
  }
}

export function removeMeta(manifest: CinemetaManifest): CinemetaManifest {
  return {
    ...manifest,
    resources: (manifest.resources || []).filter(r =>
      r !== 'meta' &&
      !(typeof r === 'object' && r !== null && ((r as { name?: string; value?: string }).name === 'meta' || (r as { name?: string; value?: string }).value === 'meta'))
    ),
  }
}

export function applyCinemetaConfiguration(
  manifest: CinemetaManifest,
  config: CinemetaConfigState
): CinemetaManifest {
  let modifiedManifest = { ...manifest }

  if (config.removeSearchArtifacts) {
    modifiedManifest = removeCinemetaSearchArtifacts(modifiedManifest)
  }

  if (config.removeSearchArtifacts && config.removeStandardCatalogs) {
    modifiedManifest = removeCinemetaStandardCatalogs(modifiedManifest, false)
  } else if (config.removeStandardCatalogs) {
    modifiedManifest = removeCinemetaStandardCatalogs(modifiedManifest, true)
  }

  if (config.removeMetaResource) {
    modifiedManifest = removeMeta(modifiedManifest)
  }

  return modifiedManifest
}

export async function fetchOriginalCinemetaManifest(
  transportUrl: string,
  accountId: string = 'Unknown'
): Promise<CinemetaManifest> {
  const { fetchAddonManifest } = await import('@/api/addons')
  const descriptor = await fetchAddonManifest(transportUrl, accountId, true)
  return descriptor.manifest as CinemetaManifest
}

export function isCinemetaAddon(addon: AddonDescriptor): boolean {
  if (!addon) return false
  const CINEMETA_IDS = ['com.linvo.cinemeta', 'org.stremio.cinemeta', 'cinemeta']
  const transportUrl = addon.transportUrl?.toLowerCase() || ''

  return (
    CINEMETA_IDS.includes(addon.manifest.id) ||
    addon.manifest.name?.toLowerCase() === 'cinemeta' ||
    transportUrl.includes('v3-cinemeta.strem.io') ||
    (addon.flags?.official === true && addon.manifest.name === 'Cinemeta')
  )
}

export function isInternalAddon(addon: AddonDescriptor): boolean {
  if (!addon) return false

  if (isCinemetaAddon(addon)) return true

  const id = addon.manifest.id?.toLowerCase() || ''
  const name = addon.manifest.name?.toLowerCase() || ''
  const transportUrl = addon.transportUrl?.toLowerCase() || ''

  const INTERNAL_IDS = [
    'com.linvo.cinemeta',
    'org.stremio.cinemeta',
    'cinemeta',
    'local',
    'watchhub',
    'org.stremio.watchhub',
    'com.stremio.youtube',
    'youtube',
    'com.stremio.opensubtitles',
    'opensubtitles'
  ]
  if (INTERNAL_IDS.includes(id)) return true

  if (transportUrl.includes('v3-cinemeta.strem.io')) return true
  if (transportUrl.includes('127.0.0.1:11470/local-addon')) return true
  if (transportUrl.includes('watchhub.strem.io')) return true
  if (transportUrl.includes('v3-channels.strem.io')) return true // YouTube
  if (transportUrl.includes('caching.stremio.net/publicdomainmovies')) return true
  if (transportUrl.includes('opensubtitles-v3.strem.io')) return true

  if (name === 'cinemeta') return true
  if (name === 'watchhub') return true
  if (name.includes('local files')) return true
  if (name === 'youtube' && addon.flags?.official) return true

  return false
}

export function detectAllPatches(manifest: CinemetaManifest): CinemetaPatchStatus {
  return {
    searchArtifactsPatched: detectSearchArtifactsPatched(manifest),
    standardCatalogsPatched: detectStandardCatalogsPatched(manifest),
    metaResourcePatched: detectMetaResourcePatched(manifest),
  }
}

export function getCinemetaPosterUrl(itemId: string): string {
  if (!itemId) return ''
  return `https://live.metahub.space/poster/small/${itemId}/img`
}

/**
 * Detects if a URL should be proxied to avoid CORS issues
 */
export function isProxyableUrl(url: string | undefined): boolean {
  if (!url) return false
  const PROXYABLE_DOMAINS = ['metahub.space', 'strem.io']
  return PROXYABLE_DOMAINS.some(domain => url.includes(domain))
}
