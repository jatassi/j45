import * as React from 'react'

import { Result, useAtomRefresh, useAtomValue } from '@effect-atom/atom-react'
import { type SessionSummary } from '@j45/domain'
import { Link } from '@tanstack/react-router'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * Active live sessions (`ListActiveSessions`), hoisted to module scope for a
 * stable atom identity — same pattern as `listWorkoutsAtom` in `lib/workouts.ts`.
 * Not exported: this file only exports components (`react/only-export-components`).
 */
const listActiveSessionsAtom = ServerRpcClient.query('ListActiveSessions', undefined)

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

const homeLinkClass = 'text-sm text-primary underline-offset-4 hover:underline'

/**
 * Interim home dashboard (`/` once the route tree restructure lands): active
 * live sessions (when any), plus quick-action links to the timer and the new
 * workout editor. The shell's AppHeader / TabBar replace the old library nav.
 */
export function HomeScreen() {
  return (
    <div className="flex min-h-svh flex-col items-center gap-6 p-6" data-testid="home-screen">
      <ActiveSessionsStrip />
      <nav className="flex w-full max-w-sm items-center gap-4">
        <Link to="/timer" data-testid="home-timer-link" className={homeLinkClass}>
          Timer
        </Link>
        <Link to="/workouts/new" data-testid="home-new-workout-link" className={homeLinkClass}>
          New workout
        </Link>
      </nav>
    </div>
  )
}
