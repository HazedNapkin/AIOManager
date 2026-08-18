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

        const trigger = () => {
            if (raf1) cancelAnimationFrame(raf1)
            raf1 = requestAnimationFrame(() => {
                raf2 = requestAnimationFrame(() => setInView(true))
            })
        }

        const rect = el.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight + 50 && rect.bottom > -50) {
            trigger()
            return () => {
                cancelAnimationFrame(raf1)
                cancelAnimationFrame(raf2)
            }
        }

        obs = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting && entry.target.getBoundingClientRect().height > 0) {
                setInView(true)
                obs!.disconnect()
            }
        }, { threshold, rootMargin: '50px' })
        obs.observe(el)

        return () => {
            cancelAnimationFrame(raf1)
            cancelAnimationFrame(raf2)
            if (obs) obs.disconnect()
        }
    }, [threshold])

    return { ref, inView }
}
