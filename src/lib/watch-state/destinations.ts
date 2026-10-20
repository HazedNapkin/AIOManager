import type { Account } from '../../types/account.ts'
import type { WatchStateDestination } from './types.ts'
import { nuvioWatchSession, stremioWatchSession, watchMigrationSources } from './sources.ts'

export function watchMigrationDestinations(account: Pick<Account, 'authKey' | 'connections'>) {
    return watchMigrationSources(account).filter(connection => connection.platform !== 'realstream')
}

export async function createWatchMigrationDestination(account: Account, key: CryptoKey, connectionId: string, signal: AbortSignal, assertCurrent: () => void = () => {}): Promise<WatchStateDestination> {
    const connection = watchMigrationSources(account).find(item => item.id === connectionId)
    if (!connection) throw new Error('This connection is not available as a watch-state destination.')
    if (connection.platform === 'realstream') throw new Error('Importing into RealStream is not enabled until playback is verified in its app. You can still use RealStream as a source.')
    signal.throwIfAborted()
    assertCurrent()
    if (connection.platform === 'jellyfin') {
        const [{ createJellyfinWatchDestination }, { decrypt }] = await Promise.all([import('./jellyfin.ts'), import('../crypto.ts')])
        return createJellyfinWatchDestination(connection, value => decrypt(value, key), signal, assertCurrent)
    }
    if (connection.platform === 'stremio') {
        const { createStremioWatchDestination } = await import('./destination-stremio.ts')
        return createStremioWatchDestination(await stremioWatchSession(account, connection, key, signal, assertCurrent))
    }
    if (connection.platform === 'nuvio') {
        const { createNuvioWatchDestination } = await import('./destination-nuvio.ts')
        return createNuvioWatchDestination(await nuvioWatchSession(account, connection, signal, ['sync_push_watched_items', 'sync_push_watch_progress'], assertCurrent))
    }
    throw new Error('This connection does not expose a supported watch-state write API.')
}
