import * as React from 'react'

import { Result, useAtomRefresh, useAtomValue } from '@effect-atom/atom-react'
import { compile, type LibraryWorkout, type SessionSummary, type Workout } from '@j45/domain'
import { Link } from '@tanstack/react-router'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ServerRpcClient } from '@/lib/rpc-client'
import { formatDuration, listWorkoutsAtom } from '@/lib/workouts'

/**
 * Active live sessions (`ListActiveSessions`), hoisted to module scope for a
 * stable atom identity — same pattern as `listWorkoutsAtom` in `lib/workouts.ts`.
 * Not exported: this file only exports components (`react/only-export-components`).
 */
const listActiveSessionsAtom = ServerRpcClient.query('ListActiveSessions', undefined)

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

type SessionCardProps = {
  readonly session: SessionSummary
}

/** One active-session card: host, workout name, participant count; whole card joins the session. */
function SessionCard({ session }: SessionCardProps) {
  return (
    <li>
      <Link
        to={`/session/${session.id}`}
        data-testid={`session-card-${session.id}`}
        className="block"
      >
        <Card size="sm">
          <CardHeader>
            <CardTitle>{session.hostDisplayName}</CardTitle>
            <CardDescription>{session.workoutName}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {session.participantCount} participants
          </CardContent>
        </Card>
      </Link>
    </li>
  )
}

type ActiveSessionsListProps = {
  readonly sessions: readonly SessionSummary[]
}

/** Non-empty active-sessions UI — heading + cards. Absent entirely when the list is empty. */
function ActiveSessionsList({ sessions }: ActiveSessionsListProps) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-3" data-testid="active-sessions-strip">
      <h2 className="text-base font-medium">Active sessions</h2>
      <ul className="flex w-full flex-col gap-3">
        {sessions.map((session) => (
          <SessionCard key={session.id} session={session} />
        ))}
      </ul>
    </div>
  )
}

/**
 * Polls `ListActiveSessions` every 5s while mounted. Renders nothing until
 * success with a non-empty list — no heading, no container when empty.
 */
function ActiveSessionsStrip() {
  const sessions = useAtomValue(listActiveSessionsAtom)
  const refresh = useAtomRefresh(listActiveSessionsAtom)

  React.useEffect(() => {
    const handle = globalThis.setInterval(() => {
      refresh()
    }, 5000)
    return () => {
      globalThis.clearInterval(handle)
    }
  }, [refresh])

  return Result.match(sessions, {
    onInitial: () => null,
    onFailure: () => null,
    onSuccess: ({ value }) => (value.length === 0 ? null : <ActiveSessionsList sessions={value} />),
  })
}

/**
 * The library home (`/`): active live sessions (when any), the caller's
 * workouts from `ListWorkouts`, and a header nav to `/account`. The `/`
 * route `router.tsx` renders.
 */
export function LibraryScreen() {
  return (
    <div className="flex min-h-svh flex-col items-center gap-6 p-6" data-testid="library-screen">
      <header className="flex w-full max-w-sm items-center justify-between">
        <h1 className="text-lg font-medium">Your library</h1>
        <nav className="flex items-center gap-4">
          <Link
            to="/timer"
            data-testid="timer-nav-link"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Timer
          </Link>
          <Link
            to="/exercises"
            data-testid="exercises-nav-link"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Exercises
          </Link>
          <Link
            to="/account"
            data-testid="account-nav-link"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Account
          </Link>
        </nav>
      </header>
      <div className="flex w-full max-w-sm justify-end">
        <Link
          to="/workouts/new"
          data-testid="new-workout-button"
          className="rounded-md bg-primary px-2.5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
        >
          New workout
        </Link>
      </div>
      <ActiveSessionsStrip />
      <div className="w-full max-w-sm">
        <WorkoutList />
      </div>
    </div>
  )
}
