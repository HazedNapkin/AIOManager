// Journey spans: measure time from user interaction to content rendered, per core
// journey. Uses the Performance API so deltas show in devtools alongside server
// timings. Tags distinguish client-only waits from server-bound ones.

type JourneyName = 'login' | 'open-account' | 'sync-cycle' | 'open-library'

const active = new Map<string, number>()

export function journeyStart(name: JourneyName) {
    active.set(name, performance.now())
}

export function journeyEnd(name: JourneyName, detail?: string) {
    const start = active.get(name)
    if (start === undefined) return
    active.delete(name)
    const ms = Math.round(performance.now() - start)
    const tag = `${name}${detail ? `:${detail}` : ''}`
    performance.measure(`journey:${tag}`, { start })
    console.info(`[journey] ${tag}: ${ms}ms`)
}
