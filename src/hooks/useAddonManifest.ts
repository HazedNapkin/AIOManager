import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { fetchAddonManifest } from '@/api/addons'
import { AddonDescriptor } from '@/types/addon'
import { QUERY_STALE_TIME } from '@/lib/query-client'

/**
 * React Query pilot hook for addon manifests.
 *
 * Replicates the caching behavior of src/lib/manifest-cache.ts on top of the
 * QueryClient: results are cached per URL (lowercased key, like
 * getCachedManifest), considered fresh for 10 minutes (CACHE_TTL parity), and
 * persisted to IndexedDB via the localforage persister for offline reuse.
 * fetchAddonManifest already handles per-origin throttling and retries
 * internally, so queries are not retried at the query layer.
 */
export function useAddonManifest(url: string | null | undefined) {
  const trimmed = url?.trim() ?? ''
  const normalized = trimmed.replace(/^stremio:\/\//, 'https://')
  const enabled = normalized.startsWith('http')

  return useQuery<AddonDescriptor>({
    queryKey: ['addon-manifest', normalized.toLowerCase()],
    queryFn: () => fetchAddonManifest(normalized, 'Manifest-Query'),
    enabled,
    staleTime: QUERY_STALE_TIME,
    retry: false,
    placeholderData: keepPreviousData,
  })
}
