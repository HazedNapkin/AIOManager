import { useMemo } from 'react'
import { useAccountStore } from '@/store/accountStore'
import { useJellyfinMediaConnections } from '@/components/providers/useJellyfinMedia'
import { compareMediaPlayback, jellyfinMediaActivity, mergeMediaItems, mergeMediaHistory, type MediaPlayback } from '@/lib/jellyfin/activity'
import type { ActivityItem } from '@/types/activity'
import { useWatchEventStore } from '@/store/watchEventStore'
import { getEpisodeIdentity } from '@/lib/activity-utils'

export interface MediaReadIssue {
    accountId: string
    connectionId: string
    productName: string
    label: string
    message: string
}

export function useJellyfinActivity(accountId?: string) {
    const accounts = useAccountStore(state => state.accounts)
    const deletedEventKeys = useWatchEventStore(state => state.deletedEventKeys)
    const scopes = useMemo(() => accounts.filter(account => !accountId || account.id === accountId)
        .flatMap(account => (account.connections || []).filter(connection => connection.platform === 'jellyfin').map(connection => ({ accountId: account.id, connection }))), [accounts, accountId])
    const { results, refresh } = useJellyfinMediaConnections(scopes)
    const activity = useMemo(() => {
    let history: ActivityItem[] = []
    let inProgress: ActivityItem[] = []
    const playback: MediaPlayback[] = []
    for (const result of results) {
        if (result.error) continue
        const colorIndex = accounts.findIndex(account => account.id === result.accountId)
        const account = accounts[colorIndex]
        if (!account) continue
        const media = jellyfinMediaActivity(account, colorIndex, result.connection, result.reads)
        history = mergeMediaHistory(history, media.history)
        inProgress = mergeMediaItems(inProgress, media.inProgress)
        playback.push(...media.playback)
    }
    playback.sort(compareMediaPlayback)
    const notDeleted = (item: ActivityItem) => {
        const deletedAt = deletedEventKeys[`${item.accountId}:${getEpisodeIdentity(item.itemId, item.uniqueItemId, item.season, item.episode, item.type)}`]
        return deletedAt === undefined || item.timestamp.getTime() > deletedAt
    }
    return { history: history.filter(notDeleted), inProgress: inProgress.filter(notDeleted), playback: playback.filter(entry => notDeleted(entry.item)) }
    }, [results, accounts, deletedEventKeys])
    const readIssues = useMemo(() => results.flatMap(result => {
        const source = { accountId: result.accountId, connectionId: result.connection.id, productName: result.connection.mediaServer?.productName || 'Jellyfin' }
        if (result.error) return [{ ...source, label: 'Connection', message: result.error }]
        const issues: MediaReadIssue[] = []
        for (const key of ['resume', 'played', 'sessions'] as const) {
            const read = result.reads[key]
            const label = key === 'resume' ? 'Continue watching' : key === 'played' ? 'Played titles' : 'Live playback'
            if (read.status !== 'waiting' && read.status !== 'success') issues.push({ ...source, label, message: read.message })
            else if (key !== 'sessions' && read.status === 'success' && 'complete' in read.data && !read.data.complete) {
                issues.push({ ...source, label, message: 'Only part of this server’s saved state was returned.' })
            }
        }
        return issues
    }), [results])
    return { ...activity, readIssues, refresh, busy: results.some(result => result.busy), initialLoading: results.some(result => result.initialLoading) }
}
