// Wire format for compressed sync payloads: zlib (fflate deflateSync), base64-encoded.
// The push compressor and pull decompressor live together on purpose - any change
// MUST round-trip byte-identically, gated by sync-payload-codec.test.ts, which
// exists because a compressor swap once shipped without one and stored
// undecodable payloads.

// fflate loads on first use: nothing in the boot graph needs 36KB of zlib until a
// compressed payload actually moves. Memoized so concurrent calls share one import.
let fflatePromise: Promise<typeof import('fflate')> | null = null
function loadFflate() {
    if (!fflatePromise) fflatePromise = import('fflate')
    return fflatePromise
}

export async function compressSyncPayload(jsonStr: string): Promise<string> {
    const { deflateSync, strToU8 } = await loadFflate()
    const bytes = deflateSync(strToU8(jsonStr))
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
}

export async function decompressSyncPayload(base64String: string): Promise<string> {
    const { inflateSync, strFromU8 } = await loadFflate()
    const bytes = Uint8Array.from(atob(base64String), c => c.charCodeAt(0))
    return strFromU8(inflateSync(bytes))
}
