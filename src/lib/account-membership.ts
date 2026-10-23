// Account IDs are stable across devices. Keep explicit deletions until a user
// restores that account; an old cloud snapshot must never recreate it by sight.
export interface AccountMembership {
    deletedAccounts: Record<string, number>
    restoredAccounts: Record<string, number>
}

export type AccountListImport = 'merge' | 'sync' | 'restore'

function readMarkers(value: unknown): Record<string, number> {
    if (value === undefined || value === null) return {}
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid account deletion metadata')
    const entries = Object.entries(value)
    if (entries.some(([id, stamp]) => !id || typeof stamp !== 'number' || !Number.isSafeInteger(stamp) || stamp <= 0)) {
        throw new Error('Invalid account deletion metadata')
    }
    return Object.fromEntries(entries) as Record<string, number>
}

export function mergeAccountMembership(local: Partial<AccountMembership>, remote: Partial<AccountMembership> = {}): AccountMembership {
    const latest = (a: unknown, b: unknown) => {
        const result = new Map(Object.entries(readMarkers(a)))
        for (const [id, stamp] of Object.entries(readMarkers(b))) {
            result.set(id, Math.max(result.get(id) ?? 0, stamp))
        }
        return Object.fromEntries(result)
    }
    const deletedAccounts = latest(local.deletedAccounts, remote.deletedAccounts)
    const restoredAccounts = latest(local.restoredAccounts, remote.restoredAccounts)
    for (const [id, stamp] of Object.entries(deletedAccounts)) {
        if (Object.hasOwn(restoredAccounts, id) && restoredAccounts[id] >= stamp) delete deletedAccounts[id]
    }
    return { deletedAccounts, restoredAccounts }
}

export function deleteAccountIds(state: AccountMembership, ids: string[], now = Date.now()): AccountMembership {
    const deletedAccounts = { ...state.deletedAccounts }
    for (const id of ids) {
        const previous = Object.hasOwn(deletedAccounts, id) ? deletedAccounts[id] : 0
        const restored = Object.hasOwn(state.restoredAccounts, id) ? state.restoredAccounts[id] : 0
        Object.defineProperty(deletedAccounts, id, { value: Math.max(now, previous + 1, restored + 1), enumerable: true, writable: true, configurable: true })
    }
    return { ...state, deletedAccounts }
}

export function restoreAccountIds(state: AccountMembership, ids: string[]): AccountMembership {
    const deletedAccounts = { ...state.deletedAccounts }
    const restoredAccounts = { ...state.restoredAccounts }
    for (const id of ids) {
        if (!Object.hasOwn(deletedAccounts, id)) continue
        Object.defineProperty(restoredAccounts, id, { value: deletedAccounts[id], enumerable: true, writable: true, configurable: true })
        delete deletedAccounts[id]
    }
    return { deletedAccounts, restoredAccounts }
}

// Absent accounts in a granular backup mean "leave accounts alone". Present
// malformed data must fail before any slice is imported, never coerce to [].
export function readAccountImport(data: Record<string, unknown>): Record<string, unknown>[] | undefined {
    if (data.accounts === undefined) return undefined
    const value = Array.isArray(data.accounts) ? data.accounts
        : data.accounts && typeof data.accounts === 'object' ? (data.accounts as Record<string, unknown>).accounts : null
    if (!Array.isArray(value)) throw new Error('Backup accounts must be an array')
    const ids = new Set<string>()
    for (const row of value) {
        if (!row || typeof row !== 'object' || Array.isArray(row)
            || !['id', 'name', 'email', 'authKey', 'apiKey'].some(k => typeof row[k] === 'string' && row[k].trim())
            || ['id', 'name', 'email', 'authKey', 'apiKey', 'password'].some(k => row[k] !== undefined && typeof row[k] !== 'string')
            || ['addons', 'connections', 'profiles'].some(k => row[k] !== undefined && !Array.isArray(row[k]))) {
            throw new Error('Backup contains an invalid account')
        }
        if (row.id && ids.has(row.id)) throw new Error('Backup contains duplicate account IDs')
        if (row.id) ids.add(row.id)
    }
    return value
}
