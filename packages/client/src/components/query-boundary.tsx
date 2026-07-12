import type { ReactNode } from 'react'

import { Result } from '@effect-atom/atom-react'
import type { Result as AtomResult } from '@effect-atom/atom/Result'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'

export type QueryBoundaryProps<A, E = unknown> = {
  /** The atom/`useAtomValue` result to branch on. */
  readonly result: AtomResult<A, E>
  /** Render-prop for a non-empty success value. */
  readonly children: (value: A) => ReactNode
  /**
   * Optional emptiness check on the success value. When it returns true the
   * Empty surface is shown instead of `children`.
   */
  readonly isEmpty?: (value: A) => boolean
  readonly emptyTitle?: ReactNode
  readonly emptyDescription?: ReactNode
  /** CTA slot rendered inside EmptyContent (e.g. a create Button). */
  readonly emptyAction?: ReactNode
  readonly errorTitle?: ReactNode
  /** When provided, a Retry button is rendered on the failure Alert. */
  readonly onRetry?: () => void
  /** Override the default full-width Skeleton used for the loading branch. */
  readonly loading?: ReactNode
}

function FailureAlert({
  title,
  cause,
  onRetry,
}: {
  title: ReactNode
  cause: unknown
  onRetry?: () => void
}): ReactNode {
  return (
    <Alert variant="destructive" data-testid="query-boundary-error">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{String(cause)}</AlertDescription>
      {onRetry === undefined ? null : (
        <AlertAction>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </AlertAction>
      )}
    </Alert>
  )
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: ReactNode
  description: ReactNode | undefined
  action: ReactNode | undefined
}): ReactNode {
  return (
    <Empty data-testid="query-boundary-empty">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description === undefined ? null : <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action === undefined ? null : <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}

/**
 * Thin wrapper over `@effect-atom`'s `Result.match` that standardizes the
 * four branches used across list/detail screens:
 *
 * - loading (`Initial`) → Skeleton
 * - empty (success + `isEmpty`) → Empty with optional CTA
 * - failure → Alert with optional Retry
 * - success (non-empty) → caller's render-prop
 */
export function QueryBoundary<A, E = unknown>({
  result,
  children,
  isEmpty,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
  errorTitle = 'Something went wrong',
  onRetry,
  loading,
}: QueryBoundaryProps<A, E>): ReactNode {
  return Result.match(result, {
    onInitial: () =>
      loading ?? <Skeleton className="h-24 w-full" data-testid="query-boundary-loading" />,
    onFailure: (failure) => (
      <FailureAlert title={errorTitle} cause={failure.cause} onRetry={onRetry} />
    ),
    onSuccess: ({ value }) =>
      isEmpty?.(value) === true ? (
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      ) : (
        children(value)
      ),
  })
}
