import type { ReactNode } from 'react'
import { useRef } from 'react'

import { useRouter, type RouterHistory } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'

import { useLiquidGlass } from '@/glass/use-liquid-glass'

type PushHeaderProps = {
  readonly title: string
  readonly action?: ReactNode
  /**
   * When set, the back chevron calls this instead of the default
   * canGoBack/history-back-else-`/` behavior. Editor screens pass a dirty-
   * confirm gate here; omit for standard push navigation.
   */
  readonly onBack?: () => void
}

/**
 * Sticky header for pushed screens: back affordance, title, optional action.
 * Back uses `history.back()` when the in-app stack allows it, otherwise
 * navigates to `/` — unless `onBack` is provided, in which case that wins.
 *
 * The global `Register` step is deliberately skipped in this app (see
 * `router.tsx`), so `useRouter()` types `history` as `any` — assert the
 * real `RouterHistory` surface before calling it.
 */
function PushHeader({ title, action, onBack }: PushHeaderProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  useLiquidGlass(surfaceRef)
  const router = useRouter()

  const handleBack = () => {
    if (onBack !== undefined) {
      onBack()
      return
    }
    const history = router.history as RouterHistory
    if (history.canGoBack()) {
      history.back()
      return
    }
    void router.navigate({ to: '/' })
  }

  return (
    <div className="sticky top-0 z-20">
      <div
        ref={surfaceRef}
        className="glass-surface rounded-none border-x-0 border-t-0 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2"
      >
        <div className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center gap-1">
          <button
            type="button"
            data-testid="back-button"
            onClick={handleBack}
            className="flex size-11 items-center justify-center rounded-full text-foreground hover:bg-muted/50"
            aria-label="Go back"
          >
            <ChevronLeft className="size-6" strokeWidth={2} aria-hidden />
          </button>
          <h1 className="truncate text-center font-heading text-[17px] font-bold tracking-tight text-foreground">
            {title}
          </h1>
          <div className="flex min-h-11 items-center justify-end">{action}</div>
        </div>
      </div>
    </div>
  )
}

export { PushHeader }
