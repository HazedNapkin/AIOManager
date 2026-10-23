import { useEffect, useRef, useState } from 'react'
import { createLoadPacer } from '@/lib/load-pace'

/**
 * Pace a rapidly-changing store value while a load is in progress.
 *
 * While `pacing` is true the returned value updates at most once per `paceMs`
 * (trailing edge, always carrying the newest input — intermediate values are
 * skipped, none are lost at the end). While `pacing` is false the input is
 * returned unchanged, so incremental publications outside a load keep their
 * immediate reactivity with at most one extra cheap render.
 *
 * The last value of a paced burst is always delivered: either by the trailing
 * timer or immediately when `pacing` turns false (the load ending). `paceMs`
 * must be stable for the lifetime of the component. Changing `scope` flushes
 * the current input immediately and starts a new pacing interval.
 */
export function usePacedValue<T>(value: T, paceMs: number, pacing: boolean, scope?: unknown): T {
    const pacerRef = useRef<ReturnType<typeof createLoadPacer> | null>(null)
    if (pacerRef.current === null) pacerRef.current = createLoadPacer(paceMs)
    const scopeRef = useRef(scope)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [emitted, setEmitted] = useState<{ paced: boolean; value: T; scope: unknown }>(() => ({ paced: pacing, value, scope }))

    useEffect(() => {
        if (!pacing) {
            pacerRef.current!.reset()
            // Keep the snapshot coherent for the next paced epoch (and, on the
            // first render after a load ends, switch consumers back immediately).
            setEmitted(prev => (prev.paced || prev.value !== value || !Object.is(prev.scope, scope)) ? { paced: false, value, scope } : prev)
            return
        }
        const pacer = pacerRef.current!
        if (!Object.is(scopeRef.current, scope)) {
            pacer.reset()
            scopeRef.current = scope
        }
        const emit = () => {
            pacer.markEmit()
            setEmitted({ paced: true, value, scope })
        }
        if (pacer.canEmit()) {
            emit()
            return
        }
        const timer = setTimeout(() => {
            timerRef.current = null
            emit()
        }, Math.max(0, pacer.nextDelayMs()))
        timerRef.current = timer
        return () => {
            if (timerRef.current === timer) {
                clearTimeout(timer)
                timerRef.current = null
            }
        }
    }, [value, pacing, paceMs, scope])

    useEffect(() => () => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current)
            timerRef.current = null
        }
    }, [])

    return pacing && emitted.paced && Object.is(emitted.scope, scope) ? emitted.value : value
}
