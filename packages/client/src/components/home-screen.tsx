import * as React from 'react'

import { Result, useAtom, useAtomRefresh, useAtomValue } from '@effect-atom/atom-react'
import {
  compile,
  type Focus,
  type LibraryWorkout,
  type SessionSummary,
  type WorkoutId,
} from '@j45/domain'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Dumbbell, Play, Plus, Sparkles, Timer, X } from 'lucide-react'
import { toast } from 'sonner'

import { HomeHero } from '@/components/home-hero'
import { QueryBoundary } from '@/components/query-boundary'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSceneSurface } from '@/glass/use-scene-surface'
import { listHistoryAtom, pickHero, recentRows, startWorkoutAtom } from '@/lib/home'
import { HOME_NOTICE_TEXT, homeNotice } from '@/lib/home-notice'
import { ServerRpcClient } from '@/lib/rpc-client'
import { cn } from '@/lib/utils'
import { formatDuration, listWorkoutsAtom } from '@/lib/workouts'

/**
 * Active live sessions (`ListActiveSessions`), hoisted to module scope for a
 * stable atom identity — same pattern as `listWorkoutsAtom` / `listHistoryAtom`.
 * Not exported: this file only exports components (`react/only-export-components`).
 */
const listActiveSessionsAtom = ServerRpcClient.query('ListActiveSessions', undefined)

/** How many recent rows the home list shows (history-first, library-padded). */
const RECENT_COUNT = 5

/** Sport-tint tile surface for each focus literal; hybrid is the unresolved fallback. */
const HUE_TILE: Record<Focus, string> = {
  cardio: 'bg-hue-cardio/15 text-hue-cardio',
  strength: 'bg-hue-strength/15 text-hue-strength',
  hybrid: 'bg-hue-hybrid/15 text-hue-hybrid',
}

/**
 * Drives `StartSession` via the module-scoped `startWorkoutAtom`, then
 * navigates to `/session/<id>` on success. Failures toast via sonner and
 * leave the control interactive (no stuck disabled state) — same contract
 * as `home-hero.tsx`'s `useStartWorkout`.
 */
function useStartWorkout(workoutId: WorkoutId) {
  const navigate = useNavigate()
  const [, start] = useAtom(startWorkoutAtom, { mode: 'promise' })
  const [busy, setBusy] = React.useState(false)

  return {
    busy,
    start: () => {
      if (busy) {
        return
      }
      setBusy(true)
      void start({ payload: { workoutId } })
        .then((summary: SessionSummary) => {
          void navigate({ to: `/session/${summary.id}` })
        })
        .catch(() => {
          toast.error('Could not start session', {
            description: 'Try again in a moment.',
          })
        })
        .finally(() => {
          setBusy(false)
        })
    },
  }
}

/** One quick-start tile: scene-registered so glass chrome refracts it. */
function QuickTile(props: {
  readonly to: '/timer' | '/generate' | '/workouts/new'
  readonly testId: string
  readonly label: string
  readonly Icon: typeof Timer
}) {
  const ref = React.useRef<HTMLAnchorElement>(null)
  useSceneSurface(ref)
  const { Icon } = props
  return (
    <Link
      ref={ref}
      to={props.to}
      data-testid={props.testId}
      className="flex min-h-11 flex-col items-center justify-center gap-1.5 rounded-2xl bg-card p-3 ring-1 ring-foreground/10 transition-colors hover:bg-muted/40"
    >
      <Icon className="size-6 text-foreground/85" strokeWidth={2} aria-hidden />
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {props.label}
      </span>
    </Link>
  )
}

/**
 * The explanation a session that ended sends its people here with, read from
 * the `notice` search parameter the route validates (see `router.tsx`).
 * Nothing renders without one.
 *
 * Dismissing rewrites the url without the parameter, so a reload — or a
 * later return to home — does not show the same message again. `replace`
 * keeps the dismissed url out of the back history.
 */
function HomeNoticeBanner() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { readonly notice?: unknown }
  const notice = homeNotice(search.notice)
  if (notice === undefined) {
    return null
  }
  const { title, description } = HOME_NOTICE_TEXT[notice]
  return (
    <Alert className="w-full max-w-sm" data-testid="home-notice" data-notice={notice}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 size-8"
        data-testid="home-notice-dismiss"
        aria-label="Dismiss"
        onClick={() => {
          void navigate({ to: '/', search: {}, replace: true })
        }}
      >
        <X className="size-4" />
      </Button>
    </Alert>
  )
}

/** Timer · Generate · New — three equal quick-start tiles with 44px+ targets. */
function QuickStartRow() {
  return (
    <section className="flex w-full max-w-sm flex-col gap-3" aria-label="Quick start">
      <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        Quick start
      </p>
      <nav className="grid grid-cols-3 gap-3">
        <QuickTile to="/timer" testId="home-timer-link" label="Timer" Icon={Timer} />
        <QuickTile to="/generate" testId="home-generate-link" label="Generate" Icon={Sparkles} />
        <QuickTile to="/workouts/new" testId="home-new-workout-link" label="New" Icon={Plus} />
      </nav>
    </section>
  )
}

type RecentRowProps = {
  readonly libraryWorkout: LibraryWorkout
}

/** The row's start affordance — drives `startWorkoutAtom` without navigating. */
function RecentStartButton({ libraryWorkout }: RecentRowProps) {
  const { workout, id } = libraryWorkout
  const { busy, start } = useStartWorkout(id)
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      className="size-11 shrink-0 rounded-full"
      data-testid={`recent-start-${id}`}
      disabled={busy}
      aria-label={`Start ${workout.name}`}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        start()
      }}
    >
      <Play className="size-4" fill="currentColor" />
    </Button>
  )
}

/**
 * One recent row: focus-hued icon tile, name, `works · MM:SS` summary, and a
 * separate start affordance. Row body links to the workout detail; start
 * drives `startWorkoutAtom` without also navigating the row.
 */
function RecentRow({ libraryWorkout }: RecentRowProps) {
  const { workout, id } = libraryWorkout
  const { workTotal, totalDurationMillis } = compile(workout)
  const focus = workout.focus
  const sceneRef = React.useRef<HTMLLIElement>(null)
  useSceneSurface(sceneRef)

  return (
    <li
      ref={sceneRef}
      className="flex items-center gap-2 rounded-2xl bg-card p-2 ring-1 ring-foreground/10"
    >
      <Link
        to="/workouts/$workoutId"
        params={{ workoutId: id }}
        data-testid={`recent-row-${id}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left"
      >
        <span
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-xl',
            HUE_TILE[focus],
          )}
          aria-hidden
        >
          <Dumbbell className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-heading text-base font-bold tracking-tight">
            {workout.name}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {workTotal} works · {formatDuration(totalDurationMillis)}
          </p>
        </div>
      </Link>
      <RecentStartButton libraryWorkout={libraryWorkout} />
    </li>
  )
}

type RecentListProps = {
  readonly rows: readonly LibraryWorkout[]
}

/** Non-empty recent list container — one row per resolved library workout. */
function RecentList({ rows }: RecentListProps) {
  if (rows.length === 0) {
    return null
  }
  return (
    <section className="flex w-full max-w-sm flex-col gap-3" aria-label="Recent">
      <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        Recent
      </p>
      <ul className="flex w-full flex-col gap-2.5" data-testid="home-recent-list">
        {rows.map((libraryWorkout) => (
          <RecentRow key={libraryWorkout.id} libraryWorkout={libraryWorkout} />
        ))}
      </ul>
    </section>
  )
}

/** Skeleton while history/workouts are still loading for the recent list. */
function RecentSkeleton() {
  return (
    <div
      data-testid="home-recent-skeleton"
      className="flex w-full max-w-sm flex-col gap-2.5"
      aria-hidden
    >
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-14 w-full rounded-2xl" />
      <Skeleton className="h-14 w-full rounded-2xl" />
      <Skeleton className="h-14 w-full rounded-2xl" />
    </div>
  )
}

/**
 * Home dashboard (`/`): an ended-session notice when one sent the caller
 * here, the hero fold (live → start-last → browse), quick-start tiles, and a
 * recent list. Owns the `ListActiveSessions` 5s poll (silent
 * failure → no-live pick), plus `listHistoryAtom` / `listWorkoutsAtom` for
 * pick + recent composition. Visible failure only for history/workouts.
 */
export function HomeScreen() {
  const sessionsResult = useAtomValue(listActiveSessionsAtom)
  const historyResult = useAtomValue(listHistoryAtom)
  const workoutsResult = useAtomValue(listWorkoutsAtom)
  const refreshSessions = useAtomRefresh(listActiveSessionsAtom)
  const refreshHistory = useAtomRefresh(listHistoryAtom)
  const refreshWorkouts = useAtomRefresh(listWorkoutsAtom)

  React.useEffect(() => {
    const handle = globalThis.setInterval(() => {
      refreshSessions()
    }, 5000)
    return () => {
      globalThis.clearInterval(handle)
    }
  }, [refreshSessions])

  const data = Result.all({ history: historyResult, workouts: workoutsResult })
  // Live poll never owns the fold: Initial and Failure both read as no sessions.
  const sessions = Result.getOrElse(sessionsResult, (): readonly SessionSummary[] => [])

  const retryData = () => {
    refreshHistory()
    refreshWorkouts()
  }

  return (
    <div className="flex min-h-svh flex-col items-center gap-6 p-6" data-testid="home-screen">
      <HomeNoticeBanner />

      <QueryBoundary
        result={data}
        loading={<HomeHero pick={undefined} />}
        errorTitle="Couldn't load home"
        onRetry={retryData}
      >
        {({ history, workouts }) => <HomeHero pick={pickHero(sessions, history, workouts)} />}
      </QueryBoundary>

      <QuickStartRow />

      <QueryBoundary
        result={data}
        loading={<RecentSkeleton />}
        errorTitle="Couldn't load recent"
        onRetry={retryData}
      >
        {({ history, workouts }) => (
          <RecentList rows={recentRows(history, workouts, RECENT_COUNT)} />
        )}
      </QueryBoundary>
    </div>
  )
}
