import { cn } from '@/lib/utils'
import * as React from 'react'

interface DropdownMenuProps {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

interface DropdownMenuContextValue {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
}

const DropdownMenuContext = React.createContext<DropdownMenuContextValue | undefined>(undefined)

const DropdownMenu = ({ children, open: controlledOpen, onOpenChange }: DropdownMenuProps) => {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen

  const setOpen = React.useCallback((value: React.SetStateAction<boolean>) => {
    const newValue = typeof value === 'function' ? value(open) : value
    if (!isControlled) {
      setUncontrolledOpen(newValue)
    }
    onOpenChange?.(newValue)
  }, [isControlled, open, onOpenChange])

  React.useEffect(() => {
    if (!isControlled) {
      onOpenChange?.(open)
    }
  }, [open, isControlled, onOpenChange])

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-block">{children}</div>
    </DropdownMenuContext.Provider>
  )
}

interface DropdownMenuTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
}

const DropdownMenuTrigger = React.forwardRef<HTMLButtonElement, DropdownMenuTriggerProps>(
  ({ className, children, asChild, ...props }, ref) => {
    const context = React.useContext(DropdownMenuContext)
    if (!context) throw new Error('DropdownMenuTrigger must be used within DropdownMenu')

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      context.setOpen(!context.open)
      if (props.onClick) {
        props.onClick(e)
      }
    }

    if (asChild && React.isValidElement(children)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const child = children as React.ReactElement<any>
      return React.cloneElement(child, {
        ref,
        onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
          handleClick(e)
          if (child.props.onClick) {
            child.props.onClick(e)
          }
        },
        ...props,
      })
    }

    return (
      <button
        ref={ref}
        type="button"
        className={cn('inline-flex items-center justify-center', className)}
        onClick={handleClick}
        {...props}
      >
        {children}
      </button>
    )
  }
)
DropdownMenuTrigger.displayName = 'DropdownMenuTrigger'

interface DropdownMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  collisionPadding?: number
}

const DropdownMenuContent = React.forwardRef<HTMLDivElement, DropdownMenuContentProps>(
  ({ className, align = 'end', sideOffset, collisionPadding: _collisionPadding, children, ...props }, _ref) => {
    const context = React.useContext(DropdownMenuContext)
    if (!context) throw new Error('DropdownMenuContent must be used within DropdownMenu')

    const menuRef = React.useRef<HTMLDivElement>(null)
    const [visible, setVisible] = React.useState(false)
    const [mounted, setMounted] = React.useState(false)

    React.useEffect(() => {
      if (context.open) {
        setMounted(true)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setVisible(true))
        })
      } else {
        setVisible(false)
        const timer = setTimeout(() => setMounted(false), 150)
        return () => clearTimeout(timer)
      }
    }, [context.open])

    React.useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
          const parent = menuRef.current.parentElement
          if (parent && !parent.contains(event.target as Node)) {
            context.setOpen(false)
          } else {
            setTimeout(() => context.setOpen(false), 0)
          }
        }
      }

      if (context.open) {
        document.addEventListener('mousedown', handleClickOutside)
      }
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [context.open, context])

    if (!mounted) return null

    return (
      <div
        ref={menuRef}
        style={{
          marginTop: sideOffset ? `${sideOffset}px` : undefined,
          willChange: 'transform, opacity',
        }}
        className={cn(
          'absolute z-50 min-w-[8rem] overflow-hidden rounded-md border border-border/40 bg-card p-1 text-card-foreground shadow-lg',
          'transition-[transform,opacity,box-shadow] duration-150 ease-out origin-top',
          visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-1',
          align === 'end' && 'right-0',
          align === 'start' && 'left-0',
          align === 'center' && 'left-1/2 -translate-x-1/2',
          'top-full mt-1',
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }
)
DropdownMenuContent.displayName = 'DropdownMenuContent'

interface DropdownMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  destructive?: boolean
}

const DropdownMenuItem = React.forwardRef<HTMLButtonElement, DropdownMenuItemProps>(
  ({ className, destructive, children, onClick, ...props }, ref) => {
    const context = React.useContext(DropdownMenuContext)

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      context?.setOpen(false)
      onClick?.(e)
    }

    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          'relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors',
          'hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground',
          destructive &&
          'text-destructive hover:text-destructive hover:bg-destructive/10',
          className
        )}
        onClick={handleClick}
        {...props}
      >
        {children}
      </button>
    )
  }
)
DropdownMenuItem.displayName = 'DropdownMenuItem'

const DropdownMenuSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (<div ref={ref} className={cn('-mx-1 my-1 h-px bg-muted', className)} {...props} />)
)
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator'

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
}
