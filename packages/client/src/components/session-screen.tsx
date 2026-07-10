import { useEffect, useMemo, useReducer, useRef } from 'react'

import { Result, useAtom, useAtomValue } from '@effect-atom/atom-react'
import { SessionId } from '@j45/domain'
import type { Participant, SessionCommand, SessionState, WorkContext } from '@j45/domain'
import { useNavigate, useParams } from '@tanstack/react-router'
import * as Schema from 'effect/Schema'

import { Button } from '@/components/ui/button'
import {
  cellState,
  contextLine,
  cueKey,
  currentWorkContext,
  displayMillis,
  nextWorkStationName,
  phaseLabel,
  podGroups,
  sendSessionCommandAtom,
  sessionFeedFamily,
  sessionTotals,
  sessionWorks,
  type CellState,
  type PodGroup,
  type SessionFeed,
} from '@/lib/session'
import { formatDuration } from '@/lib/workouts'
import {
  audioState,
  beepCountdown,
  beepDone,
  beepReady,
  beepRest,
  beepWork,
  unlockAudio,
  type AudioState,
} from '@/player/audio'
import { useCountdown } from '@/player/use-countdown'
import { useWakeLock } from '@/player/wake-lock'

/** A whole-screen centered status message (connecting / navigating away). */
function StatusScreen({ testId, message }: { readonly testId: string; readonly message: string }) {
  return (
    <div
      className="flex min-h-svh flex-col items-center justify-center gap-2 p-6"
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

type ReadoutProps = {
  readonly state: SessionState
  readonly ctx: WorkContext | undefined
  readonly count: string
  readonly context: string
  readonly nextUp: string | undefined
}

/** Phase, big count, current exercise + detail, the context strip, and next-up. */
function Readout({ state, ctx, count, context, nextUp }: ReadoutProps) {
  const station = ctx?.station
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-2">
      <p className="text-lg font-medium" data-testid="session-phase">
        {phaseLabel(state)}
      </p>
      <p className="text-6xl font-semibold tabular-nums" data-testid="session-count">
        {count}
      </p>
      <p className="text-xl font-medium" data-testid="session-exercise-name">
        {station?.name ?? '—'}
      </p>
      {station?.detail === undefined ? null : (
        <p className="text-sm text-muted-foreground" data-testid="session-exercise-detail">
          {station.detail}
        </p>
      )}
      <p className="text-sm text-muted-foreground" data-testid="session-context">
        {context}
      </p>
      {nextUp === undefined ? null : (
        <p className="text-sm text-muted-foreground" data-testid="session-next-up">
          Next: {nextUp}
        </p>
      )}
    </div>
  )
}

const cellClass: Record<CellState, string> = {
  done: 'bg-primary',
  active: 'bg-primary ring-2 ring-primary ring-offset-2 ring-offset-background',
  upcoming: 'bg-input/40',
}

/** One pod's row of progress cells, one per work, keyed by its stable `workIndex`. */
function PodRow({
  group,
  currentWorkIndex,
}: {
  readonly group: PodGroup
  readonly currentWorkIndex: number | undefined
}) {
  return (
    <div className="flex flex-col gap-1" data-testid={`session-pod-group-${group.podIndex}`}>
      <span className="text-xs text-muted-foreground">{group.podName}</span>
      <div className="flex flex-wrap gap-1">
        {group.works.map((work) => {
          const state = cellState(work.workIndex, currentWorkIndex)
          return (
            <span
              key={work.workIndex}
              data-testid={`session-progress-cell-${work.workIndex}`}
              data-state={state}
              className={`h-3 w-3 rounded-sm ${cellClass[state]}`}
            />
          )
        })}
      </div>
    </div>
  )
}

/** Every work as a progress cell, grouped by pod — legacy-parity completion strip. */
function ProgressGrid({
  groups,
  currentWorkIndex,
}: {
  readonly groups: readonly PodGroup[]
  readonly currentWorkIndex: number | undefined
}) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-2" data-testid="session-progress">
      {groups.map((group) => (
        <PodRow key={group.podIndex} group={group} currentWorkIndex={currentWorkIndex} />
      ))}
    </div>
  )
}

/** The joined participants, host included, by display name. */
function Participants({ participants }: { readonly participants: readonly Participant[] }) {
  return (
    <div className="flex w-full max-w-sm flex-wrap gap-2" data-testid="session-participants">
      {participants.map((participant) => (
        <span
          key={participant.userId}
          data-testid={`session-participant-${participant.userId}`}
          className="rounded-full bg-input/40 px-2.5 py-1 text-xs"
        >
          {participant.displayName}
        </span>
      ))}
    </div>
  )
}

type PrimaryControl = {
  readonly testId: string
  readonly label: string
  readonly command: SessionCommand
}

/** Pause (running) or Resume (paused); `null` when done. */
function primaryControl(state: SessionState): PrimaryControl | null {
  if (state.timer._tag === 'running')
    return { testId: 'session-pause', label: 'Pause', command: 'pause' }
  if (state.timer._tag === 'paused')
    return { testId: 'session-resume', label: 'Resume', command: 'resume' }
  return null
}

type Dispatch = (command: SessionCommand) => void

/** The done state's single Finish control, which sends `quit`. */
function DoneControls({ dispatch }: { readonly dispatch: Dispatch }) {
  return (
    <div className="flex w-full max-w-sm">
      <Button
        type="button"
        data-testid="session-finish"
        className="flex-1"
        onClick={() => dispatch('quit')}
      >
        Finish
      </Button>
    </div>
  )
}

/** Prev, the Pause/Resume primary, and Skip — the running/paused controls. */
function RunControls({
  primary,
  dispatch,
}: {
  readonly primary: PrimaryControl | null
  readonly dispatch: Dispatch
}) {
  return (
    <div className="flex w-full max-w-sm gap-2">
      <Button
        type="button"
        variant="outline"
        data-testid="session-prev"
        className="flex-1"
        onClick={() => dispatch('prev')}
      >
        Prev
      </Button>
      {primary === null ? null : (
        <Button
          type="button"
          variant="secondary"
          data-testid={primary.testId}
          className="flex-1"
          onClick={() => dispatch(primary.command)}
        >
          {primary.label}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        data-testid="session-skip"
        className="flex-1"
        onClick={() => dispatch('skip')}
      >
        Skip
      </Button>
    </div>
  )
}

/**
 * Pause/Resume, Prev, Skip — any participant may drive them; the done state
 * shows Finish (which sends `quit`, ending the session for everyone). All go
 * through `SendSessionCommand`.
 */
function SessionControls({ state, id }: { readonly state: SessionState; readonly id: SessionId }) {
  const [, send] = useAtom(sendSessionCommandAtom, { mode: 'promise' })
  const dispatch: Dispatch = (command) => {
    void send({ payload: { id, command } }).catch(() => {
      // Surfaced via sendSessionCommandAtom's own Result; nothing to do here.
    })
  }
  return state.timer._tag === 'done' ? (
    <DoneControls dispatch={dispatch} />
  ) : (
    <RunControls primary={primaryControl(state)} dispatch={dispatch} />
  )
}

/** The muted/sound indicator — tappable to retry the audio unlock — carrying `data-audio`. */
function AudioIndicator({
  audio,
  onRetry,
}: {
  readonly audio: AudioState
  readonly onRetry: () => void
}) {
  return (
    <button
      type="button"
      data-testid="session-audio-indicator"
      data-audio={audio}
      onClick={onRetry}
      className="text-sm text-muted-foreground underline-offset-4 hover:underline"
    >
      {audio === 'on' ? 'Sound on' : 'Sound off'}
    </button>
  )
}

/** The live session render: server state only, plus the player-kit wiring. */
function SessionView({ state }: { readonly state: SessionState }) {
  const [, refreshAudio] = useReducer((n: number) => n + 1, 0)
  const count = useServerCountdown(state)
  useSegmentCues(state)
  useWakeLock(state.timer._tag === 'running')

  const works = useMemo(() => sessionWorks(state.compiled.segments), [state.compiled.segments])
  const totals = useMemo(() => sessionTotals(works), [works])
  const groups = useMemo(() => podGroups(works), [works])
  const ctx = currentWorkContext(state)

  return (
    <div className="flex min-h-svh flex-col items-center gap-6 p-6" data-testid="session-screen">
      <div className="flex w-full max-w-sm items-center justify-between">
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          {state.workoutName}
        </p>
        <AudioIndicator
          audio={audioState()}
          onRetry={() => {
            unlockAudio()
            refreshAudio()
          }}
        />
      </div>
      <Readout
        state={state}
        ctx={ctx}
        count={formatDuration(count)}
        context={ctx === undefined ? '' : contextLine(ctx, totals)}
        nextUp={nextWorkStationName(state)}
      />
      <ProgressGrid groups={groups} currentWorkIndex={ctx?.workIndex} />
      <SessionControls state={state} id={state.id} />
      <Participants participants={state.participants} />
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
  const { sessionId: raw } = useParams({ from: '/session/$sessionId' }) as { sessionId: string }
  const sessionId = Schema.decodeSync(SessionId)(raw)
  const feed = useAtomValue(sessionFeedFamily(sessionId))

  return Result.match(feed, {
    onInitial: () => <StatusScreen testId="session-connecting" message="Connecting…" />,
    onFailure: () => <StatusScreen testId="session-connecting" message="Connecting…" />,
    onSuccess: ({ value }) => <SessionFeedView feed={value} />,
  })
}
