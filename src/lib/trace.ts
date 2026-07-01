// Client trace sink. Records structured entries into an in-memory ring buffer (always, so a
// devtools `aiomTrace.dump()` works regardless of flags or a fetch-wrapping extension) and,
// when localStorage.aiomTrace==='1', also batch-POSTs them to /api/debug/trace for the file log.
// console.* is stripped by esbuild (drop:['console']) even in dev, so dump() returns a string
// the user copies with `copy(aiomTrace.dump())` instead of streaming to the console.

type TraceData = Record<string, unknown>

interface TraceEntry extends TraceData {
  t: string
  scope: string
  event: string
}

const RING_MAX = 300
const ring: TraceEntry[] = []

const isOn = (): boolean => {
  try {
    return localStorage.getItem('aiomTrace') === '1'
  } catch {
    return false
  }
}

let buffer: TraceEntry[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

// Ship via sendBeacon/XHR, not fetch: a fetch-wrapping browser extension (injectScriptAdjust)
// was aborting the POST. sendBeacon and XHR bypass the window.fetch wrapper entirely.
const send = (entries: TraceEntry[]) => {
  const json = JSON.stringify({ entries })
  try {
    if (navigator.sendBeacon && navigator.sendBeacon('/api/debug/trace', new Blob([json], { type: 'application/json' }))) return
  } catch {
    /* fall through to XHR */
  }
  try {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/debug/trace', true)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.send(json)
  } catch {
    /* never throw from a trace */
  }
}

const flush = () => {
  flushTimer = null
  if (buffer.length === 0) return
  const entries = buffer
  buffer = []
  send(entries)
}

export const traceEnabled = isOn

export function trace(scope: string, event: string, data: TraceData = {}) {
  const entry: TraceEntry = { t: new Date().toISOString(), scope, event, ...data }
  ring.push(entry)
  if (ring.length > RING_MAX) ring.shift()
  // In dev, always ship to the server file so no flag/console step is needed; in a prod build
  // only ship when the user has explicitly opted in via localStorage.
  if (!import.meta.env.DEV && !isOn()) return
  buffer.push(entry)
  if (buffer.length >= 15) {
    flush()
    return
  }
  if (!flushTimer) flushTimer = setTimeout(flush, 400)
}

export const briefAddons = (addons: Array<{ manifest?: { id?: string }; transportUrl?: string }> = []) =>
  (Array.isArray(addons) ? addons : []).map(a => ({
    id: a?.manifest?.id || '?',
    url: (a?.transportUrl || '').slice(-48),
  }))

const formatEntry = (e: TraceEntry): string => {
  const { t, scope, event, ...rest } = e
  const time = t.slice(11, 23)
  let body = ''
  try {
    body = JSON.stringify(rest)
  } catch {
    body = '[unserializable]'
  }
  return `${time} ${scope}/${event} ${body}`
}

const dump = (): string => ring.map(formatEntry).join('\n')

if (typeof window !== 'undefined') {
  ;(window as unknown as { aiomTrace?: unknown }).aiomTrace = {
    on: () => { try { localStorage.setItem('aiomTrace', '1') } catch { /* ignore */ } },
    off: () => { try { localStorage.removeItem('aiomTrace') } catch { /* ignore */ } },
    status: isOn,
    dump,
    clear: () => { ring.length = 0 },
    count: () => ring.length,
  }
}
