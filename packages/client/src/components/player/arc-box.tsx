import type { CSSProperties, JSX, ReactNode } from 'react'

/**
 * The box a Progress arc is drawn in, with the room its countdown overflows
 * into below. Both player screens use it. They differ only in the two lengths
 * they pass.
 *
 * `w-screen` lets the arc pass the padding each screen sets, and the column
 * width the live session sets, so that the arc reaches the screen edges. Only
 * the arc passes them. What a screen writes below the arc keeps the padding.
 *
 * The arc is a 2:1 letterbox sized by its height, so the width follows the
 * height. There is no viewport-height term in it. One `svh` coefficient cannot
 * serve both orientations: the fixed chrome — top strip, dock padding, safe
 * areas — stays near 270px, which is about 32% of a portrait viewport and
 * about 69% of a landscape one, and no coefficient is above the first and
 * below the second. A box sized by height is correct in both. A landscape
 * column gives the arc less height, and the arc becomes smaller.
 *
 * The box below the arc is the room the countdown overflows into. The
 * countdown's centre is on the arc's chord, so half of its height falls below
 * the arc. That box keeps its full height while the arc becomes smaller,
 * because a countdown that overflowed into less room would print on top of
 * what the screen writes below the arc.
 */
export function ArcBox({
  width,
  countSize,
  children,
}: {
  /** What the arc takes when the column has the height for it, as a CSS length. */
  readonly width: string
  /**
   * The countdown's type scale, as a CSS length. Its glyphs are one em tall.
   *
   * It may read `--arc-width`, which is set on the same element: that is how
   * both screens size the countdown as a share of their own arc.
   */
  readonly countSize: string
  readonly children: ReactNode
}): JSX.Element {
  return (
    <div
      className="flex min-h-0 w-screen flex-col items-center justify-center"
      // Custom properties: React's CSSProperties does not declare them.
      style={{ '--arc-width': width, '--count-size': countSize } as CSSProperties}
    >
      <div className="aspect-[2/1] h-[calc(var(--arc-width)/2)] min-h-0">{children}</div>
      <div className="h-[calc(var(--count-size)/2)] shrink-0" aria-hidden="true" />
    </div>
  )
}
