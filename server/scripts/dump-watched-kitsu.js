// TEMP validation script (delete after the kitsu mapping is settled). For series whose watched
// bitfield is anchored in the kitsu namespace, it checks which meta source's ordered video list the
// bitfield indices actually line up with -- Cinemeta (tt) vs the Anime-Kitsu addon (kitsu) -- using
// the anchor checksum (anchor id must equal videos[maxWatchedBit].id). Run on the server host:
//   node --env-file=.env server/scripts/dump-watched-kitsu.js
// Output is watch data only (no authKey/password).
import zlib from 'zlib'
import db from '../db.js'
import { decrypt } from '../crypto.js'
import { FALLBACK_KEYS, initializeEncryptionKeys } from '../keys.js'
import { STREMIO_API } from '../config.js'

const stubLog = { info: () => {}, warn: () => {} }
const MAX_PRINT = 10

function decode(watchedStr) {
    if (!watchedStr || typeof watchedStr !== 'string') return null
    const parts = watchedStr.split(':')
    if (parts.length < 3) return null
    const base64 = parts[parts.length - 1]
    const length = parseInt(parts[parts.length - 2], 10)
    const videoId = parts.slice(0, parts.length - 2).join(':')
    if (!base64 || !Number.isFinite(length)) return null
    let buf
    try { buf = zlib.inflateSync(Buffer.from(base64, 'base64')) } catch { return { videoId, length, bits: [] } }
    const limit = length > 0 ? Math.min(length, buf.length * 8) : buf.length * 8
    const bits = []
    for (let i = 0; i < limit; i++) if (buf[i >> 3] & (1 << (i & 7))) bits.push(i)
    return { videoId, length, bits }
}

async function fetchMeta(url) {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
        if (!res.ok) return null
        const json = await res.json()
        const videos = json?.meta?.videos
        return Array.isArray(videos) ? videos : null
    } catch { return null }
}

function report(label, videos, decoded) {
    if (!videos) { console.log(`   ${label}: (no meta)`); return }
    const maxBit = decoded.bits[decoded.bits.length - 1]
    const top = videos[maxBit]
    const match = top && top.id === decoded.videoId
    console.log(`   ${label}: ${videos.length} videos | videos[${maxBit}]=${top ? top.id : 'oob'} | anchor=${decoded.videoId} -> ${match ? 'MATCH ✅' : 'no'}`)
    if (videos[decoded.bits[0]]) console.log(`        firstBit[${decoded.bits[0]}]=${videos[decoded.bits[0]].id} (S${videos[decoded.bits[0]].season}E${videos[decoded.bits[0]].episode})`)
}

async function main() {
    initializeEncryptionKeys({ log: stubLog })
    await db.init()
    const creds = await db.query("SELECT account_id, auth_key FROM server_credentials WHERE credential_type = 'stremio' OR credential_type IS NULL")
    if (!creds.length) { console.log('No stremio credentials.'); return }

    let printed = 0
    for (const cred of creds) {
        if (printed >= MAX_PRINT) break
        let authKey
        try { authKey = decrypt(cred.auth_key, FALLBACK_KEYS) } catch { continue }
        if (!authKey) continue
        let json
        try {
            const res = await fetch(`${STREMIO_API}/datastoreGet`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'DatastoreGet', authKey, collection: 'libraryItem', all: true }),
                signal: AbortSignal.timeout(15000),
            })
            json = await res.json()
        } catch { continue }
        const lib = Array.isArray(json?.result) ? json.result : (json?.result?.library || [])

        for (const it of lib) {
            if (printed >= MAX_PRINT) break
            if (!['series', 'anime'].includes(it.type)) continue
            const decoded = decode(it.state?.watched)
            if (!decoded || decoded.bits.length === 0) continue
            // kitsu-anchored only (the unsolved case)
            if (!decoded.videoId.startsWith('kitsu:')) continue

            printed++
            const ttId = String(it._id || '').split(':')[0]
            const kitsuBase = decoded.videoId.split(':').slice(0, 2).join(':') // kitsu:46873
            console.log(`\n=== ${it.name} (lib _id ${it._id}) ===`)
            console.log(`   anchor=${decoded.videoId} length=${decoded.length} bits=${decoded.bits.length} range=[${decoded.bits[0]}..${decoded.bits[decoded.bits.length - 1]}] current=${it.state?.video_id}`)

            const cinemeta = ttId.startsWith('tt') ? await fetchMeta(`https://v3-cinemeta.strem.io/meta/series/${ttId}.json`) : null
            report('Cinemeta(tt)', cinemeta, decoded)

            for (const type of ['series', 'anime']) {
                const k = await fetchMeta(`https://anime-kitsu.strem.fun/meta/${type}/${kitsuBase}.json`)
                if (k) { report(`Kitsu(${type} ${kitsuBase})`, k, decoded); break }
            }
        }
    }
    if (printed === 0) console.log('No kitsu-anchored series with a populated bitfield found.')
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1) })
