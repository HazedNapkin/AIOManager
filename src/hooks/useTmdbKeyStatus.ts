import { useEffect, useState } from 'react'
import { listMetadataKeys } from '@/lib/metadata-keys'

export type TmdbKeyStatus = 'checking' | 'present' | 'absent' | 'assume'

const KEY_STATUS_TTL_MS = 60_000
const ASSUME_TTL_MS = 30_000
const KEY_STATUS_MAX_ATTEMPTS = 3

let cachedStatus: { status: 'present' | 'absent'; at: number } | null = null
let cachedAssumeAt: number | null = null
let inflightProbe: Promise<'present' | 'absent' | 'assume'> | null = null

function probeTmdbKeyStatus(): Promise<'present' | 'absent' | 'assume'> {
    if (cachedStatus && Date.now() - cachedStatus.at < KEY_STATUS_TTL_MS) {
        return Promise.resolve(cachedStatus.status)
    }
    if (cachedAssumeAt !== null && Date.now() - cachedAssumeAt < ASSUME_TTL_MS) {
        return Promise.resolve('assume')
    }
    if (inflightProbe) return inflightProbe
    inflightProbe = (async () => {
        for (let attempt = 0; attempt < KEY_STATUS_MAX_ATTEMPTS; attempt++) {
            try {
                const providers = await listMetadataKeys()
                const status: 'present' | 'absent' = providers.some(p => p.provider === 'tmdb') ? 'present' : 'absent'
                cachedStatus = { status, at: Date.now() }
                cachedAssumeAt = null
                return status
            } catch {
                if (attempt < KEY_STATUS_MAX_ATTEMPTS - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)))
                }
            }
        }
        // A failed ladder is cached only briefly: a remount within the TTL gets 'assume'
        // immediately, a later one retries the probe.
        cachedAssumeAt = Date.now()
        return 'assume'
    })().finally(() => { inflightProbe = null })
    return inflightProbe
}

export function useTmdbKeyStatus(): TmdbKeyStatus {
    const [status, setStatus] = useState<TmdbKeyStatus>('checking')
    useEffect(() => {
        let cancelled = false
        probeTmdbKeyStatus().then(result => { if (!cancelled) setStatus(result) })
        return () => { cancelled = true }
    }, [])
    return status
}
