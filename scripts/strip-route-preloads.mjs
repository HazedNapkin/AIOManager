// Post-build: route-only chunks (Kronorium docs engine + its markdown stack, ~1.4MB)
// must not modulepreload on every page load — they load on demand at /kronorium.
// Vite's html preload heuristic optimistically includes dynamic-import deps; this strips
// those links from dist/index.html after the build.
import { readFileSync, writeFileSync } from 'node:fs'

const ROUTE_ONLY = ['kronorium-docs-', 'source-']
const file = new URL('../dist/index.html', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let html = readFileSync(file, 'utf8')
let removed = 0
for (const marker of ROUTE_ONLY) {
    const re = new RegExp(`<link rel="modulepreload"[^>]*href="/assets/[^"]*${marker}[^"]*"[^>]*>\\s*`, 'g')
    html = html.replace(re, () => { removed++; return '' })
}
writeFileSync(file, html)
console.log(`[strip-route-preloads] removed ${removed} route-only preload link(s) from dist/index.html`)
