import { cn } from '@/lib/utils'

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
    return (
        <div className={cn('flex items-center rounded-lg border border-border/40 bg-muted/30 p-0.5', className)}>
            {LEVELS.map((level) => (
                <button
                    key={level.value}
                    type="button"
                    onClick={() => onChange(level.value)}
                    className={cn(
                        'flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors',
                        value === level.value
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                    )}
                >
                    {level.label}
                </button>
            ))}
        </div>
    )
}
