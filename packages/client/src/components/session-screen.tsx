import { useEffect, useMemo, useRef } from 'react'

import { Result, useAtom, useAtomValue } from '@effect-atom/atom-react'
import { SessionId } from '@j45/domain'
import type { SessionState } from '@j45/domain'
import { useNavigate, useParams } from '@tanstack/react-router'
import * as Schema from 'effect/Schema'
import { toast } from 'sonner'

import { PhaseBackdrop } from '@/components/player/phase-backdrop'
import { ProgressStrip } from '@/components/player/progress-strip'
import {
  CenterStack,
  Participants,
  ReconnectingChip,
  SessionDock,
  TopStrip,
  type Dispatch,
  type Leave,
} from '@/components/session-player-parts'
import {
  cueKey,
  currentWorkContext,
  displayMillis,
  leaveSessionAtom,
  progressStrip,
  sendSessionCommandAtom,
  sessionFeedFamily,
  sessionPhase,
  type SessionFeed,
} from '@/lib/session'
import { beepCountdown, beepDone, beepReady, beepRest, beepWork } from '@/player/audio'
import { useCountdown } from '@/player/use-countdown'
import { useVisualViewportHeight } from '@/player/use-visual-viewport-height'
import { useWakeLock } from '@/player/wake-lock'

/**
 * How long the plan-change notice stays on screen. This is longer than the
 * toaster's own default. A participant reads the notice during an exercise,
 * from a distance, and must not have to stop to take it in.
 */
const PLAN_NOTICE_MILLIS = 8000

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
 * The transient notice a plan change raises: one toast for each rise of
 * `planRevision`, and nothing for any other republish.
 *
 * The revision is the signal on purpose. The server republishes the snapshot
 * on every participant join and leave. A client that watched the compiled
 * workout for changes would raise a notice on those too.
 *
 * The count starts at the revision of the first snapshot this screen sees.
 * A participant who joins after a change thus gets no notice for it.
 *
 * No sound goes with the notice. Every beep this player makes carries timing
 * meaning. A beep that did not would weaken all of them.
 */
function usePlanChangeNotice(state: SessionState): void {
  const seenRef = useRef(state.planRevision)
  const { planRevision, planChangedBy } = state
  useEffect(() => {
    if (planRevision <= seenRef.current) return
    seenRef.current = planRevision
    toast('The plan changed', {
      description: `${planChangedBy ?? 'The host'} updated this workout.`,
      duration: PLAN_NOTICE_MILLIS,
    })
  }, [planRevision, planChangedBy])
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
 * may send commands (`SendSessionCommand`); `LeaveSession` is the only exit.
 *
 * Leaving goes home whether the rpc succeeds or not. A participant must be
 * able to leave a session they cannot reach, and an exit that waits on the
 * network is an exit that is advertised and does nothing. The server observes
 * the departure when the watch stream drops, which this navigation causes.
 */
function useSessionActions(id: SessionId): {
  readonly dispatch: Dispatch
  readonly onLeave: Leave
} {
  const navigate = useNavigate()
  const [, send] = useAtom(sendSessionCommandAtom, { mode: 'promise' })
  const [, leaveSession] = useAtom(leaveSessionAtom, { mode: 'promise' })
  const dispatch: Dispatch = (command) => {
    void send({ payload: { id, command } }).catch(() => {
      // Surfaced via sendSessionCommandAtom's own Result; nothing to do here.
    })
  }
  const onLeave: Leave = () => {
    void leaveSession({ payload: { id } }).catch(() => {
      // The participant is leaving either way; the navigate below is the exit.
    })
    void navigate({ to: '/', search: {} })
  }
  return { dispatch, onLeave }
}

/**
 * The session render: one snapshot — live, or the **Stale snapshot** a break
 * left behind — plus the player-kit wiring. `offline` says which, and it
 * changes nothing about the workout on screen: the clock counts to the
 * segment's absolute end either way, and the cues it passes are true.
 */
function SessionView({
  state,
  offline,
}: {
  readonly state: SessionState
  readonly offline: boolean
}) {
  const count = useServerCountdown(state)
  const { dispatch, onLeave } = useSessionActions(state.id)
  useSegmentCues(state)
  usePlanChangeNotice(state)
  useWakeLock(state.timer._tag === 'running')

  const ctx = currentWorkContext(state)
  const phase = sessionPhase(state)
  // The whole strip from one pure call: the compiled plan and the work in
  // focus decide every bar, cell and dot. An applied plan change replaces the
  // compiled plan, so the strip redraws with it.
  const strip = useMemo(
    () => progressStrip(state.compiled, ctx?.workIndex),
    [state.compiled, ctx?.workIndex],
  )
  // Tracks iOS Safari's toolbar live (see the hook): the container — and with
  // it the bottom-anchored dock and the flexing center stack — resizes with
  // every visualViewport change instead of waiting for `dvh` to re-resolve.
  const viewportHeight = useVisualViewportHeight()

  return (
    <div
      className="relative flex h-dvh flex-col items-center gap-3 overflow-hidden px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[calc(7.5rem+max(2rem,env(safe-area-inset-bottom)+0.75rem))]"
      style={viewportHeight === undefined ? undefined : { height: viewportHeight }}
      data-testid="session-screen"
      data-phase={phase}
    >
      <PhaseBackdrop phase={phase} paused={state.timer._tag === 'paused'} />
      <TopStrip
        workoutName={state.workoutName}
        offline={offline}
        showLeave={state.timer._tag !== 'done'}
        onLeave={onLeave}
      />
      {offline && <ReconnectingChip />}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
        <CenterStack state={state} phase={phase} ctx={ctx} count={count} />
        <ProgressStrip strip={strip} />
        <Participants participants={state.participants} />
      </div>
      <SessionDock state={state} offline={offline} dispatch={dispatch} onLeave={onLeave} />
    </div>
  )
}

/**
 * Renders one feed value and, when the session has ended, navigates home with
 * the notice that says why. Home is the destination for every ending; only
 * the notice differs, and a deleted plan gets its own.
 *
 * A break in the connection never takes the workout off screen. The stale
 * snapshot renders the same player element in the same place a live one does,
 * and that identity is the point: a different element, or a different
 * position, would remount the player and reset the wake lock, the countdown
 * and the cue refs — the original bug, minus the panel.
 *
 * A break before the first snapshot has no workout to protect, so it joins
 * the feed's initial and failure states on the plain connecting message.
 */
function SessionFeedView({ feed }: { readonly feed: SessionFeed }) {
  const navigate = useNavigate()
  const notice = feed._tag === 'ended' ? feed.notice : undefined
  useEffect(() => {
    if (notice !== undefined) {
      void navigate({ to: '/', search: { notice } })
    }
  }, [notice, navigate])

  const state = feed._tag === 'ended' ? null : feed.state
  if (state !== null) return <SessionView state={state} offline={feed._tag === 'reconnecting'} />
  if (feed._tag === 'reconnecting')
    return <StatusScreen testId="session-connecting" message="Connecting…" />
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
