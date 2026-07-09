import { useEffect, useReducer, useRef, useState } from 'react'

import {
  advanceIfDue,
  compile,
  nextTransitionAt,
  pause,
  quit,
  READY_SECONDS,
  resume,
  start,
  TimerIdle,
  type Segment,
  type TimerState,
} from '@j45/domain'
import * as Option from 'effect/Option'

import { Button } from '@/components/ui/button'
import { buildManualWorkout } from '@/lib/manual-workout'
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

/** The three inputs, parsed and clamped to their minimums. */
type Settings = {
  readonly workSeconds: number
  readonly restSeconds: number
  readonly rounds: number
}

const WORK_MIN = 5
const REST_MIN = 0
const ROUNDS_MIN = 1
const DEFAULTS: Settings = { workSeconds: 40, restSeconds: 20, rounds: 9 }

/** Parse an input string and clamp to a floor; empty/NaN falls back to the floor. */
function clampInt(raw: string, min: number): number {
  const parsed = Math.floor(Number(raw))
  return Number.isFinite(parsed) ? Math.max(min, parsed) : min
}

/** `9 rounds · 40″/20″` — the idle/get-ready context line, legacy parity. */
function settingsSummary({ workSeconds, restSeconds, rounds }: Settings): string {
  return `${rounds} rounds · ${workSeconds}″/${restSeconds}″`
}

/** Get ready / Work / Rest / Done — from the current segment (or the terminal tag). */
function phaseLabel(state: TimerState, segments: readonly Segment[]): string {
  if (state._tag === 'done') return 'Done'
  if (state._tag === 'idle') return 'Get ready'
  const segment = segments[state.segmentIndex]
  if (segment._tag === 'ready') return 'Get ready'
  return segment._tag === 'work' ? 'Work' : 'Rest'
}

/**
 * The context line: the settings summary while idle or getting ready, `Round
 * k of N` during work (this round) and rest (the round about to start, from
 * `RestSegment.nextWork.round`), and `Nice work` when done.
 */
function contextLine(state: TimerState, segments: readonly Segment[], session: Settings): string {
  if (state._tag === 'idle') return settingsSummary(session)
  if (state._tag === 'done') return 'Nice work'
  const segment = segments[state.segmentIndex]
  if (segment._tag === 'ready') return settingsSummary(session)
  const round = segment._tag === 'work' ? segment.work.round : segment.nextWork.round
  return `Round ${round} of ${session.rounds}`
}

/** Milliseconds to display: the live countdown while running, the frozen value while paused. */
function displayMillis(state: TimerState, liveRemaining: number | null): number {
  switch (state._tag) {
    case 'running': {
      return liveRemaining ?? 0
    }
    case 'paused': {
      return state.remainingMillis
    }
    case 'done': {
      return 0
    }
    case 'idle': {
      return READY_SECONDS * 1000
    }
  }
}

/** A stable key per cued segment, so a resume never re-fires the segment's beep. */
function cueKey(state: TimerState): string | null {
  if (state._tag === 'running') return `seg-${state.segmentIndex}`
  if (state._tag === 'done') return 'done'
  return null
}

/**
 * The driver: sleep until this segment's deadline (`nextTransitionAt`), then
 * advance — recomputed from `Date.now()` inside the callback so a late or
 * slept wake catches up across every boundary it crossed.
 */
function useTimerDriver(
  state: TimerState,
  segments: readonly Segment[],
  setState: (next: (prev: TimerState) => TimerState) => void,
): void {
  useEffect(() => {
    if (state._tag !== 'running') return undefined
    const target = Option.getOrUndefined(nextTransitionAt(state))
    if (target === undefined) return undefined
    const id = setTimeout(
      () => {
        setState((prev) => advanceIfDue(prev, segments, Date.now()))
      },
      Math.max(0, target - Date.now()),
    )
    return () => {
      clearTimeout(id)
    }
  }, [state, segments, setState])
}

/**
 * Segment-boundary beeps: fire once as each new segment is entered (and the
 * rising done chord when finished). A resume re-enters the same segment key
 * and stays silent; returning to idle re-arms the cue.
 */
function useSegmentCues(state: TimerState, segments: readonly Segment[]): void {
  const cueRef = useRef<string | null>(null)
  useEffect(() => {
    const key = cueKey(state)
    if (key === null) {
      cueRef.current = null
      return
    }
    if (cueRef.current === key) return
    cueRef.current = key
    if (state._tag !== 'running') {
      beepDone()
      return
    }
    const segment = segments[state.segmentIndex]
    if (segment._tag === 'work') beepWork()
    else if (segment._tag === 'rest') beepRest()
    else beepReady()
  }, [state, segments])
}

/**
 * The whole client-side timer: domain `TimerState`, the compiled segments it
 * runs, the driver + cue effects, and the display-only countdown (whose
 * whole-second boundaries fire the 3-2-1 tones). Actions build the synthetic
 * workout, compile it, and step the domain state — no timer sequencing lives
 * here.
 */
function useManualTimer() {
  const [state, setState] = useState<TimerState>(() => new TimerIdle({}))
  const [segments, setSegments] = useState<readonly Segment[]>([])
  const [session, setSession] = useState<Settings>(DEFAULTS)

  useTimerDriver(state, segments, setState)
  useSegmentCues(state, segments)

  const runningDeadline = state._tag === 'running' ? state.endsAtMillis : null
  const { remainingMillis: liveRemaining } = useCountdown(runningDeadline, {
    onSecondTransition: (whole) => {
      if (whole >= 1 && whole <= 3) beepCountdown(whole)
    },
  })

  const startTimer = (settings: Settings): void => {
    const compiled = compile(
      buildManualWorkout(settings.workSeconds, settings.restSeconds, settings.rounds),
    )
    setSession(settings)
    setSegments(compiled.segments)
    setState(() => start(compiled.segments, Date.now()))
  }
  const pauseTimer = (): void => setState((prev) => pause(prev, Date.now()))
  const resumeTimer = (): void => setState((prev) => resume(prev, Date.now()))
  const resetTimer = (): void => {
    setSegments([])
    setState((prev) => quit(prev))
  }

  return {
    state,
    segments,
    session,
    liveRemaining,
    startTimer,
    pauseTimer,
    resumeTimer,
    resetTimer,
  }
}

/** The three text inputs and their clamp-on-read into a `Settings`. */
function useTimerInputs() {
  const [workInput, setWorkInput] = useState(String(DEFAULTS.workSeconds))
  const [restInput, setRestInput] = useState(String(DEFAULTS.restSeconds))
  const [roundsInput, setRoundsInput] = useState(String(DEFAULTS.rounds))
  const readSettings = (): Settings => ({
    workSeconds: clampInt(workInput, WORK_MIN),
    restSeconds: clampInt(restInput, REST_MIN),
    rounds: clampInt(roundsInput, ROUNDS_MIN),
  })
  return {
    workInput,
    restInput,
    roundsInput,
    setWorkInput,
    setRestInput,
    setRoundsInput,
    readSettings,
  }
}

type ReadoutProps = {
  readonly phase: string
  readonly count: string
  readonly context: string
  readonly audio: AudioState
  readonly onRetryAudio: () => void
}

/**
 * The phase label, the big `M:SS` count, the context line, and the
 * muted/sound indicator — tappable to retry the unlock — carrying `data-audio`.
 */
function TimerReadout({ phase, count, context, audio, onRetryAudio }: ReadoutProps) {
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <div className="flex w-full items-center justify-between">
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">Timer</p>
        <button
          type="button"
          data-testid="audio-indicator"
          data-audio={audio}
          onClick={onRetryAudio}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {audio === 'on' ? 'Sound on' : 'Sound off'}
        </button>
      </div>
      <p className="text-lg font-medium" data-testid="timer-phase">
        {phase}
      </p>
      <p className="text-6xl font-semibold tabular-nums" data-testid="timer-count">
        {count}
      </p>
      <p className="text-sm text-muted-foreground" data-testid="timer-context">
        {context}
      </p>
    </div>
  )
}

type NumberFieldProps = {
  readonly label: string
  readonly min: number
  readonly testId: string
  readonly value: string
  readonly onChange: (value: string) => void
}

/** One labelled numeric input row. */
function NumberField({ label, min, testId, value, onChange }: NumberFieldProps) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        inputMode="numeric"
        data-testid={testId}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className="w-24 rounded-md border border-input bg-input/30 px-2.5 py-1.5 text-right text-sm"
      />
    </label>
  )
}

type IdleFormProps = {
  readonly inputs: ReturnType<typeof useTimerInputs>
  readonly onStart: () => void
}

/** The idle state: the three settings inputs and the Start control. */
function IdleForm({ inputs, onStart }: IdleFormProps) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <NumberField
        label="Work (sec)"
        min={WORK_MIN}
        testId="work-input"
        value={inputs.workInput}
        onChange={inputs.setWorkInput}
      />
      <NumberField
        label="Rest (sec)"
        min={REST_MIN}
        testId="rest-input"
        value={inputs.restInput}
        onChange={inputs.setRestInput}
      />
      <NumberField
        label="Rounds"
        min={ROUNDS_MIN}
        testId="rounds-input"
        value={inputs.roundsInput}
        onChange={inputs.setRoundsInput}
      />
      <Button type="button" data-testid="start-button" onClick={onStart}>
        Start
      </Button>
    </div>
  )
}

type RunControlsProps = {
  readonly state: TimerState
  readonly onPause: () => void
  readonly onResume: () => void
  readonly onReset: () => void
}

/** The running/paused primary action; `null` when done (only Reset remains). */
function primaryControl(state: TimerState, onPause: () => void, onResume: () => void) {
  if (state._tag === 'running') return { testId: 'pause-button', label: 'Pause', onClick: onPause }
  if (state._tag === 'paused')
    return { testId: 'resume-button', label: 'Resume', onClick: onResume }
  return null
}

/** Pause (running) or Resume (paused) — mutually exclusive — plus the always-present Reset. */
function RunControls({ state, onPause, onResume, onReset }: RunControlsProps) {
  const primary = primaryControl(state, onPause, onResume)
  return (
    <div className="flex w-full max-w-sm gap-2">
      {primary === null ? null : (
        <Button
          type="button"
          variant="secondary"
          data-testid={primary.testId}
          onClick={primary.onClick}
          className="flex-1"
        >
          {primary.label}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        data-testid="reset-button"
        onClick={onReset}
        className="flex-1"
      >
        Reset
      </Button>
    </div>
  )
}

/**
 * The `/timer` screen: an ad-hoc interval countdown run entirely client-side.
 * Reads work / rest / rounds, drives the domain timer (`useManualTimer`), and
 * wires the shared player kit — audio unlock on the Start tap (synchronous),
 * the `data-audio` indicator, and `useWakeLock` while running.
 */
export function TimerScreen() {
  const inputs = useTimerInputs()
  const timer = useManualTimer()
  const [, refreshAudio] = useReducer((n: number) => n + 1, 0)

  const audio = audioState()
  const isIdle = timer.state._tag === 'idle'
  useWakeLock(timer.state._tag === 'running')

  const handleStart = (): void => {
    // Unlock audio synchronously inside this tap — never deferred behind an
    // await — so iOS actually starts the context.
    unlockAudio()
    refreshAudio()
    timer.startTimer(inputs.readSettings())
  }
  const handleRetryAudio = (): void => {
    unlockAudio()
    refreshAudio()
  }

  const summarySettings = isIdle ? inputs.readSettings() : timer.session

  return (
    <div className="flex min-h-svh flex-col items-center gap-6 p-6" data-testid="timer-screen">
      <TimerReadout
        phase={phaseLabel(timer.state, timer.segments)}
        count={formatDuration(displayMillis(timer.state, timer.liveRemaining))}
        context={contextLine(timer.state, timer.segments, summarySettings)}
        audio={audio}
        onRetryAudio={handleRetryAudio}
      />
      {isIdle ? (
        <IdleForm inputs={inputs} onStart={handleStart} />
      ) : (
        <RunControls
          state={timer.state}
          onPause={timer.pauseTimer}
          onResume={timer.resumeTimer}
          onReset={timer.resetTimer}
        />
      )}
    </div>
  )
}
