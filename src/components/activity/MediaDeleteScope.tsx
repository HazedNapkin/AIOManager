import { useMemo } from 'react'
import type { Account } from '@/types/account'
import type { ActivityItem } from '@/types/activity'
import { useUIStore } from '@/store/uiStore'
import { maskEmailLevel, maskNameLevel, maskProfileLevel } from '@/lib/utils'

export function MediaDeleteScope({ items, accountById }: { items: ActivityItem[]; accountById: Map<string, Account> }) {
    const privacy = useUIStore(state => state.isPrivacyModeEnabled)
    const nameLevel = useUIStore(state => state.privacyLevelNames)
    const emailLevel = useUIStore(state => state.privacyLevelEmail)
    const profileLevel = useUIStore(state => state.privacyLevelProfiles)
    const targets = useMemo(() => {
        const rows = new Map<string, { item: ActivityItem; connectionId: string; itemId: string }>()
        for (const item of items) {
            for (const target of item.mediaTargets || []) {
                const key = JSON.stringify([item.accountId, target.connectionId, target.itemId])
                if (!rows.has(key)) rows.set(key, { item, ...target })
            }
        }
        return Array.from(rows.entries())
    }, [items])

    if (!targets.length) return null
    const name = (value: string) => value.includes('@')
        ? maskEmailLevel(value, privacy ? emailLevel : 0)
        : maskNameLevel(value, privacy ? nameLevel : 0)
    const identifier = (value: string) => maskProfileLevel(value, privacy ? profileLevel : 0)

    return (
        <div role="region" aria-label="Media-server deletion targets" className="space-y-2 text-left">
            <p>Watched state and resume progress will also be cleared for these {targets.length} media-server {targets.length === 1 ? 'target' : 'targets'}:</p>
            <ul className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border/40 bg-muted/20 p-3 text-xs">
                {targets.map(([key, target]) => {
                    const connection = accountById.get(target.item.accountId)?.connections?.find(value => value.id === target.connectionId && value.platform === 'jellyfin')
                    const server = connection?.mediaServer
                    return (
                        <li key={key} className="space-y-1 break-words">
                            <p className="font-semibold text-foreground">{target.item.name}{target.item.season != null && target.item.episode != null ? ` · S${target.item.season} E${target.item.episode}` : ''}</p>
                            <p>{server?.productName || 'Media server'} · {server?.serverName ? name(server.serverName) : identifier(server?.serverId || 'Server identity unavailable')}</p>
                            <p>User: {server?.userName ? name(server.userName) : identifier(server?.userId || 'User identity unavailable')}</p>
                            <p className="break-all font-mono">Server ID: {identifier(server?.serverId || 'Unavailable')}</p>
                            {!server?.serverId && <p className="break-all font-mono">Connection ID: {identifier(target.connectionId)}</p>}
                            <p className="break-all font-mono">User ID: {identifier(server?.userId || 'Unavailable')} · Item ID: {target.itemId}</p>
                            {!connection?.enabled && <p className="text-warning">Check or enable this connection before clearing this target.</p>}
                        </li>
                    )
                })}
            </ul>
            <p className="text-xs">Each server may forward this change to its configured trackers.</p>
        </div>
    )
}
