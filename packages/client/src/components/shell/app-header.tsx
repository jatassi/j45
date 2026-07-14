import { useRef } from 'react'

import type { User } from '@j45/domain'
import { Link } from '@tanstack/react-router'

import { Wordmark } from '@/components/wordmark'
import { useLiquidGlass } from '@/glass/use-liquid-glass'
import { displayInitials } from '@/lib/initials'

type AppHeaderProps = {
  readonly user: User
}

/**
 * Sticky glass header for tab roots: J45 wordmark + avatar chip → `/account`.
 */
function AppHeader({ user }: AppHeaderProps) {
  const ref = useRef<HTMLDivElement>(null)
  useLiquidGlass(ref)

  return (
    <div className="sticky top-0 z-20">
      <div
        ref={ref}
        className="glass-surface rounded-none px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-4"
      >
        <div className="flex items-center justify-between">
          <Wordmark />
          <Link
            to="/account"
            data-testid="avatar-chip"
            className="flex size-11 items-center justify-center rounded-full bg-muted ring-1 ring-border"
            aria-label="Account"
          >
            <span className="font-heading text-[13px] font-bold text-white/80">
              {displayInitials(user.displayName)}
            </span>
          </Link>
        </div>
      </div>
    </div>
  )
}

export { AppHeader }
