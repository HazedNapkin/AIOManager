import { useEffect, useRef, useState, useMemo } from 'react'
import { cn } from '@/lib/utils'

interface TypingTextProps {
    text: string
    delay?: number
    repeat?: boolean
    className?: string
    grow?: boolean
    smooth?: boolean
    waitTime?: number
    onComplete?: () => void
    hideCursorOnComplete?: boolean
}

export function TypingText({
    text,
    repeat = false,
    delay = 32,
    className,
    grow = false,
    smooth = false,
    waitTime = 1000,
    onComplete,
    hideCursorOnComplete = false,
}: TypingTextProps) {
    const words = useMemo(() => text.split(/\s+/), [text])
    const total = smooth ? words.length : text.length

    const [index, setIndex] = useState(0)
    const [isComplete, setIsComplete] = useState(false)
    // Blinker state - single interval, lives for the component lifetime
    const [cursorOn, setCursorOn] = useState(true)

    // Use a ref for direction so the interval always reads the latest value
    // without needing to be recreated on every direction change
    const dirRef = useRef<1 | -1>(1)
    const waitingRef = useRef(false)

    // Typing interval - only depends on delay and total, never on direction
    useEffect(() => {
        const id = setInterval(() => {
            if (waitingRef.current) return
            setIndex(prev => {
                const next = prev + dirRef.current
                if (dirRef.current === 1 && next >= total) {
                    // Reached end
                    if (repeat) {
                        waitingRef.current = true
                        setTimeout(() => {
                            dirRef.current = -1
                            waitingRef.current = false
                        }, waitTime)
                    } else {
                        setIsComplete(true)
                        onComplete?.()
                    }
                    return total
                }
                if (dirRef.current === -1 && next <= 0) {
                    // Reached start
                    waitingRef.current = true
                    setTimeout(() => {
                        dirRef.current = 1
                        waitingRef.current = false
                    }, waitTime)
                    return 0
                }
                return next
            })
        }, delay)
        return () => clearInterval(id)
    }, [delay, total, repeat, waitTime, onComplete])

    // Cursor blink - independent 530ms interval, no deps
    useEffect(() => {
        const id = setInterval(() => setCursorOn(v => !v), 530)
        return () => clearInterval(id)
    }, [])

    const showCursor = !smooth && (!hideCursorOnComplete || !isComplete)
    // Cursor is always "on" when waiting at start/end (so it blinks in place)
    const cursorVisible = showCursor && (cursorOn || isComplete === false && (index === 0 || index >= total))

    return (
        <div className={cn('relative font-mono', className)}>
            {/* Reserve space using invisible full text so layout doesn't shift */}
            {!grow && <div className="invisible select-none" aria-hidden>{text}</div>}
            <div className={cn(!grow && 'absolute inset-0 flex items-center')}>
                {smooth
                    ? <span className="flex flex-wrap whitespace-pre">
                        {words.map((word, wi) => (
                            <span key={wi} className={cn('transition-opacity duration-300', wi < index ? 'opacity-100' : 'opacity-0')}>
                                {word}{wi < words.length - 1 && <span>&nbsp;</span>}
                            </span>
                        ))}
                    </span>
                    : <span>
                        {text.slice(0, index)}
                        {showCursor && (
                            <span className={cn('transition-opacity duration-75', cursorVisible ? 'opacity-100' : 'opacity-0')}>|</span>
                        )}
                    </span>
                }
            </div>
        </div>
    )
}
