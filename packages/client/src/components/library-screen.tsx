import { Result, useAtomValue } from '@effect-atom/atom-react'
import { compile, type LibraryWorkout, type Workout } from '@j45/domain'
import { Link } from '@tanstack/react-router'

import { LibrarySegments } from '@/components/library-segments'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDuration, listWorkoutsAtom } from '@/lib/workouts'

/** Total stations across every pod — the flat count a card shows, not the pod count. */
function stationCount(workout: Workout): number {
  return workout.pods.reduce((total, pod) => total + pod.stations.length, 0)
}

type WorkoutCardProps = {
  readonly libraryWorkout: LibraryWorkout
}

/**
 * One card: name, focus, station count, and total duration (compiled
 * client-side). The whole card is a typed `Link` to that workout's
 * `/workouts/$workoutId` detail route — `workout-card-${id}` (the id
 * `library-screen.test.tsx` already awaits) now identifies the `Link`
 * itself rather than the `Card` it wraps, so clicking anywhere on the card
 * navigates.
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
        className="block"
      >
        <Card size="sm">
          <CardHeader>
            <CardTitle data-testid={`workout-name-${libraryWorkout.id}`}>{workout.name}</CardTitle>
            <CardDescription data-testid={`workout-focus-${libraryWorkout.id}`}>
              {workout.focus}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between text-sm text-muted-foreground">
            <span data-testid={`workout-stations-${libraryWorkout.id}`}>
              {stationCount(workout)} stations
            </span>
            <span data-testid={`workout-duration-${libraryWorkout.id}`}>
              {formatDuration(totalDurationMillis)}
            </span>
          </CardContent>
        </Card>
      </Link>
    </li>
  )
}

/** The caller's workouts (`ListWorkouts`), one shadcn card per workout. */
function WorkoutList() {
  const workouts = useAtomValue(listWorkoutsAtom)

  return Result.match(workouts, {
    onInitial: () => <p className="text-sm text-muted-foreground">Loading your workouts…</p>,
    onFailure: (failure) => (
      <p className="text-sm text-destructive">
        Failed to load your workouts: {String(failure.cause)}
      </p>
    ),
    onSuccess: ({ value }) =>
      value.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="library-empty">
          No workouts yet.
        </p>
      ) : (
        <ul className="flex w-full flex-col gap-3" data-testid="workout-list">
          {value.map((libraryWorkout) => (
            <WorkoutCard key={libraryWorkout.id} libraryWorkout={libraryWorkout} />
          ))}
        </ul>
      ),
  })
}

/**
 * The workout library list (`/library` once the route tree restructure lands):
 * Workouts | Exercises segment control, the caller's workouts from
 * `ListWorkouts`, and a New workout action. The shell's AppHeader replaces
 * the old h1 + header-nav region.
 */
export function LibraryScreen() {
  return (
    <div className="flex min-h-svh flex-col items-center gap-6 p-6" data-testid="library-screen">
      <LibrarySegments />
      <div className="flex w-full max-w-sm justify-end">
        <Link
          to="/workouts/new"
          data-testid="new-workout-button"
          className="rounded-md bg-primary px-2.5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
        >
          New workout
        </Link>
      </div>
      <div className="w-full max-w-sm">
        <WorkoutList />
      </div>
    </div>
  )
}
