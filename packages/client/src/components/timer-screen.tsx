import { useEffect, useReducer, useRef, useState } from 'react'

import * as Domain from '@j45/domain'
import * as Option from 'effect/Option'

import { ControlDock } from '@/components/player/control-dock'
import type { PlayerPhase } from '@/components/player/phase'
import { PhaseBackdrop } from '@/components/player/phase-backdrop'
import { ProgressRing } from '@/components/player/progress-ring'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { buildManualWorkout } from '@/lib/manual-workout'
import { formatDuration } from '@/lib/workouts'
import * as Audio from '@/player/audio'
import { useCountdown } from '@/player/use-countdown'
import { useWakeLock } from '@/player/wake-lock'

type Settings = {
  readonly workSeconds: number
  readonly restSeconds: number
  readonly rounds: number
}
type TimerState = Domain.TimerState
type Segment = Domain.Segment
type AudioProps = { audio: Audio.AudioState; onRetry: () => void }
type DigitsProps = { phase: string; count: string; context: string }
type ViewModel = DigitsProps & { fraction: number; playerPhase: PlayerPhase }

const WORK_MIN = 5
const REST_MIN = 0
const ROUNDS_MIN = 1
const DEFAULTS: Settings = { workSeconds: 40, restSeconds: 20, rounds: 9 }

function clampInt(raw: string, min: number): number {
  const parsed = Math.floor(Number(raw))
  return Number.isFinite(parsed) ? Math.max(min, parsed) : min
}

function settingsSummary(s: Settings): string {
  return `${s.rounds} rounds · ${s.workSeconds}″/${s.restSeconds}″`
}

/** Phase label, player-kit phase, and context line — one segment lookup. */
function phaseInfo(state: TimerState, segments: readonly Segment[], session: Settings) {
  if (state._tag === 'done')
    return { phase: 'Done', playerPhase: 'done' as const, context: 'Nice work' }
  if (state._tag === 'idle') {
    return { phase: 'Get ready', playerPhase: 'ready' as const, context: settingsSummary(session) }
  }
  const segment = segments[state.segmentIndex]
  if (segment._tag === 'ready') {
    return { phase: 'Get ready', playerPhase: 'ready' as const, context: settingsSummary(session) }
  }
  const work = segment._tag === 'work'
  const round = work ? segment.work.round : segment.nextWork.round
  return {
    phase: work ? 'Work' : 'Rest',
    playerPhase: (work ? 'work' : 'rest') as PlayerPhase,
    context: `Round ${round} of ${session.rounds}`,
  }
}

function displayMillis(state: TimerState, liveRemaining: number | null): number {
  if (state._tag === 'running') return liveRemaining ?? 0
  if (state._tag === 'paused') return state.remainingMillis
  if (state._tag === 'done') return 0
  return Domain.READY_SECONDS * 1000
}

/** Same remaining millis as the digits so pause freezes count and ring together. */
function ringFraction(
  state: TimerState,
  segments: readonly Segment[],
  liveRemaining: number | null,
): number {
  if (state._tag === 'idle' || state._tag === 'done') return 0
  const duration = segments[state.segmentIndex].durationMillis
  if (duration <= 0) return 0
  return Math.max(0, Math.min(1, displayMillis(state, liveRemaining) / duration))
}

function viewModel(timer: ReturnType<typeof useManualTimer>, settings: Settings): ViewModel {
  const millis = displayMillis(timer.state, timer.liveRemaining)
  return {
    ...phaseInfo(timer.state, timer.segments, settings),
    count: formatDuration(millis),
    fraction: ringFraction(timer.state, timer.segments, timer.liveRemaining),
  }
}

function useTimerDriver(
  state: TimerState,
  segments: readonly Segment[],
  setState: (next: (prev: TimerState) => TimerState) => void,
): void {
  useEffect(() => {
    if (state._tag !== 'running') return undefined
    const target = Option.getOrUndefined(Domain.nextTransitionAt(state))
    if (target === undefined) return undefined
    const id = setTimeout(
      () => {
        setState((prev) => Domain.advanceIfDue(prev, segments, Date.now()))
      },
      Math.max(0, target - Date.now()),
    )
    return () => {
      clearTimeout(id)
    }
  }, [state, segments, setState])
}

function useSegmentCues(state: TimerState, segments: readonly Segment[]): void {
  const cueRef = useRef<string | null>(null)
  useEffect(() => {
    let key: string | null = null
    if (state._tag === 'running') key = `seg-${state.segmentIndex}`
    else if (state._tag === 'done') key = 'done'
    if (key === null) {
      cueRef.current = null
      return
    }
    if (cueRef.current === key) return
    cueRef.current = key
    if (state._tag !== 'running') {
      Audio.beepDone()
      return
    }
    const segment = segments[state.segmentIndex]
    if (segment._tag === 'work') Audio.beepWork()
    else if (segment._tag === 'rest') Audio.beepRest()
    else Audio.beepReady()
  }, [state, segments])
}

function useManualTimer() {
  const [state, setState] = useState<TimerState>(() => new Domain.TimerIdle({}))
  const [segments, setSegments] = useState<readonly Segment[]>([])
  const [session, setSession] = useState<Settings>(DEFAULTS)
  useTimerDriver(state, segments, setState)
  useSegmentCues(state, segments)
  const { remainingMillis: liveRemaining } = useCountdown(
    state._tag === 'running' ? state.endsAtMillis : null,
    {
      onSecondTransition: (whole) => {
        if (whole >= 1 && whole <= 3) Audio.beepCountdown(whole)
      },
    },
  )
  return {
    state,
    segments,
    session,
    liveRemaining,
    startTimer: (settings: Settings): void => {
      const compiled = Domain.compile(
        buildManualWorkout(settings.workSeconds, settings.restSeconds, settings.rounds),
      )
      setSession(settings)
      setSegments(compiled.segments)
      setState(() => Domain.start(compiled.segments, Date.now()))
    },
    pauseTimer: (): void => setState((prev) => Domain.pause(prev, Date.now())),
    resumeTimer: (): void => setState((prev) => Domain.resume(prev, Date.now())),
    resetTimer: (): void => {
      setSegments([])
      setState((prev) => Domain.quit(prev))
    },
  }
}

function useTimerInputs() {
  const [workInput, setWorkInput] = useState(String(DEFAULTS.workSeconds))
  const [restInput, setRestInput] = useState(String(DEFAULTS.restSeconds))
  const [roundsInput, setRoundsInput] = useState(String(DEFAULTS.rounds))
  return {
    workInput,
    restInput,
    roundsInput,
    setWorkInput,
    setRestInput,
    setRoundsInput,
    readSettings: (): Settings => ({
      workSeconds: clampInt(workInput, WORK_MIN),
      restSeconds: clampInt(restInput, REST_MIN),
      rounds: clampInt(roundsInput, ROUNDS_MIN),
    }),
  }
}

// prettier-ignore
function Header({ audio, onRetry, className }: AudioProps & { className: string }) {
  return (
    <div className={className}>
      <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">Timer</p>
      <button type="button" data-testid="audio-indicator" data-audio={audio} onClick={onRetry} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        {audio === 'on' ? 'Sound on' : 'Sound off'}
      </button>
    </div>
  )
}

// prettier-ignore
function Digits({ phase, count, context }: DigitsProps) {
  return (
    <>
      <p className="text-sm font-medium" data-testid="timer-phase">{phase}</p>
      <p className="text-6xl font-semibold tabular-nums" data-testid="timer-count">{count}</p>
      <p className="text-sm text-muted-foreground" data-testid="timer-context">{context}</p>
    </>
  )
}

function IdleForm({
  inputs,
  onStart,
}: {
  inputs: ReturnType<typeof useTimerInputs>
  onStart: () => void
}) {
  // prettier-ignore
  const rows = [
    ['timer-work', 'Work (sec)', WORK_MIN, 'work-input', inputs.workInput, inputs.setWorkInput],
    ['timer-rest', 'Rest (sec)', REST_MIN, 'rest-input', inputs.restInput, inputs.setRestInput],
    ['timer-rounds', 'Rounds', ROUNDS_MIN, 'rounds-input', inputs.roundsInput, inputs.setRoundsInput],
  ] as const
  // prettier-ignore
  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      {rows.map(([id, label, min, testId, value, set]) => (
        <Field key={id} orientation="horizontal">
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input id={id} type="number" min={min} inputMode="numeric" data-testid={testId} value={value} onChange={(e) => { set(e.target.value) }} className="w-24 text-right" />
        </Field>
      ))}
      <Button type="button" data-testid="start-button" onClick={onStart}>Start</Button>
    </div>
  )
}

function IdleView(
  p: AudioProps & DigitsProps & { inputs: ReturnType<typeof useTimerInputs>; onStart: () => void },
) {
  return (
    <>
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <Header
          className="flex w-full items-center justify-between"
          audio={p.audio}
          onRetry={p.onRetry}
        />
        <Digits phase={p.phase} count={p.count} context={p.context} />
      </div>
      <IdleForm inputs={p.inputs} onStart={p.onStart} />
    </>
  )
}

function primaryControl(state: TimerState, onPause: () => void, onResume: () => void) {
  if (state._tag === 'running') return { testId: 'pause-button', label: 'Pause', onClick: onPause }
  if (state._tag === 'paused')
    return { testId: 'resume-button', label: 'Resume', onClick: onResume }
  return null
}

function RunControls(p: {
  state: TimerState
  onPause: () => void
  onResume: () => void
  onReset: () => void
}) {
  const primary = primaryControl(p.state, p.onPause, p.onResume)
  // prettier-ignore
  return (
    <ControlDock maxTier="css">
      <div className="flex w-full items-center justify-center gap-3">
        {primary === null ? null : (
          <Button type="button" variant="secondary" data-testid={primary.testId} onClick={primary.onClick}>{primary.label}</Button>
        )}
        <Button type="button" variant="outline" data-testid="reset-button" onClick={p.onReset}>Reset</Button>
      </div>
    </ControlDock>
  )
}

// prettier-ignore
function RunningView(
  p: AudioProps & DigitsProps & {
    state: TimerState
    fraction: number
    playerPhase: PlayerPhase
    onPause: () => void
    onResume: () => void
    onReset: () => void
  },
) {
  return (
    <>
      <PhaseBackdrop phase={p.playerPhase} paused={p.state._tag === 'paused'} />
      <Header className="relative z-10 flex items-center justify-between px-5 pt-6" audio={p.audio} onRetry={p.onRetry} />
      {/* pointer-events-none so the absolute ControlDock below receives taps */}
      <div className="pointer-events-none relative z-10 flex flex-1 items-center justify-center px-5 pb-40">
        <div className="size-[min(290px,80vw)]">
          <ProgressRing fraction={p.fraction} phase={p.playerPhase} dirtyValue={p.count}>
            <Digits phase={p.phase} count={p.count} context={p.context} />
          </ProgressRing>
        </div>
      </div>
      <div className="relative z-20">
        <RunControls state={p.state} onPause={p.onPause} onResume={p.onResume} onReset={p.onReset} />
      </div>
    </>
  )
}

/** `/timer` — Field-kit idle form; immersive backdrop + ring + dock while running. */
export function TimerScreen() {
  const inputs = useTimerInputs()
  const timer = useManualTimer()
  const [, refreshAudio] = useReducer((n: number) => n + 1, 0)
  const audio = Audio.audioState()
  const isIdle = timer.state._tag === 'idle'
  useWakeLock(timer.state._tag === 'running')
  const armAudio = (): void => {
    Audio.unlockAudio()
    refreshAudio()
  }
  const vm = viewModel(timer, isIdle ? inputs.readSettings() : timer.session)
  const shell = isIdle
    ? 'relative flex min-h-svh flex-col items-center gap-6 p-6'
    : // dvh, not svh: the immersive shell (and the dock anchored to its
      // bottom) must track iOS Safari's toolbar as it expands/collapses.
      'relative flex min-h-dvh flex-col overflow-hidden'
  return (
    <div className={shell} data-testid="timer-screen">
      {isIdle ? (
        <IdleView
          {...vm}
          audio={audio}
          onRetry={armAudio}
          inputs={inputs}
          onStart={() => {
            armAudio()
            timer.startTimer(inputs.readSettings())
          }}
        />
      ) : (
        <RunningView
          {...vm}
          state={timer.state}
          audio={audio}
          onRetry={armAudio}
          onPause={timer.pauseTimer}
          onResume={timer.resumeTimer}
          onReset={timer.resetTimer}
        />
      )}
    </div>
  )
}
