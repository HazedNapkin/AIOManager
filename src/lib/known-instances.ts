// Known public instances, curated; extend as the ecosystem changes
export interface KnownInstance {
    name: string
    baseUrl: string
}

export const KNOWN_AIOSTREAMS_INSTANCES: KnownInstance[] = [
    { name: 'ElfHosted (Stable)', baseUrl: 'https://aiostreams.elfhosted.com' },
    { name: 'Kuu (Stable)', baseUrl: 'https://aiostreams.stremio.ru' },
    { name: 'Kuu (Nightly)', baseUrl: 'https://aiostreams-nightly.stremio.ru' },
    { name: 'Viren (Nightly)', baseUrl: 'https://aiostreams.viren070.me' },
    { name: 'Midnight (Stable)', baseUrl: 'https://aiostreamsfortheweebsstable.midnightignite.me' },
    { name: 'Midnight (Nightly)', baseUrl: 'https://aiostreamsfortheweebs.midnightignite.me' },
    { name: 'Yeb (Stable)', baseUrl: 'https://aiostreams.fortheweak.cloud' },
    { name: 'Yeb (Nightly)', baseUrl: 'https://aiostreams-nightly.fortheweak.cloud' },
    { name: 'ATBP (Stable)', baseUrl: 'https://aio.atbphosting.com' },
    { name: 'Omni (Stable)', baseUrl: 'https://aiostreams.12312023.xyz' },
    { name: 'Wizaardd (Stable)', baseUrl: 'https://aiostreams-stable.forthewizards.uk' },
    { name: 'Wizaardd (Nightly)', baseUrl: 'https://aiostreams.forthewizards.uk' },
]

export const KNOWN_AIOMETADATA_INSTANCES: KnownInstance[] = [
    { name: 'ElfHosted', baseUrl: 'https://aiometadata.elfhosted.com' },
    { name: 'Kuu', baseUrl: 'https://aiometadata.stremio.ru' },
    { name: 'Viren', baseUrl: 'https://aiometadata.viren070.me' },
    { name: 'Midnight', baseUrl: 'https://aiometadatafortheweebs.midnightignite.me' },
    { name: 'Yeb', baseUrl: 'https://aiometadata.fortheweak.cloud' },
    { name: 'Nhyira', baseUrl: 'https://aiometadatafortheweak.nhyira.dev' },
    { name: 'Omni', baseUrl: 'https://aiometadata.12312023.xyz' },
    { name: 'ATBP', baseUrl: 'https://aiomd.atbphosting.com' },
    { name: 'Wizaardd', baseUrl: 'https://aiometadata.forthewizards.uk' },
]

export interface InstanceSelectOption {
    value: string
    label: string
}

// The user's own instances always come first so they stay visible; known catalog entries follow
export function mergeInstanceOptions(urls: string[], known: KnownInstance[]): InstanceSelectOption[] {
    const options: InstanceSelectOption[] = urls.map(url => ({ value: url, label: url }))
    for (const k of known) {
        if (!options.some(o => o.value === k.baseUrl)) options.push({ value: k.baseUrl, label: k.name })
    }
    return options
}
