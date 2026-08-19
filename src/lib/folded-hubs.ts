const FOLDED_HUBS_KEY = 'aio:folded-hubs'

function load(): Set<string> {
    try {
        const raw = localStorage.getItem(FOLDED_HUBS_KEY)
        return new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
        return new Set()
    }
}

function save(ids: Set<string>) {
    try { localStorage.setItem(FOLDED_HUBS_KEY, JSON.stringify([...ids])) } catch {}
}

export function markFoldedHub(accountId: string) {
    const ids = load()
    ids.add(accountId)
    save(ids)
}

export function clearFoldedHub(accountId: string) {
    const ids = load()
    if (ids.delete(accountId)) save(ids)
}

export function isFoldedHub(accountId: string): boolean {
    return load().has(accountId)
}
