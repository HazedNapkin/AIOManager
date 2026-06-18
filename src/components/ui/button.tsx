import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[color,background-color,border-color,transform] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        subtle:
          "bg-muted/40 text-muted-foreground border border-border/40 hover:bg-muted/70 hover:text-foreground shadow-none",
        success:
          "bg-success text-success-foreground shadow-sm hover:bg-success/90",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-10 rounded-lg px-8",
        xl: "h-11 rounded-lg px-8 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  ripple?: boolean
}

const Button = React.forwardRef<
  HTMLButtonElement,
  ButtonProps & { asChild?: boolean }
>(({ className, variant, size, asChild = false, ripple, onClick, type, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  // Default to type="button" so a Button placed inside a <form> doesn't accidentally submit it.
  // Real submit buttons pass an explicit type="submit", which overrides this.
  const resolvedType = asChild ? type : (type ?? 'button')
  const buttonRef = React.useRef<HTMLButtonElement>(null)

  const shouldRipple = ripple ?? (variant === 'default' || variant === undefined)

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (shouldRipple && buttonRef.current) {
      const btn = buttonRef.current
      const previousPosition = btn.style.position
      const previousOverflow = btn.style.overflow
      const shouldRestorePosition = !previousPosition
      const shouldRestoreOverflow = !previousOverflow
      if (shouldRestorePosition) btn.style.position = 'relative'
      if (shouldRestoreOverflow) btn.style.overflow = 'hidden'

      const rect = btn.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const size = Math.max(rect.width, rect.height)

      const rippleEl = document.createElement('span')
      rippleEl.dataset.ripple = 'true'
      rippleEl.style.cssText = `
        position: absolute;
        border-radius: 50%;
        width: ${size}px;
        height: ${size}px;
        left: ${x - size / 2}px;
        top: ${y - size / 2}px;
        background: currentColor;
        opacity: 0.2;
        transform: scale(0);
        animation: ripple-expand 0.6s ease-out forwards;
        pointer-events: none;
      `
      btn.appendChild(rippleEl)
      setTimeout(() => {
        rippleEl.remove()
        if (!btn.querySelector('[data-ripple="true"]')) {
          if (shouldRestorePosition) btn.style.position = previousPosition
          if (shouldRestoreOverflow) btn.style.overflow = previousOverflow
        }
      }, 600)
    }
    onClick?.(e)
  }

  const mergedRef = React.useCallback((node: HTMLButtonElement | null) => {
    (buttonRef as React.MutableRefObject<HTMLButtonElement | null>).current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = node
  }, [ref])

  return (
    <Comp
      type={resolvedType}
      className={cn(
        buttonVariants({ variant, size, className }),
        shouldRipple && 'relative overflow-hidden'
      )}
      ref={mergedRef}
      onClick={handleClick}
      {...props}
    />
  )
})
Button.displayName = "Button"

export { Button, buttonVariants }
