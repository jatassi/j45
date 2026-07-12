import { useAtomRefresh, useAtomValue } from '@effect-atom/atom-react'
import type { SessionCompletion, User, Workout } from '@j45/domain'
import { Link } from '@tanstack/react-router'
import * as DateTime from 'effect/DateTime'

import { QueryBoundary } from '@/components/query-boundary'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * The caller's session completion history (`ListHistory`), hoisted to module
 * scope for a stable atom identity — same pattern as `listWorkoutsAtom` and
 * `listActiveSessionsAtom`. Not exported: this file only exports components
 * (`react/only-export-components`).
 */
const listHistoryAtom = ServerRpcClient.query('ListHistory', undefined)

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

/**
 * Relative date within the last week ("3 days ago"); absolute locale date
 * after a week. Same-day ends show "today".
 */
function formatEndedAt(endedAt: DateTime.Utc, now: DateTime.Utc = DateTime.unsafeNow()): string {
  const elapsedMs = DateTime.toEpochMillis(now) - DateTime.toEpochMillis(endedAt)
  if (elapsedMs >= 0 && elapsedMs < WEEK_MS) {
    const days = Math.floor(elapsedMs / DAY_MS)
    if (days === 0) return 'today'
    if (days === 1) return '1 day ago'
    return `${days} days ago`
  }
  return DateTime.toDate(endedAt).toLocaleDateString()
}

const startWorkoutLinkClass =
  'rounded-md bg-primary px-2.5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80'

/** Compact completion indicator: Finished when full, Progress bar + N/M when partial. */
function HistoryProgress({
  completionId,
  progress,
}: {
  readonly completionId: SessionCompletion['id']
  readonly progress: NonNullable<SessionCompletion['progress']>
}) {
  const { segmentsCompleted, totalSegments } = progress
  // `segmentsCompleted` is a 0-based furthest-entered index; a done workout
  // records `totalSegments - 1`. Also accept a full count if a writer ever
  // stores `segmentsCompleted === totalSegments`.
  const finished = totalSegments > 0 && segmentsCompleted >= totalSegments - 1

  if (finished) {
    return (
      <span
        className="text-sm font-medium text-muted-foreground"
        data-testid={`history-progress-${completionId}`}
        data-segments-completed={segmentsCompleted}
        data-total-segments={totalSegments}
      >
        Finished
      </span>
    )
  }

  const value = totalSegments === 0 ? 0 : (segmentsCompleted / totalSegments) * 100

  return (
    <div
      className="flex min-w-0 items-center gap-2"
      data-testid={`history-progress-${completionId}`}
      data-segments-completed={segmentsCompleted}
      data-total-segments={totalSegments}
    >
      <Progress value={value} className="w-16 shrink-0 gap-0" />
      <span className="text-sm text-muted-foreground tabular-nums">
        {segmentsCompleted}/{totalSegments}
      </span>
    </div>
  )
}

/** Read-only as-run pod/station summary from the completion's workout snapshot. */
function SnapshotSummary({
  workout,
  completionId,
}: {
  readonly workout: Workout
  readonly completionId: SessionCompletion['id']
}) {
  return (
    <div className="flex flex-col gap-3 text-sm" data-testid={`history-snapshot-${completionId}`}>
      {workout.pods.map((pod) => (
        <div key={pod.name} className="flex flex-col gap-1">
          <span className="font-medium" data-testid={`history-pod-${completionId}`}>
            {pod.name}
          </span>
          <ul className="flex flex-col gap-0.5 text-muted-foreground">
            {pod.stations.map((station) => (
              <li key={station.name} data-testid={`history-station-${completionId}`}>
                {station.name}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

type HistoryCardProps = {
  readonly completion: SessionCompletion
  readonly callerId: User['id']
}

/** Name, date, host/participant pills, and optional progress for a history card. */
function HistoryCardHeader({ completion, callerId }: HistoryCardProps) {
  const hostLabel = completion.host.userId === callerId ? 'you' : completion.host.displayName

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 text-left">
      <CardHeader className="gap-1 p-0">
        <CardTitle
          data-testid={`history-name-${completion.id}`}
          className="font-bold tracking-tight"
        >
          {completion.workoutName}
        </CardTitle>
        <span
          className="text-sm text-muted-foreground"
          data-testid={`history-date-${completion.id}`}
        >
          {formatEndedAt(completion.endedAt)}
        </span>
      </CardHeader>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" data-testid={`history-host-${completion.id}`}>
          Host: {hostLabel}
        </Badge>
        <div
          className="flex flex-wrap gap-1.5"
          data-testid={`history-participants-${completion.id}`}
        >
          {completion.participants.map((participant) => (
            <Badge key={participant.userId} variant="outline">
              {participant.displayName}
            </Badge>
          ))}
        </div>
        {completion.progress === undefined ? null : (
          <HistoryProgress completionId={completion.id} progress={completion.progress} />
        )}
      </div>
    </div>
  )
}

/**
 * One opaque history card: heavy name, relative/absolute date, host +
 * participant pills, optional progress, accordion-expanded snapshot summary.
 */
function HistoryCard({ completion, callerId }: HistoryCardProps) {
  return (
    <li data-testid={`history-row-${completion.id}`}>
      <Card size="sm">
        <Accordion>
          <AccordionItem value={completion.id} className="border-none">
            <AccordionTrigger
              className="items-stretch px-(--card-spacing) py-0 hover:no-underline"
              data-testid={`history-expand-${completion.id}`}
            >
              <HistoryCardHeader completion={completion} callerId={callerId} />
            </AccordionTrigger>
            <AccordionContent className="px-(--card-spacing)">
              <CardContent className="px-0 pt-1">
                <SnapshotSummary workout={completion.workout} completionId={completion.id} />
              </CardContent>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>
    </li>
  )
}

type HistoryListProps = {
  readonly completions: readonly SessionCompletion[]
  readonly callerId: User['id']
}

/** Non-empty history list — one card per completion, in server order (newest-first). */
function HistoryList({ completions, callerId }: HistoryListProps) {
  return (
    <ul className="flex w-full flex-col gap-3" data-testid="history-list">
      {completions.map((completion) => (
        <HistoryCard key={completion.id} completion={completion} callerId={callerId} />
      ))}
    </ul>
  )
}

/** Skeleton rows shown while `listHistoryAtom` is Initial / in flight. */
function HistoryListLoading() {
  return (
    <div className="flex w-full flex-col gap-3" data-testid="query-boundary-loading">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

type HistoryScreenProps = {
  readonly user: User
}

/**
 * Session history (`/history`): the caller's `ListHistory` completions as
 * opaque expandable cards, newest-first as the server returns them. Needs the
 * authenticated `User` from `RouterContext` so host display can render "you"
 * when the caller hosted.
 */
export function HistoryScreen({ user }: HistoryScreenProps) {
  const history = useAtomValue(listHistoryAtom)
  const refresh = useAtomRefresh(listHistoryAtom)

  return (
    <div className="flex min-h-svh flex-col items-center gap-6 p-6" data-testid="history-screen">
      <div className="w-full max-w-sm">
        <QueryBoundary
          result={history}
          isEmpty={(value) => value.length === 0}
          emptyTitle="No completed sessions yet"
          emptyDescription="Finish a workout to see it here."
          emptyAction={
            <Link
              to="/library"
              data-testid="start-workout-empty-cta"
              className={startWorkoutLinkClass}
            >
              Start a workout
            </Link>
          }
          errorTitle="Failed to load your history"
          onRetry={refresh}
          loading={<HistoryListLoading />}
        >
          {(value) => <HistoryList completions={value} callerId={user.id} />}
        </QueryBoundary>
      </div>
    </div>
  )
}
