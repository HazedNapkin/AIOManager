import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate'

// Wire format for compressed sync payloads: zlib (fflate deflateSync), base64-encoded.
// The push compressor and pull decompressor live together on purpose — any change
// MUST round-trip byte-identically, gated by sync-payload-codec.test.ts, which
// exists because a compressor swap once shipped without one and stored
// undecodable payloads.
export function compressSyncPayload(jsonStr: string): string {
    const bytes = deflateSync(strToU8(jsonStr))
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
}

export function decompressSyncPayload(base64String: string): string {
    const bytes = Uint8Array.from(atob(base64String), c => c.charCodeAt(0))
    return strFromU8(inflateSync(bytes))
}
