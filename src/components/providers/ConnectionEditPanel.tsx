import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/ui/status-chip'
import { Trash2, ArrowLeft, MoreVertical } from 'lucide-react'
import { useState } from 'react'
import { useConnectionStore } from '@/store/connectionStore'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Connection, ConnectionStatus } from '@/types/connection'
import { PlatformLogo, ConnectionStatusPill, connectionLabel } from './ConnectionPrimitives'
import { displayStatus, tokenExpiry } from '@/lib/connection-format'
import { NuvioConnectionWorkspace } from './NuvioWorkspace'

export function ConnectionEditPanel({
    accountId,
    connection,
    status,
    onBack,
}: {
    accountId: string
    connection: Connection
    status: ConnectionStatus
    onBack: () => void
}) {
    const removeConnection = useConnectionStore(s => s.removeConnection)
    const [confirmRemove, setConfirmRemove] = useState(false)
    const isHydra = connection.connectionType === 'hydra-outbound'
    const name = connectionLabel(connection)
    const expiry = tokenExpiry(connection)
    const display = displayStatus(status, expiry)

    const handleRemove = () => {
        removeConnection(accountId, connection.id)
        onBack()
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs -ml-1" onClick={onBack}>
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Connections
                </Button>
                <div className="flex-1" />
                {confirmRemove ? (
                    <div className="flex items-center gap-1.5">
                        <Button size="sm" variant="subtle" className="h-7 text-xs" onClick={() => setConfirmRemove(false)}>Cancel</Button>
                        <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={handleRemove}>Remove</Button>
                    </div>
                ) : (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground">
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[160px]">
                            <DropdownMenuItem onClick={() => setConfirmRemove(true)} className="gap-2 text-xs text-destructive focus:text-destructive">
                                <Trash2 className="h-3.5 w-3.5" />
                                Remove connection
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>

            <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm">
                <div className="flex items-center gap-3">
                    <PlatformLogo platform={connection.platform} className="h-12 w-12 shrink-0" isHydra={isHydra} />
                    <div className="min-w-0 flex-1">
                        <p className="text-base font-semibold truncate">{name}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <ConnectionStatusPill status={display} />
                            {isHydra && <StatusChip size="sm" className="h-5 px-2 text-[10px] bg-muted/40">Outbound</StatusChip>}
                            {connection.capabilities.map(c => (
                                <StatusChip key={c} size="sm" className="h-5 px-2 text-[10px] bg-muted/40">{c}</StatusChip>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {connection.platform === 'nuvio' && (
                <NuvioConnectionWorkspace
                    accountId={accountId}
                    connection={connection}
                    status={status}
                />
            )}
        </div>
    )
}
