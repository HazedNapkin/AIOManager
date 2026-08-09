import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import * as React from 'react'

const LEVELS = [
    { value: 0, label: 'Off' },
    { value: 1, label: 'Light' },
    { value: 2, label: 'Strict' },
    { value: 3, label: 'Hidden' },
] as const

interface PrivacyLevelSliderProps {
    value: number
    onChange: (value: number) => void
    className?: string
}

export function PrivacyLevelSlider({ value, onChange, className }: PrivacyLevelSliderProps) {
    const layoutId = React.useId()
    return (
        <div className={cn('flex items-center rounded-lg border border-border/40 bg-muted/30 p-0.5', className)}>
            {LEVELS.map((level) => (
                <button
                    key={level.value}
                    type="button"
                    onClick={() => onChange(level.value)}
                    className={cn(
                        'relative flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors z-10',
                        value === level.value
                            ? 'text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                    )}
                >
                    {value === level.value && (
                        <motion.div
                            layoutId={layoutId}
                            className="absolute inset-0 bg-background rounded-md shadow-sm -z-10"
                            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                        />
                    )}
                    {level.label}
                </button>
            ))}
        </div>
    )
}
