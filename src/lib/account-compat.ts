import type { Account } from '@/types/account'

// Back-compat bridges (B24). v1.8.5 (commit dfbbc341) stored accounts flat: a root `authKey`
// and `email`, with no `connections[]`. These read that flat shape OR the newer connection
// object transparently, so accounts from the last public build keep working unmigrated.
// Pure + dependency-free so they can be unit-tested (see account-compat.test.ts).

export function getStremioConnection(account: Account) {
    const conn = account.connections?.find(c => c.platform === 'stremio')
    if (conn) return conn
    if (!account.authKey || account.authKey.length <= 60) return null
    return {
        id: `${account.id}:stremio`,
        platform: 'stremio',
        connectionType: 'native' as const,
        enabled: true,
        status: account.status,
        credentials: {
            authKey: account.authKey,
            ...(account.email ? { email: account.email } : {}),
        },
        lastSync: 0,
        lastKnownAddonCount: 0,
        capabilities: ['addons'],
        consecutiveFailures: 0,
    }
}

export function getStremioAuthKey(account: Account): string {
    const conn = getStremioConnection(account)
    return conn?.credentials?.authKey || account.authKey || ''
}

export function getAccountEmail(account: Account): string | undefined {
    const conn = getStremioConnection(account)
    return conn?.credentials?.email || account.email
}
