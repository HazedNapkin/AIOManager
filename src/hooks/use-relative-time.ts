import { useEffect, useState } from 'react'

/** Shared 60s ticker so every relative-time label re-renders off one interval, not N. */
const subscribers = new Set<() => void>()
let intervalId: ReturnType<typeof setInterval> | null = null

const ensureTicker = () => {
    if (intervalId !== null) return
    intervalId = setInterval(() => {
        for (const fn of subscribers) fn()
    }, 60_000)
}

const teardownTickerIfIdle = () => {
    if (subscribers.size === 0 && intervalId !== null) {
        clearInterval(intervalId)
        intervalId = null
    }
}

export const formatRelative = (input: number | Date | null | undefined): string | null => {
    if (input === null || input === undefined) return null
    const ts = typeof input === 'number' ? input : input.getTime()
    if (!Number.isFinite(ts)) return null
    const diffMs = Date.now() - ts
    if (diffMs < 0) return 'just now'
    const sec = Math.floor(diffMs / 1000)
    if (sec < 45) return 'just now'
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    const day = Math.floor(hr / 24)
    if (day < 30) return `${day}d ago`
    const mo = Math.floor(day / 30)
    if (mo < 12) return `${mo}mo ago`
    const yr = Math.floor(mo / 12)
    return `${yr}y ago`
}

export function useRelativeTime(): (input: number | Date | null | undefined) => string | null {
    const [, setTick] = useState(0)

    useEffect(() => {
        const onTick = () => setTick(t => (t + 1) % 1_000_000)
        subscribers.add(onTick)
        ensureTicker()
        return () => {
            subscribers.delete(onTick)
            teardownTickerIfIdle()
        }
    }, [])

    return formatRelative
}
