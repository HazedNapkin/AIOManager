import { lazy, type ComponentType } from 'react'

const CHUNK_RETRY_KEY = 'aiom:chunk-retry'

type LazyFactory = Parameters<typeof lazy>[0]

// A failed dynamic import (deploy window, transient network error) is otherwise
// fatal for the tab. Reload once; a second failure surfaces to the boundary.
export function lazyChunk<T extends { default: ComponentType<never> }>(load: () => Promise<T>) {
    return lazy((async (): Promise<T> => {
        try {
            const mod = await load()
            sessionStorage.removeItem(CHUNK_RETRY_KEY)
            return mod
        } catch (error) {
            if (!sessionStorage.getItem(CHUNK_RETRY_KEY)) {
                sessionStorage.setItem(CHUNK_RETRY_KEY, '1')
                window.location.reload()
            }
            throw error
        }
    }) as unknown as LazyFactory)
}
