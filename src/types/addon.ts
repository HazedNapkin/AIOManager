export interface Catalog {
  id: string
  type: string
  name?: string
  extra?: Array<{
    name: string
    isRequired?: boolean
    options?: string[]
  }>
}

export interface AddonManifest {
  id: string
  name: string
  version: string
  description: string
  logo?: string
  background?: string
  types?: string[]
  catalogs?: Catalog[]
  resources?: Array<string | { name: string; types?: string[]; idPrefixes?: string[] }>
  idPrefixes?: string[]
  behaviorHints?: {
    adult?: boolean
    p2p?: boolean
    configurable?: boolean
    configurationRequired?: boolean
  }
}

export interface AddonDescriptor {
  transportUrl: string
  transportName?: string
  manifest: AddonManifest
  flags?: {
    official?: boolean
    protected?: boolean
    enabled?: boolean
  }
  metadata?: {
    customName?: string
    customLogo?: string
    customDescription?: string
    lastUpdated?: number
    cinemetaConfig?: import('./cinemeta').CinemetaConfigState
    hideConfigure?: boolean
  }
  catalogOverrides?: CatalogOverrides
  syncToLibrary?: boolean
  note?: string
}

export interface CatalogOverrides {
  removed: string[]
  catalogs?: Catalog[]
}
