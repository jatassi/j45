import * as React from 'react'

import { useAtom } from '@effect-atom/atom-react'
import type { Focus, LibraryWorkout, SessionSummary, WorkoutId } from '@j45/domain'
import { Link, useNavigate } from '@tanstack/react-router'
import * as DateTime from 'effect/DateTime'
import { toast } from 'sonner'

import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { startWorkoutAtom } from '@/lib/home'
import type { HeroPick } from '@/lib/home'
import { cn } from '@/lib/utils'

/** Sport-tint card surface for each focus literal; hybrid is the unresolved fallback. */
const HUE_CARD: Record<Focus, string> = {
  cardio: 'bg-hue-cardio/15 ring-hue-cardio/30',
  strength: 'bg-hue-strength/15 ring-hue-strength/30',
  hybrid: 'bg-hue-hybrid/15 ring-hue-hybrid/30',
}

/** Sport-tint accent text for LIVE labels and focus-tinted chrome. */
const HUE_TEXT: Record<Focus, string> = {
  cardio: 'text-hue-cardio',
  strength: 'text-hue-strength',
  hybrid: 'text-hue-hybrid',
}

/** One minute in milliseconds — the live hero's elapsed line counts in whole minutes. */
const MINUTE_MILLIS = 60_000

/** Whole minutes between two epoch instants, clamped at 0. */
function elapsedMinutes(startedAtMillis: number, nowMillis: number): number {
  return Math.floor(Math.max(0, nowMillis - startedAtMillis) / MINUTE_MILLIS)
}

/**
 * Milliseconds until the displayed minute changes next. A start in the future
 * (clock skew between the server and the phone) waits for the start. The
 * result is capped at one minute. A larger value would overflow `setTimeout`,
 * which then fires immediately and spins.
 */
function millisToNextMinute(startedAtMillis: number, nowMillis: number): number {
  const elapsed = nowMillis - startedAtMillis
  if (elapsed < 0) {
    return Math.min(-elapsed, MINUTE_MILLIS)
  }
  return MINUTE_MILLIS - (elapsed % MINUTE_MILLIS)
}

/**
 * Whole minutes since `startedAt`, with a ticking source of its own.
 *
 * The lobby feed stays quiet while nothing about a session changes, so it
 * would freeze this line. The hero therefore counts for itself.
 *
 * The hook reads the wall clock when it first renders, so the line is correct
 * immediately. It then re-reads on each whole-minute boundary. It uses one
 * chained `setTimeout` aligned to the boundary, not a frame loop, because the
 * display changes only once a minute. The effect clears its pending timeout,
 * so a hero that is no longer displayed leaves no timer behind.
 */
function useElapsedMinutes(startedAt: DateTime.Utc): number {
  const startedAtMillis = DateTime.toEpochMillis(startedAt)
  const [minutes, setMinutes] = React.useState(() => elapsedMinutes(startedAtMillis, Date.now()))

  React.useEffect(() => {
    let handle: ReturnType<typeof globalThis.setTimeout> | undefined

    const tick = (): void => {
      const now = Date.now()
      setMinutes(elapsedMinutes(startedAtMillis, now))
      handle = globalThis.setTimeout(tick, millisToNextMinute(startedAtMillis, now))
    }

    tick()
    return () => {
      globalThis.clearTimeout(handle)
    }
  }, [startedAtMillis])

  return minutes
}

/** Pulsing LIVE indicator in the sport-tint accent color. */
function LiveDot({ className }: { readonly className?: string }) {
  return (
    <span className={cn('relative flex size-2', className)} aria-hidden="true">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-70" />
      <span className="relative inline-flex size-2 rounded-full bg-current" />
    </span>
  )
}

type CompactSessionRowProps = {
  readonly session: SessionSummary
}

/** Compact live-session row beneath the hero — whole row joins the session. */
function CompactSessionRow({ session }: CompactSessionRowProps) {
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

/**
 * Drives `StartSession` via the module-scoped `startWorkoutAtom`, then
 * navigates to `/session/<id>` on success. Failures toast via sonner and
 * leave the fold interactive (no stuck disabled state).
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

type LiveHeroProps = {
  readonly session: SessionSummary
  readonly extras: readonly SessionSummary[]
  readonly workout?: LibraryWorkout
}

/** Live-session hero: sport-tinted card, join CTA, optional compact extras. */
function LiveHero({ session, extras, workout }: LiveHeroProps) {
  const focus: Focus = workout?.workout.focus ?? 'hybrid'
  const minutes = useElapsedMinutes(session.startedAt)
  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <Card data-testid="home-hero" className={cn('ring-1', HUE_CARD[focus])} size="default">
        <CardHeader>
          <div className={cn('flex items-center gap-2 text-xs font-medium', HUE_TEXT[focus])}>
            <LiveDot />
            LIVE
          </div>
          <CardTitle className="font-heading text-2xl leading-tight font-black tracking-tight">
            {session.workoutName}
          </CardTitle>
          <CardDescription>{session.hostDisplayName} is hosting</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground" data-testid="hero-elapsed">
            {minutes} min in · {session.participantCount} participants
          </p>
          <Link
            to={`/session/${session.id}`}
            data-testid={`session-card-${session.id}`}
            className={cn(buttonVariants({ variant: 'default' }), 'w-full')}
          >
            Join now
          </Link>
        </CardContent>
      </Card>
      {extras.length === 0 ? null : (
        <ul className="flex w-full flex-col gap-3">
          {extras.map((extra) => (
            <CompactSessionRow key={extra.id} session={extra} />
          ))}
        </ul>
      )}
    </div>
  )
}

type StartableHeroProps = {
  readonly workout: LibraryWorkout
  readonly title: string
  readonly showBrowseLink?: boolean
}

/**
 * Start-last / browse hero with a resolved library workout: heavy name,
 * full-width Start (`hero-start`), optional Browse library link.
 */
function StartableHero({ workout, title, showBrowseLink = false }: StartableHeroProps) {
  const focus = workout.workout.focus
  const { busy, start } = useStartWorkout(workout.id)

  return (
    <Card data-testid="home-hero" className={cn('w-full max-w-sm ring-1', HUE_CARD[focus])}>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="font-heading text-2xl leading-tight font-black tracking-tight">
          {workout.workout.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button
          type="button"
          className="w-full"
          data-testid="hero-start"
          disabled={busy}
          onClick={start}
        >
          Start
        </Button>
        {showBrowseLink ? (
          <Link
            to="/library"
            data-testid="hero-browse-link"
            className="text-center text-sm text-primary underline-offset-4 hover:underline"
          >
            Browse library
          </Link>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Empty-library browse fold — usable CTA, never blank, no start button. */
function BrowseEmpty() {
  return (
    <Card data-testid="home-hero" className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="font-heading text-xl font-bold">No workouts yet</CardTitle>
        <CardDescription>Browse the library or create a plan to get started.</CardDescription>
      </CardHeader>
      <CardContent>
        <Link
          to="/library"
          data-testid="hero-browse-link"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Browse library
        </Link>
      </CardContent>
    </Card>
  )
}

/** Skeleton while the parent hero pick is still in flight. */
function HeroSkeleton() {
  return (
    <div
      data-testid="home-hero-skeleton"
      className="flex w-full max-w-sm flex-col gap-3 rounded-xl p-6 ring-1 ring-foreground/10"
    >
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="mt-2 h-10 w-full" />
    </div>
  )
}

type HomeHeroProps = {
  /** Priority-picked hero content, or `undefined` while queries are still loading. */
  readonly pick: HeroPick | undefined
}

/**
 * Home dashboard hero fold. Renders against a `HeroPick` from `lib/home`
 * (live → start-last → browse), or a skeleton when `pick` is still loading.
 * The fold is never empty — even an empty-library browse pick shows a CTA.
 */
export function HomeHero({ pick }: HomeHeroProps) {
  if (pick === undefined) {
    return <HeroSkeleton />
  }
  if (pick._tag === 'live') {
    return <LiveHero session={pick.session} extras={pick.extras} workout={pick.workout} />
  }
  if (pick._tag === 'start-last') {
    return <StartableHero workout={pick.workout} title="Start last" />
  }
  if (pick.workout === undefined) {
    return <BrowseEmpty />
  }
  return <StartableHero workout={pick.workout} title="From your library" showBrowseLink />
}
