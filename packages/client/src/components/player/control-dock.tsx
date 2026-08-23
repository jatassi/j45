import type { JSX, ReactNode } from 'react'
import { useRef } from 'react'

import { useLiquidGlass } from '@/glass/use-liquid-glass'
import { cn } from '@/lib/utils'

export type ControlDockProps = {
  /** The next-up / info line above the controls (e.g. "Next · Sit-up"). */
  info?: ReactNode
  /**
   * The control row — a >=64px center primary flanked by >=48px side buttons.
   * Rendered inside a min-height row so the dock is sized for those targets.
   */
  children?: ReactNode
  /**
   * Ceiling glass tier, forwarded to {@link useLiquidGlass}. Pass `'css'` to
   * keep the dock off the GPU (the phone perf-gate escape hatch) while the
   * timer runs.
   */
  maxTier?: 'css' | 'refract'
}

/**
 * The immersive player's bottom glass chrome: a next-up/info line above a
 * control row. Positioning lives on the outer wrapper and the glass material on
 * the inner element — the client CLAUDE.md "positioned wrapper" gotcha, because
 * `.glass-surface` sets `position: relative` and would defeat positioning
 * utilities on the same element. `maxTier` is forwarded verbatim to the glass
 * hook.
 */
export function ControlDock(props: ControlDockProps): JSX.Element {
  const { info, children, maxTier } = props
  const surfaceRef = useRef<HTMLDivElement>(null)
  useLiquidGlass(surfaceRef, maxTier ? { maxTier } : undefined)

  return (
    <div
      data-testid="player-control-dock"
      className={cn(
        // Bottom padding clears the iOS home indicator / Safari toolbar inset
        // when present (viewport-fit=cover), never dropping below the 2rem rest.
        'pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-[max(2rem,calc(env(safe-area-inset-bottom)+0.75rem))]',
      )}
    >
      <div
        ref={surfaceRef}
        data-testid="player-control-dock-surface"
        className={cn(
          'glass-surface pointer-events-auto flex flex-col gap-3 rounded-[28px] px-5 py-3',
        )}
      >
        <div data-slot="next-up" className="flex min-h-5 items-center justify-between">
          {info}
        </div>
        <div data-slot="controls" className="flex min-h-16 items-center justify-between">
          {children}
        </div>
      </div>
    </div>
  )
}
