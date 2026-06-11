// Stremio WatchedBitField decoder (client port of the server-validated logic).
//
// Format: "{videoId}:{length}:{base64(deflate(bitfield))}". videoId itself contains colons
// (tt1355642:1:5, kitsu:46873:11), so parse from the RIGHT: last = base64, second-last = length
// (total videos spanned), the rest = videoId. Set bit i => the (i+1)-th video in the series'
// ordered video list is watched. The base64 payload is zlib-wrapped deflate (starts 0x78 / "eJx"),
// so DecompressionStream('deflate') (not 'deflate-raw') inflates it.
//
// Verified against real library items (see server vectors): Physical:100 -> 14 eps; SPY x FAMILY
// -> eps 38-40; FMAB -> all-zero (flagged-watched but no per-episode bits). The bitfield is
// authoritative WHEN populated; Stremio leaves it empty/zero for some watch patterns, so callers
// must treat an empty result as "no data", not "nothing watched".

export interface DecodedBitfield {
    videoId: string
    length: number
    watchedIndices: number[]
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
    const ds = new DecompressionStream('deflate')
    const writer = ds.writable.getWriter()
    void writer.write(bytes)
    void writer.close()
    const ab = await new Response(ds.readable).arrayBuffer()
    return new Uint8Array(ab)
}

export async function decodeWatchedBitfield(watchedStr: string | null | undefined): Promise<DecodedBitfield | null> {
    if (!watchedStr || typeof watchedStr !== 'string') return null

    const parts = watchedStr.split(':')
    if (parts.length < 3) return null

    const base64 = parts[parts.length - 1]
    const length = parseInt(parts[parts.length - 2], 10)
    const videoId = parts.slice(0, parts.length - 2).join(':')
    if (!base64 || !Number.isFinite(length)) return null

    let buf: Uint8Array
    try {
        buf = await inflate(base64ToBytes(base64))
    } catch {
        return { videoId, length, watchedIndices: [] }
    }

    const limit = length > 0 ? Math.min(length, buf.length * 8) : buf.length * 8
    const watchedIndices: number[] = []
    for (let idx = 0; idx < limit; idx++) {
        if (buf[idx >> 3] & (1 << (idx & 7))) watchedIndices.push(idx)
    }
    return { videoId, length, watchedIndices }
}
