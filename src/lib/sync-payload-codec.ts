// Wire format: raw DEFLATE bytes encoded as standard base64.
import { base64ToBytes, bytesToBase64 } from './base64.ts'

// Large snapshots should not monopolize the main thread. Native streams process
// the same raw format asynchronously; small payloads avoid the stream overhead.
const STREAM_COMPRESSION_THRESHOLD = 128 * 1024
const STREAM_DECOMPRESSION_THRESHOLD = 64 * 1024

function rawCompressionStream(): CompressionStream | null {
    if (typeof CompressionStream === 'undefined') return null
    try { return new CompressionStream('deflate-raw') } catch { return null }
}

function rawDecompressionStream(): DecompressionStream | null {
    if (typeof DecompressionStream === 'undefined') return null
    try { return new DecompressionStream('deflate-raw') } catch { return null }
}

let fflatePromise: Promise<typeof import('fflate')> | null = null
function loadFflate() {
    if (!fflatePromise) fflatePromise = import('fflate')
    return fflatePromise
}

export async function compressSyncPayload(jsonStr: string): Promise<string> {
    const stream = jsonStr.length >= STREAM_COMPRESSION_THRESHOLD ? rawCompressionStream() : null
    if (stream) {
        const compressed = await new Response(new Blob([jsonStr]).stream().pipeThrough(stream)).arrayBuffer()
        return bytesToBase64(new Uint8Array(compressed))
    }
    const { deflateSync, strToU8 } = await loadFflate()
    const bytes = deflateSync(strToU8(jsonStr))
    return bytesToBase64(bytes)
}

export async function decompressSyncPayload(base64String: string): Promise<string> {
    const bytes = base64ToBytes(base64String)
    const stream = bytes.length >= STREAM_DECOMPRESSION_THRESHOLD ? rawDecompressionStream() : null
    if (stream) {
        return new Response(new Blob([bytes.buffer as ArrayBuffer]).stream().pipeThrough(stream)).text()
    }
    const { inflateSync, strFromU8 } = await loadFflate()
    return strFromU8(inflateSync(bytes))
}
