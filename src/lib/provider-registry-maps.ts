import type { VaultProvider } from '@/types/vault'

// Maps the AIOStatus catalog taxonomy onto AIOManager's own vault groups and provider enum.
// Kept JSON-free so it can be unit-tested without loading the catalog data.

export const CATEGORY_TO_GROUP: Record<string, string | null> = {
    debrid: 'Debrid Services',
    'usenet-provider': 'Usenet Providers',
    'usenet-indexer': 'Usenet Indexers',
    'torrent-indexer': 'Torrent Indexers',
    subtitles: 'Subtitles',
    metadata: 'Metadata & Trackers',
    ai: 'AI Services',
    misc: 'Custom',
    addons: null, // manifest-URL entries belong in the addon library, not the credential vault
}

export const ID_TO_VAULT_PROVIDER: Record<string, VaultProvider> = {
    realdebrid: 'real-debrid',
    alldebrid: 'alldebrid',
    premiumize: 'premiumize',
    debridlink: 'debrid-link',
    torbox: 'torbox',
}

export const COMPOSITE_AUTH = new Set(['fields', 'user:pass', 'custom_torznab', 'key:user:pass', 'client:token'])

export const CREDENTIAL_LABELS: Record<string, string> = {
    token: 'API Token',
    key: 'API Key',
    'key:user:pass': 'API Key',
    'client:token': 'OAuth Token',
    'user:pass': 'Username : Password',
    fields: 'Connection details',
    custom_torznab: 'Endpoint URL',
}

export function groupForCategory(category: string): string | null {
    return category in CATEGORY_TO_GROUP ? CATEGORY_TO_GROUP[category] : 'Custom'
}

export function vaultProviderForId(id: string): VaultProvider {
    return ID_TO_VAULT_PROVIDER[id] ?? 'other'
}
