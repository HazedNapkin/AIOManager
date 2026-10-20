import { useEffect, useMemo, useState } from 'react'
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
    kind?: 'limit' | 'source-count'
}

export function useJellyfinActivity(accountId?: string) {
    const accounts = useAccountStore(state => state.accounts)
    const deletedEventKeys = useWatchEventStore(state => state.deletedEventKeys)
    const scopes = useMemo(() => accounts.filter(account => !accountId || account.id === accountId)
        .flatMap(account => (account.connections || []).filter(connection => connection.platform === 'jellyfin').map(connection => ({ accountId: account.id, connection }))), [accounts, accountId])
    const { results, refresh, busy, initialLoading } = useJellyfinMediaConnections(scopes)
    const [playbackExpiry, setPlaybackExpiry] = useState(0)
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
    // The expiry tick intentionally reruns the time-sensitive live-session gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [results, accounts, deletedEventKeys, playbackExpiry])
    useEffect(() => {
        let deadline = Infinity
        // Schedule from the live entries this render accepted. If a deadline
        // passed before effects ran, one immediate tick removes that entry.
        for (const entry of activity.playback) {
            const reportedAt = entry.item.mediaObservation?.reportedAt
            if (entry.state !== 'resume' && reportedAt !== undefined && Number.isFinite(reportedAt)) deadline = Math.min(deadline, reportedAt + 120_001)
        }
        if (!Number.isFinite(deadline)) return
        const timer = setTimeout(() => setPlaybackExpiry(value => value + 1), Math.max(1, deadline - Date.now()))
        return () => clearTimeout(timer)
    }, [activity.playback])
    const readIssues = useMemo(() => results.flatMap(result => {
        const source = { accountId: result.accountId, connectionId: result.connection.id, productName: result.connection.mediaServer?.productName || 'Jellyfin' }
        if (result.error) return [{ ...source, label: 'Connection', message: result.error }]
        const issues: MediaReadIssue[] = []
        for (const key of ['resume', 'played', 'sessions'] as const) {
            const read = result.reads[key]
            const label = key === 'resume' ? 'Continue watching' : key === 'played' ? 'Played titles' : 'Live playback'
            if (read.status !== 'waiting' && read.status !== 'success') issues.push({ ...source, label, message: read.message })
            else if (key !== 'sessions' && read.status === 'success' && 'complete' in read.data && !read.data.complete) {
                const data = read.data
                if (data.inProgress === true) continue
                if (data.limited) {
                    const count = data.items.length.toLocaleString()
                    const total = data.total === null ? '' : ` of ${data.total.toLocaleString()}`
                    issues.push({ ...source, label, kind: 'limit', message: `Showing ${count}${total} titles. Activity loads up to ${data.limit.toLocaleString()} per connection.` })
                } else {
                    const count = data.items.length.toLocaleString()
                    const returned = data.total === null ? `${count} titles were returned` : `${count} of ${data.total.toLocaleString()} titles were returned`
                    const aiom = result.connection.mediaServer?.product === 'aiometadata' || source.productName.toLowerCase() === 'aiometadata'
                    const sourceCountOnly = key === 'played' && aiom && data.paginationComplete === true
                        && data.total !== null && data.total > data.items.length
                    const explanation = sourceCountOnly && data.total !== null
                        ? `All ${count} returned titles are loaded. AIOMetadata reports ${data.total.toLocaleString()} history entries; that total may include filtered, duplicate or unavailable entries.`
                        : `${returned}. The server listing could not be verified as complete; all returned titles are loaded.`
                    issues.push({ ...source, label, message: explanation, ...(sourceCountOnly ? { kind: 'source-count' as const } : {}) })
                }
            }
        }
        return issues
    }), [results])
    return { ...activity, readIssues, refresh, busy, initialLoading }
}
