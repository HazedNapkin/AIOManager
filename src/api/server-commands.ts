import type { paths } from './schema'
import { typedClient } from './typed-client'

export type ServerCommandId = paths['/api/commands']['post']['requestBody']['content']['application/json']['id']

export type ServerCommandJob = paths['/api/commands/{jobId}']['get']['responses']['200']['content']['application/json']

export type ServerCommandResult = NonNullable<ServerCommandJob['results']>[number]

export async function enqueueServerCommand(id: ServerCommandId, accountIds: string[]): Promise<string> {
    const { data, error } = await typedClient.POST('/api/commands', { body: { id, accountIds } })
    if (error) throw new Error(error.error)
    return data.jobId
}

export async function getServerCommandJob(jobId: string): Promise<ServerCommandJob> {
    const { data, error } = await typedClient.GET('/api/commands/{jobId}', { params: { path: { jobId } } })
    if (error) throw new Error(error.error)
    return data
}

// TODO(phase-1c): BatchOperationsDialog's protect-all / unprotect-all execution plans
// (registry.ts buildProtectionPlan) can adopt this server queue instead of driving the
// browser-side loop: enqueueServerCommand('protect-all', accountIds) then poll
// getServerCommandJob until status is 'completed' or 'failed'. Requires the accounts to
// have server-side Stremio credentials (Connections); accounts without one are returned
// per-account with ok=false. The dialog keeps its local orchestration until the
// dual-write phase retires it.
