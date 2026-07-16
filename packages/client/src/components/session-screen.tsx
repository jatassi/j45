import { useEffect, useMemo, useRef } from 'react'

import { Result, useAtom, useAtomValue } from '@effect-atom/atom-react'
import { SessionId } from '@j45/domain'
import type { SessionState } from '@j45/domain'
import { useNavigate, useParams } from '@tanstack/react-router'
import * as Schema from 'effect/Schema'

import { PhaseBackdrop } from '@/components/player/phase-backdrop'
import { ProgressDots } from '@/components/player/progress-dots'
import {
  CenterStack,
  Participants,
  SessionDock,
  TopStrip,
  type Dispatch,
  type Leave,
} from '@/components/session-player-parts'
import {
  contextLine,
  cueKey,
  currentWorkContext,
  displayMillis,
  leaveSessionAtom,
  podGroups,
  sendSessionCommandAtom,
  sessionFeedFamily,
  sessionPhase,
  sessionTotals,
  sessionWorks,
  type SessionFeed,
} from '@/lib/session'
import { beepCountdown, beepDone, beepReady, beepRest, beepWork } from '@/player/audio'
import { useCountdown } from '@/player/use-countdown'
import { useVisualViewportHeight } from '@/player/use-visual-viewport-height'
import { useWakeLock } from '@/player/wake-lock'

/** A whole-screen centered status message (connecting / navigating away). */
function StatusScreen({ testId, message }: { readonly testId: string; readonly message: string }) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6"
      data-testid={testId}
    >
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

/**
 * The beep on entering each new segment (and the rising chord when done),
 * keyed so a resume re-enters the same segment silently. Mirrors the manual
 * timer's cue effect — the shared player-kit contract.
 */
function useSegmentCues(state: SessionState): void {
  const cueRef = useRef<string | null>(null)
  useEffect(() => {
    const key = cueKey(state)
    if (key === null) {
      cueRef.current = null
      return
    }
    if (cueRef.current === key) return
    cueRef.current = key
    if (state.timer._tag !== 'running') {
      beepDone()
      return
    }
    const segment = state.compiled.segments[state.timer.segmentIndex]
    if (segment._tag === 'work') beepWork()
    else if (segment._tag === 'rest') beepRest()
    else beepReady()
  }, [state])
}

/**
 * The display countdown, corrected for clock skew: the server's absolute
 * `endsAtMillis` is shifted by `clientNow − serverNow` (captured when the
 * snapshot arrives) before the phone's `Date.now()`-based hook ever reads
 * it, so the count reflects the server clock, never the raw phone clock.
 */
function useServerCountdown(state: SessionState): number {
  const clockOffset = useMemo(() => Date.now() - state.serverNow, [state.serverNow])
  const deadline = state.timer._tag === 'running' ? state.timer.endsAtMillis + clockOffset : null
  const { remainingMillis } = useCountdown(deadline, {
    onSecondTransition: (whole) => {
      if (whole >= 1 && whole <= 3) beepCountdown(whole)
    },
  })
  return displayMillis(state, remainingMillis)
}

/**
 * The timer-driving and exit actions bound to this session id. Any participant
 * may send commands (`SendSessionCommand`); `LeaveSession` is the only exit,
 * whose failures surface via the atoms' own `Result`.
 */
function useSessionActions(id: SessionId): {
  readonly dispatch: Dispatch
  readonly onLeave: Leave
} {
  const [, send] = useAtom(sendSessionCommandAtom, { mode: 'promise' })
  const [, leaveSession] = useAtom(leaveSessionAtom, { mode: 'promise' })
  const dispatch: Dispatch = (command) => {
    void send({ payload: { id, command } }).catch(() => {
      // Surfaced via sendSessionCommandAtom's own Result; nothing to do here.
    })
  }
  const onLeave: Leave = () => {
    void leaveSession({ payload: { id } }).catch(() => {
      // Surfaced via leaveSessionAtom's own Result; nothing to do here.
    })
  }
  return { dispatch, onLeave }
}

/** The live session render: server state only, plus the player-kit wiring. */
function SessionView({ state }: { readonly state: SessionState }) {
  const count = useServerCountdown(state)
  const { dispatch, onLeave } = useSessionActions(state.id)
  useSegmentCues(state)
  useWakeLock(state.timer._tag === 'running')

  const works = useMemo(() => sessionWorks(state.compiled.segments), [state.compiled.segments])
  const totals = useMemo(() => sessionTotals(works), [works])
  const groups = useMemo(() => podGroups(works), [works])
  const ctx = currentWorkContext(state)
  const phase = sessionPhase(state)
  // Tracks iOS Safari's toolbar live (see the hook): the container — and with
  // it the bottom-anchored dock and the flexing center stack — resizes with
  // every visualViewport change instead of waiting for `dvh` to re-resolve.
  const viewportHeight = useVisualViewportHeight()

  return (
    <div
      className="relative flex h-dvh flex-col items-center gap-4 overflow-hidden px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[calc(7.25rem+max(2rem,env(safe-area-inset-bottom)+0.75rem))]"
      style={viewportHeight === undefined ? undefined : { height: viewportHeight }}
      data-testid="session-screen"
      data-phase={phase}
    >
      <PhaseBackdrop phase={phase} paused={state.timer._tag === 'paused'} />
      <TopStrip
        workoutName={state.workoutName}
        showLeave={state.timer._tag !== 'done'}
        onLeave={onLeave}
      />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
        <CenterStack
          state={state}
          phase={phase}
          ctx={ctx}
          count={count}
          context={ctx === undefined ? '' : contextLine(ctx, totals)}
        />
        <ProgressDots groups={groups} currentWorkIndex={ctx?.workIndex} />
        <Participants participants={state.participants} />
      </div>
      <SessionDock state={state} dispatch={dispatch} onLeave={onLeave} />
    </div>
  )
}

/**
 * Renders one feed value and, when the session has ended (clean completion or
 * `SessionNotFound`), navigates home with a notice — the same destination for
 * both. A transport failure shows the reconnecting indicator while the atom
 * retries with backoff underneath.
 */
function SessionFeedView({ feed }: { readonly feed: SessionFeed }) {
  const navigate = useNavigate()
  const ended = feed._tag === 'ended'
  useEffect(() => {
    if (ended) {
      void navigate({ to: '/', search: { notice: 'session-ended' } })
    }
  }, [ended, navigate])

  if (feed._tag === 'live') return <SessionView state={feed.state} />
  if (feed._tag === 'reconnecting')
    return <StatusScreen testId="session-reconnecting" message="Reconnecting…" />
  return <StatusScreen testId="session-ended" message="Session ended." />
}

/**
 * `/session/$sessionId` (see `router.tsx`): holds the latest `SessionState`
 * via the `WatchSession` stream atom and renders the live player — countdown,
 * beeps, wake lock, and shared controls — entirely from server state.
 */
export function SessionScreen() {
  const { sessionId: raw } = useParams({ strict: false }) as { sessionId: string }
  const sessionId = Schema.decodeSync(SessionId)(raw)
  const feed = useAtomValue(sessionFeedFamily(sessionId))

  return Result.match(feed, {
    onInitial: () => <StatusScreen testId="session-connecting" message="Connecting…" />,
    onFailure: () => <StatusScreen testId="session-connecting" message="Connecting…" />,
    onSuccess: ({ value }) => <SessionFeedView feed={value} />,
  })
}
