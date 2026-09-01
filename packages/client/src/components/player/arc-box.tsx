import type { JSX, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The box a {@link ProgressArc} is drawn in, and the room its countdown
 * overflows into. Both player screens use it, and they differ only in the
 * `--arc-width` they set.
 *
 * ## Width
 *
 * `--arc-width` is what the arc takes when the column has the height to give
 * it. Both screens set it to 92% of the screen against a pixel ceiling, and
 * the ceiling is the one number they disagree on: the manual timer's is lower,
 * which keeps the live session the more prominent of the two.
 *
 * `w-screen` is the escape. Each screen pads itself, and the live session also
 * holds its content to a column width; the arc must pass both to bleed toward
 * the screen edges. Only the arc escapes — what a screen writes below the arc
 * keeps the padding.
 *
 * ## Height
 *
 * The arc is a 2:1 letterbox sized by its height, so its width follows its
 * height and not the other way round. There is no viewport-height term. One
 * `svh` coefficient cannot serve both orientations: the fixed chrome — top
 * strip, dock padding, safe areas — stays near 270px, which is about 32% of a
 * portrait viewport and about 69% of a landscape one, and no coefficient sits
 * above the first and below the second. A box sized by height is correct in
 * both, so a landscape column simply gives the arc less and it shrinks.
 *
 * ## The room below
 *
 * The countdown straddles the arc's chord, so about half of it falls below the
 * box. A third of the arc's height covers that at every size either screen's
 * countdown clamps can produce today. It is a box in the column and not
 * padding, because padding does not shrink: a reserve that held its full size
 * while the arc gave way would take the whole of a landscape column and leave
 * the arc nothing.
 */
export function ArcBox({
  className,
  children,
}: {
  /** Sets `--arc-width` — e.g. `[--arc-width:min(92vw,420px)]`. */
  readonly className: string
  readonly children: ReactNode
}): JSX.Element {
  return (
    <div
      className={cn('flex min-h-0 w-screen flex-col items-center justify-center', className)}
      data-testid="player-arc-box"
    >
      <div className="aspect-[2/1] h-[calc(var(--arc-width)/2)] min-h-0">{children}</div>
      <div className="h-[calc(var(--arc-width)/6)] min-h-0" aria-hidden="true" />
    </div>
  )
}
