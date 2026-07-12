import { useAtomRefresh, useAtomValue } from '@effect-atom/atom-react'
import { compile, type LibraryWorkout, type Workout } from '@j45/domain'
import { Link } from '@tanstack/react-router'

import { FocusBadge } from '@/components/focus-badge'
import { LibrarySegments } from '@/components/library-segments'
import { QueryBoundary } from '@/components/query-boundary'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDuration, listWorkoutsAtom } from '@/lib/workouts'

/** Total stations across every pod — the flat count a card shows, not the pod count. */
function stationCount(workout: Workout): number {
  return workout.pods.reduce((total, pod) => total + pod.stations.length, 0)
}

type WorkoutCardProps = {
  readonly libraryWorkout: LibraryWorkout
}

/**
 * One opaque content card: heavy tight-tracked name, FocusBadge with the
 * human focus label, and a combined `N works · MM:SS` summary. The whole
 * card is a typed `Link` to `/workouts/$workoutId` with active-press feedback.
 */
function WorkoutCard({ libraryWorkout }: WorkoutCardProps) {
  const { workout } = libraryWorkout
  const { totalDurationMillis } = compile(workout)

  return (
    <li>
      <Link
        to="/workouts/$workoutId"
        params={{ workoutId: libraryWorkout.id }}
        data-testid={`workout-card-${libraryWorkout.id}`}
        className="block transition-transform active:scale-[0.98]"
      >
        <Card size="sm">
          <CardHeader>
            <CardTitle
              data-testid={`workout-name-${libraryWorkout.id}`}
              className="font-bold tracking-tight"
            >
              {workout.name}
            </CardTitle>
            <FocusBadge focus={workout.focus} data-testid={`workout-focus-${libraryWorkout.id}`} />
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <span data-testid={`workout-summary-${libraryWorkout.id}`}>
              {stationCount(workout)} works · {formatDuration(totalDurationMillis)}
            </span>
          </CardContent>
        </Card>
      </Link>
    </li>
  )
}

const newWorkoutLinkClass =
  'rounded-md bg-primary px-2.5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80'

/** Skeleton rows shown while `listWorkoutsAtom` is Initial / in flight. */
function WorkoutListLoading() {
  return (
    <div className="flex w-full flex-col gap-3" data-testid="query-boundary-loading">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

/** The caller's workouts (`ListWorkouts`), one opaque content card per workout. */
function WorkoutList() {
  const workouts = useAtomValue(listWorkoutsAtom)
  const refresh = useAtomRefresh(listWorkoutsAtom)

  return (
    <QueryBoundary
      result={workouts}
      isEmpty={(value) => value.length === 0}
      emptyTitle="No workouts yet"
      emptyDescription="Create your first workout to get started."
      emptyAction={
        <Link
          to="/workouts/new"
          data-testid="new-workout-empty-cta"
          className={newWorkoutLinkClass}
        >
          New workout
        </Link>
      }
      errorTitle="Failed to load your workouts"
      onRetry={refresh}
      loading={<WorkoutListLoading />}
    >
      {(value) => (
        <ul className="flex w-full flex-col gap-3" data-testid="workout-list">
          {value.map((libraryWorkout) => (
            <WorkoutCard key={libraryWorkout.id} libraryWorkout={libraryWorkout} />
          ))}
        </ul>
      )}
    </QueryBoundary>
  )
}

/**
 * The workout library list (`/library`): Workouts | Exercises segment control,
 * the caller's workouts from `ListWorkouts`, and a New workout action. The
 * shell's AppHeader replaces the old h1 + header-nav region.
 */
export function LibraryScreen() {
  return (
    <div className="flex min-h-svh flex-col items-center gap-6 p-6" data-testid="library-screen">
      <LibrarySegments />
      <div className="flex w-full max-w-sm justify-end">
        <Link to="/workouts/new" data-testid="new-workout-button" className={newWorkoutLinkClass}>
          New workout
        </Link>
      </div>
      <div className="w-full max-w-sm">
        <WorkoutList />
      </div>
    </div>
  )
}
