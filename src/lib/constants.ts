import { VaultProvider } from '@/types/vault'

export const STICKY_NOTE_MAX_LENGTH = 280

export const PROVIDERS: { value: VaultProvider; label: string; url?: string }[] = [
    { value: 'torbox', label: 'TorBox', url: 'https://torbox.app/settings' },
    { value: 'real-debrid', label: 'Real-Debrid', url: 'https://real-debrid.com/apitoken' },
    { value: 'premiumize', label: 'Premiumize', url: 'https://www.premiumize.me/account' },
    { value: 'alldebrid', label: 'AllDebrid', url: 'https://alldebrid.com/apikeys' },
    { value: 'debrid-link', label: 'Debrid-Link', url: 'https://debrid-link.com/apikey' },
    { value: 'other', label: 'Other/Custom' },
    { value: 'aiostreams', label: 'AIOStreams' },
]

const DEBRID_PROVIDERS: VaultProvider[] = ['real-debrid', 'torbox', 'premiumize', 'alldebrid', 'debrid-link']

export const VAULT_GROUPS = [
    'Debrid Services',
    'AIOStreams',
    'Usenet Providers',
    'Usenet Indexers',
    'Torrent Indexers',
    'Subtitles',
    'Metadata & Trackers',
    'AI Services',
    'VPN',
    'Custom',
] as const

export function deriveGroup(provider: VaultProvider): string {
    if (DEBRID_PROVIDERS.includes(provider)) return 'Debrid Services'
    if (provider === 'aiostreams') return 'AIOStreams'
    return 'Custom'
}

export function resolveVaultGroup(provider: VaultProvider, group?: string): string {
    const resolved = (group || deriveGroup(provider)).trim()
    return (VAULT_GROUPS as readonly string[]).includes(resolved) ? resolved : 'Custom'
}

export const PROVIDER_ABBR: Record<string, string> = {
    'real-debrid': 'RD',
    torbox: 'TB',
    premiumize: 'PM',
    alldebrid: 'AD',
    'debrid-link': 'DL',
    aiostreams: 'AI',
}

export function getKeyAbbr(key: { customAbbr?: string; provider: VaultProvider; name: string }): string {
    if (key.customAbbr) return key.customAbbr.substring(0, 2).toUpperCase()
    return PROVIDER_ABBR[key.provider] || key.name.substring(0, 2).toUpperCase()
}
