import { cn } from '@/lib/utils'

interface HighlightTextProps {
  text: string
  highlight: string
  className?: string
  highlightClassName?: string
}

export function HighlightText({
  text,
  highlight,
  className,
  highlightClassName,
}: HighlightTextProps) {
  if (!highlight.trim()) {
    return <span className={className}>{text}</span>
  }

  const escaped = highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(regex)

  return (
    <span className={className}>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className={cn(
              'bg-primary/20 text-primary rounded-[2px] px-0.5 not-italic',
              highlightClassName
            )}
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  )
}
