// Pure comparison for the Stremio datastoreMeta change-check.
// datastoreMeta returns [[itemId, mtimeMs], ...] rows covering the whole
// libraryItem collection; ids span every namespace (tt:, debtv:, ...) and
// must never be filtered by prefix. The library is provably unchanged only
// when the row count and every id->mtime pair match the cached snapshot.

export function metaIsUnchanged(
    cached: Record<string, number> | undefined,
    meta: Array<[string, number]> | null | undefined
): boolean {
    if (!cached || !meta) return false
    if (Object.keys(cached).length !== meta.length) return false
    for (const [id, mtimeMs] of meta) {
        if (!Object.prototype.hasOwnProperty.call(cached, id) || cached[id] !== mtimeMs) return false
    }
    return true
}
