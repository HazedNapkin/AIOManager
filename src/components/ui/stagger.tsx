import { useEffect, useRef, useState, createContext, useContext } from 'react'
import { cn } from '@/lib/utils'

interface StaggerContainerProps {
  children: React.ReactNode
  className?: string
  staggerDelay?: number
}

const StaggerContext = createContext<{ delay: number, nextIndex: () => number }>({
  delay: 0.02,
  nextIndex: () => 0,
})

function StaggerContainer({
  children,
  className,
  staggerDelay = 0.02,
}: StaggerContainerProps) {
  const counterRef = useRef(0)
  counterRef.current = 0
  const nextIndex = () => counterRef.current++

  return (
    <StaggerContext.Provider value={{ delay: staggerDelay, nextIndex }}>
      <div className={cn(className)}>
        {children}
      </div>
    </StaggerContext.Provider>
  )
}

function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const { delay, nextIndex } = useContext(StaggerContext)
  const indexRef = useRef<number | null>(null)
  if (indexRef.current === null) {
    indexRef.current = nextIndex()
  }
  const index = indexRef.current
  const animDelay = index * delay

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }

    const rect = el.getBoundingClientRect()
    const inViewport = rect.top < window.innerHeight + 100 && rect.bottom > -100

    if (inViewport) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      })
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.unobserve(el)
        }
      },
      { rootMargin: '100px', threshold: 0 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={cn('h-full', className)}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'none' : 'translateY(12px) scale(0.97)',
        transition: visible
          ? `opacity 0.3s ease ${animDelay}s, transform 0.3s ease ${animDelay}s`
          : 'none',
      }}
    >
      {children}
    </div>
  )
}

export { StaggerContainer, StaggerItem }
