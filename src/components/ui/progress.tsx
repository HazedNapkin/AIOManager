import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"

interface ProgressProps extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  shimmer?: boolean
}

const Progress = React.forwardRef<
    React.ElementRef<typeof ProgressPrimitive.Root>,
    ProgressProps
>(({ className, value, shimmer = false, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
        "relative h-4 w-full overflow-hidden rounded-full bg-secondary",
        className
    )}
    {...props}
  >
    <motion.div
      className="h-full bg-primary rounded-full relative"
      initial={{ width: '0%' }}
      animate={{ width: `${value || 0}%` }}
      transition={{ type: 'spring', stiffness: 100, damping: 20 }}
    >
      <div className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-r from-transparent to-white/20 rounded-full" />

      {shimmer && (value || 0) > 0 && (
        <div
          className="absolute inset-0 overflow-hidden rounded-full"
          style={{ maskImage: 'linear-gradient(to right, transparent, black, transparent)' }}
        >
          <div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent"
            style={{ animation: 'shimmer 2s infinite linear' }}
          />
        </div>
      )}
    </motion.div>
  </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
