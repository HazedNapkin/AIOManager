import localforage from 'localforage'
import { QueryClient } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'

/**
 * React Query pilot (Bold Idea 3).
 *
 * Defaults mirror the manual TTL caches the app already uses (see
 * manifest-cache.ts): entries are considered fresh for 10 minutes, there is
 * no refetching on window focus / reconnect, and fetches are not retried at
 * the query layer (stremioClient already retries internally and addon
 * origins are rate-limit sensitive).
 */

// Matches CACHE_TTL in src/lib/manifest-cache.ts
export const QUERY_STALE_TIME = 10 * 60 * 1000

// Persisted cache lives longer than the stale window so an entry can survive
// a reload and simply refetch on next use once it goes stale.
const QUERY_GC_TIME = 30 * 60 * 1000

// Follows the repo's 'aioman:' localforage key convention (see storage-migration.ts)
export const QUERY_PERSIST_KEY = 'aioman:rq-persist'

// Matches PERSIST_DEBOUNCE_MS in src/lib/manifest-cache.ts
const QUERY_PERSIST_THROTTLE_MS = 2000

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_STALE_TIME,
      gcTime: QUERY_GC_TIME,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
    },
  },
})

// localforage implements the AsyncStorage interface (getItem/setItem/removeItem),
// backed by IndexedDB. This gives the query cache the same offline persistence
// parity that manifest-cache.ts implements manually.
export const queryPersister = createAsyncStoragePersister({
  storage: localforage,
  key: QUERY_PERSIST_KEY,
  throttleTime: QUERY_PERSIST_THROTTLE_MS,
})
