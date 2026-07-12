import { cn } from '@/lib/utils'

type WordmarkProps = {
  /** Lockup treatment seam — only the upright orange-45 default ships today. */
  variant?: 'default'
  className?: string
}

/**
 * In-app J45 wordmark: upright Geist black, tight tracking, white `J` +
 * primary-orange `45` (prototype treatment 2).
 */
function Wordmark({ variant = 'default', className }: WordmarkProps) {
  return (
    <span
      data-variant={variant}
      className={cn(
        'font-heading text-[24px] leading-none font-black tracking-tighter text-white',
        className,
      )}
    >
      J<span className="text-primary">45</span>
    </span>
  )
}

export { Wordmark }
