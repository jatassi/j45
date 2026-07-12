import type * as React from 'react'

import { Wordmark } from '@/components/wordmark'
import { BACKDROP_BASE, BACKDROP_STOPS } from '@/glass/backdrop'
import { cn } from '@/lib/utils'

type AuthLayoutProps = {
  readonly children: React.ReactNode
  readonly className?: string
}

/**
 * Shared chrome for the three anonymous auth surfaces (login, register,
 * enroll-passkey). AuthGate renders them outside the router, so they carry
 * their own centered column: the J45 wordmark as the identity anchor, vertical
 * rhythm, and a subtle ambient backdrop matching the app ground — no phase
 * tints, no tab bar.
 */
export function AuthLayout({ children, className }: AuthLayoutProps) {
  const stops = BACKDROP_STOPS.map(({ offset, color }) => `${color} ${offset * 100}%`).join(', ')

  return (
    <div
      className={cn('relative flex min-h-svh flex-col items-center justify-center p-6', className)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundColor: BACKDROP_BASE,
          backgroundImage: `radial-gradient(circle 125vmax at 50% 0px, ${stops})`,
        }}
      />
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <Wordmark />
        {children}
      </div>
    </div>
  )
}
