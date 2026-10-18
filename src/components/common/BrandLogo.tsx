import { useState } from 'react'
import { cn } from '@/lib/utils'

interface BrandLogoProps {
  logoUrl?: string
  className?: string
  label?: string
}

// The default mark follows its surface's text color, including dark title bars
// within light themes. Custom artwork keeps its original colors.
export function BrandLogo({ logoUrl, className, label = 'AIOManager' }: BrandLogoProps) {
  const [failedUrl, setFailedUrl] = useState<string>()

  if (logoUrl && failedUrl !== logoUrl) {
    return (
      <img
        data-theme-part="brand-logo"
        src={logoUrl}
        alt={label}
        decoding="async"
        onError={() => setFailedUrl(logoUrl)}
        className={cn('inline-block shrink-0 object-contain', className)}
      />
    )
  }

  return (
    <span
      data-theme-part="brand-logo"
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={cn('inline-block shrink-0 align-middle', className)}
      style={{
        backgroundColor: 'currentColor',
        mask: 'url("/logo.png") center / contain no-repeat',
        WebkitMask: 'url("/logo.png") center / contain no-repeat',
      }}
    />
  )
}
