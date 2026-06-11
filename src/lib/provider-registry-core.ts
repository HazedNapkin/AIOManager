// Pure resolution logic for the provider registry, kept free of the catalog JSON and any
// relative runtime imports so the branching can be unit-tested directly under node --test.

interface RegistryLike {
    id: string
    name: string
    vaultProvider: string
}

interface KeyLike {
    catalogId?: string
    provider: string
    customProviderName?: string
}

// Resolve the registry entry that best matches an existing vault key, trying the most
// specific signal first: an explicit catalog id, then a first-class vault provider, then a
// name match against the catalog, else the Custom escape hatch.
export function resolveRegistryForKey<T extends RegistryLike>(
    key: KeyLike,
    registry: T[],
    catalog: T[],
    customEntry: T,
): T {
    if (key.catalogId) {
        const byId = registry.find((p) => p.id === key.catalogId)
        if (byId) return byId
    }
    if (key.provider !== 'other') {
        const byProvider = registry.find((p) => p.vaultProvider === key.provider)
        if (byProvider) return byProvider
    }
    if (key.customProviderName) {
        const name = key.customProviderName.trim().toLowerCase()
        const byName = catalog.find((p) => p.name.toLowerCase() === name)
        if (byName) return byName
    }
    return customEntry
}
