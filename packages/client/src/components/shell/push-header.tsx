import type { ReactNode } from 'react'

import { useRouter, type RouterHistory } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'

type PushHeaderProps = {
  readonly title: string
  readonly action?: ReactNode
}

/**
 * Sticky header for pushed screens: back affordance, title, optional action.
 * Back uses `history.back()` when the in-app stack allows it, otherwise
 * navigates to `/`.
 *
 * The global `Register` step is deliberately skipped in this app (see
 * `router.tsx`), so `useRouter()` types `history` as `any` — assert the
 * real `RouterHistory` surface before calling it.
 */
function PushHeader({ title, action }: PushHeaderProps) {
  const router = useRouter()

  const onBack = () => {
    const history = router.history as RouterHistory
    if (history.canGoBack()) {
      history.back()
      return
    }
    void router.navigate({ to: '/' })
  }

  return (
    <div className="sticky top-0 z-20 border-b border-border/40 bg-background/80 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 backdrop-blur-md">
      <div className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center gap-1">
        <button
          type="button"
          data-testid="back-button"
          onClick={onBack}
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
  )
}

export { PushHeader }
