import { Result, useAtomValue } from '@effect-atom/atom-react'
import { compile, type LibraryWorkout, type Workout } from '@j45/domain'
import { Link } from '@tanstack/react-router'

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
 * The library home (`/`): the caller's workouts from `ListWorkouts`, and a
 * header nav to `/account`. The `/` route `router.tsx` renders.
 */
export function LibraryScreen() {
  return (
    <div className="flex min-h-svh flex-col items-center gap-6 p-6" data-testid="library-screen">
      <header className="flex w-full max-w-sm items-center justify-between">
        <h1 className="text-lg font-medium">Your library</h1>
        <Link
          to="/account"
          data-testid="account-nav-link"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Account
        </Link>
      </header>
      <div className="w-full max-w-sm">
        <WorkoutList />
      </div>
    </div>
  )
}
