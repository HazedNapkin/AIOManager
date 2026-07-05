import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export function useScrollRestoration(key: string) {
  const location = useLocation()

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(`scroll:${key}`)
      if (saved) {
        const top = parseInt(saved, 10)
        requestAnimationFrame(() => window.scrollTo(0, top))
      }
    } catch {
    }

    return () => {
      try {
        sessionStorage.setItem(`scroll:${key}`, String(window.scrollY))
      } catch {
      }
    }
  }, [key, location.key])
}