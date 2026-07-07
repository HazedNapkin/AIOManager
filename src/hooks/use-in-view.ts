import { useEffect, useRef, useState } from 'react'

export function useInView<T extends HTMLElement>(threshold = 0.1) {
    const ref = useRef<T>(null)
    const [inView, setInView] = useState(false)

    useEffect(() => {
        const el = ref.current
        if (!el) return

        if (typeof IntersectionObserver === 'undefined') {
            setInView(true)
            return
        }

        let raf1 = 0
        let raf2 = 0
        let obs: IntersectionObserver | null = null
        let interval: ReturnType<typeof setInterval> | null = null

        const trigger = () => {
            if (raf1) cancelAnimationFrame(raf1)
            raf1 = requestAnimationFrame(() => {
                raf2 = requestAnimationFrame(() => setInView(true))
            })
        }

        const check = (): boolean => {
            const rect = el.getBoundingClientRect()
            if (rect.width === 0 || rect.height === 0) return false
            if (rect.top < window.innerHeight + 50 && rect.bottom > -50) {
                trigger()
                return true
            }
            return false
        }

        if (check()) {
            return () => {
                cancelAnimationFrame(raf1)
                cancelAnimationFrame(raf2)
            }
        }

        obs = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting && entry.target.getBoundingClientRect().height > 0) {
                setInView(true)
                obs!.disconnect()
                if (interval) clearInterval(interval)
            }
        }, { threshold, rootMargin: '50px' })
        obs.observe(el)

        interval = setInterval(() => {
            if (!check()) return
            if (interval) clearInterval(interval)
        }, 200)

        return () => {
            cancelAnimationFrame(raf1)
            cancelAnimationFrame(raf2)
            if (obs) obs.disconnect()
            if (interval) clearInterval(interval)
        }
    }, [threshold])

    return { ref, inView }
}
