import { useReducer } from 'react'

import type { Participant, SessionCommand, SessionState, WorkContext } from '@j45/domain'
import { LogOut, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'

import { ControlDock } from '@/components/player/control-dock'
import type { PlayerPhase } from '@/components/player/phase'
import { PHASE_HUE } from '@/components/player/phase'
import { ProgressRing } from '@/components/player/progress-ring'
import { RollingDigits } from '@/components/player/rolling-digits'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  nextWorkStationName,
  phaseLabel,
  ringFraction,
  timerUrgency,
  type TimerUrgency,
} from '@/lib/session'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/workouts'
import { audioState, unlockAudio } from '@/player/audio'

/** Fire a session command (pause/resume/prev/skip); any participant may drive. */
export type Dispatch = (command: SessionCommand) => void
/** Leave the session — the only exit, via `LeaveSession`. */
export type Leave = () => void

/** The tiny uppercase eyebrow label shared by the chrome (Live / Next up / …). */
const EYEBROW = 'text-[10px] font-medium tracking-wide text-muted-foreground uppercase'

/** Urgency tier (or none) → the `--digit-color` the glyph sheen gradient is built from. */
const URGENCY_DIGIT_COLOR: Record<TimerUrgency | 'none', string> = {
  none: '[--digit-color:var(--foreground)]',
  warn: '[--digit-color:var(--timer-warn)]',
  critical: '[--digit-color:var(--timer-critical)]',
}

/**
 * The immersive centrepiece: the phase-tinted progress ring wrapping the huge
 * tabular-nums countdown and its phase eyebrow, with the exercise name (plus
 * its optional `detail`, e.g. "10 cal") beneath. The ring depletes from the
 * same interpolated `remainingMillis` the digits show, so a pause freezes
 * both. The ring diameter is clamped by both viewport axes so the whole stack
 * fits on-screen without scrolling.
 *
 * The digits take about 28% of the ring box. Each of their three clamp terms
 * is 28% of the box's matching term, so the digits stay clamped by both
 * viewport axes, as before. 28% is what the ring allows: the widest count the
 * formatter can make (`12:00`) still clears the arc, and 30% touches it. No
 * term falls below the old one, so no screen gets smaller digits. What rises
 * most is the ceiling, which held the digits at 20% of a large box.
 *
 * Pod, round and station are not written here. The Progress strip below
 * carries them as marks, which a participant reads more quickly than words.
 */
export function CenterStack({
  state,
  phase,
  ctx,
  count,
}: {
  readonly state: SessionState
  readonly phase: PlayerPhase
  readonly ctx: WorkContext | undefined
  readonly count: number
}) {
  const digits = formatDuration(count)
  const fraction = ringFraction(state, count)
  const urgency = timerUrgency(phase, count)
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-2">
      <div className="size-[min(76vw,34svh,320px)] [&>*]:size-full">
        <ProgressRing fraction={fraction} phase={phase} dirtyValue={digits}>
          <span
            data-testid="session-phase"
            className="inline-flex items-center gap-2 text-xs font-medium tracking-wide uppercase"
            style={{ color: PHASE_HUE[phase] }}
          >
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: PHASE_HUE[phase] }}
              aria-hidden="true"
            />
            {phaseLabel(state)}
          </span>
          <span
            data-testid="session-count"
            data-ring-digits=""
            data-urgency={urgency}
            className={cn(
              'player-digits mt-1 inline-flex text-[min(21.3vw,9.6svh,89px)] leading-none font-semibold tabular-nums',
              URGENCY_DIGIT_COLOR[urgency ?? 'none'],
            )}
          >
            <RollingDigits value={digits} />
          </span>
        </ProgressRing>
      </div>
      <WorkMeta ctx={ctx} />
    </div>
  )
}

/** The exercise name and its optional `detail` (e.g. "10 cal"). */
function WorkMeta({ ctx }: { readonly ctx: WorkContext | undefined }) {
  return (
    <div className="flex flex-col items-center gap-0.5 text-center">
      <p className="font-heading text-xl font-bold" data-testid="session-exercise-name">
        {ctx?.station.name ?? '—'}
      </p>
      {ctx?.station.detail !== undefined && (
        <p className="text-xs text-muted-foreground" data-testid="session-exercise-detail">
          {ctx.station.detail}
        </p>
      )}
    </div>
  )
}

/** The joined participants, host included, as avatar-initial pills. */
export function Participants({ participants }: { readonly participants: readonly Participant[] }) {
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-2"
      data-testid="session-participants"
    >
      {participants.map((participant) => (
        <span
          key={participant.userId}
          data-testid={`session-participant-${participant.userId}`}
          className="inline-flex items-center gap-1.5 rounded-full bg-foreground/5 py-0.5 pr-2.5 pl-0.5 text-xs text-foreground/80 ring-1 ring-border"
        >
          <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
            {participant.displayName.charAt(0)}
          </span>
          {participant.displayName}
        </span>
      ))}
    </div>
  )
}

/** A round icon control — the >=64px `primary` (Pause·Resume) or a >=48px side. */
function RoundButton({
  testId,
  label,
  icon: Icon,
  onClick,
  primary = false,
}: {
  readonly testId: string
  readonly label: string
  readonly icon: typeof Pause
  readonly onClick: () => void
  readonly primary?: boolean
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex items-center justify-center rounded-full',
        primary
          ? 'size-16 bg-primary text-primary-foreground shadow-[0_10px_40px_-8px_var(--primary)]'
          : 'size-12 bg-foreground/5 text-foreground/70 ring-1 ring-border',
      )}
    >
      <Icon className={primary ? 'size-7' : 'size-5'} />
    </button>
  )
}

/** Prev, the Pause/Resume primary (>=64px), and Skip — the timer-driving row. */
function RunControls({
  state,
  dispatch,
}: {
  readonly state: SessionState
  readonly dispatch: Dispatch
}) {
  const paused = state.timer._tag === 'paused'
  return (
    <>
      <RoundButton
        testId="session-prev"
        label="Previous"
        icon={SkipBack}
        onClick={() => dispatch('prev')}
      />
      <RoundButton
        testId={paused ? 'session-resume' : 'session-pause'}
        label={paused ? 'Resume' : 'Pause'}
        icon={paused ? Play : Pause}
        onClick={() => dispatch(paused ? 'resume' : 'pause')}
        primary
      />
      <RoundButton
        testId="session-skip"
        label="Skip"
        icon={SkipForward}
        onClick={() => dispatch('skip')}
      />
    </>
  )
}

/**
 * The mid-workout Leave: a distinct rose-tinted top-left control that opens an
 * `alert-dialog` confirm. `LeaveSession` fires only from the confirm — the bare
 * tap opens the dialog and nothing else.
 */
function LeaveDialog({ onLeave }: { readonly onLeave: Leave }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        data-testid="session-leave"
        aria-label="Leave workout"
        className="flex size-11 items-center justify-center rounded-full bg-destructive/15 text-destructive ring-1 ring-destructive/30"
      >
        <LogOut className="size-5" />
      </AlertDialogTrigger>
      <AlertDialogContent data-testid="session-leave-dialog" size="sm">
        <AlertDialogTitle>Leave workout?</AlertDialogTitle>
        <AlertDialogDescription>Your progress is saved to history.</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="session-leave-cancel" size="sm">
            Stay
          </AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            size="sm"
            data-testid="session-leave-confirm"
            onClick={onLeave}
          >
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The muted/sound indicator — tappable to retry the audio unlock — carrying `data-audio`. */
function AudioIndicator() {
  const [, refresh] = useReducer((n: number) => n + 1, 0)
  const audio = audioState()
  return (
    <button
      type="button"
      data-testid="session-audio-indicator"
      data-audio={audio}
      aria-label={audio === 'on' ? 'Sound on' : 'Sound off'}
      onClick={() => {
        unlockAudio()
        refresh()
      }}
      className="flex size-11 items-center justify-center rounded-full text-muted-foreground"
    >
      {audio === 'on' ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
    </button>
  )
}

/** The top chrome: rose Leave (left), LIVE eyebrow + workout name (center), audio (right). */
export function TopStrip({
  workoutName,
  showLeave,
  onLeave,
}: {
  readonly workoutName: string
  readonly showLeave: boolean
  readonly onLeave: Leave
}) {
  return (
    <div className="flex w-full max-w-sm items-center justify-between">
      {showLeave ? (
        <LeaveDialog onLeave={onLeave} />
      ) : (
        <span className="size-11" aria-hidden="true" />
      )}
      <div className="text-center">
        <p className={EYEBROW}>Live</p>
        <p className="font-heading text-sm font-bold tracking-tight">{workoutName}</p>
      </div>
      <AudioIndicator />
    </div>
  )
}

/**
 * The bottom glass dock. While the timer runs it carries the NEXT UP line and
 * Prev / Pause·Resume / Skip; when done it carries a single Finish button that
 * calls `LeaveSession` directly — no confirm, since a completed workout loses
 * nothing. Runs at the full refract glass tier so the dock genuinely refracts
 * the phase-tinted backdrop behind it (not the CSS-only frost).
 */
export function SessionDock({
  state,
  dispatch,
  onLeave,
}: {
  readonly state: SessionState
  readonly dispatch: Dispatch
  readonly onLeave: Leave
}) {
  if (state.timer._tag === 'done') {
    return (
      <ControlDock info={<span className={EYEBROW}>Workout complete</span>}>
        <Button
          type="button"
          data-testid="session-finish"
          className="w-full"
          size="lg"
          onClick={onLeave}
        >
          Finish
        </Button>
      </ControlDock>
    )
  }
  return (
    <ControlDock
      info={
        <>
          <span className={cn(EYEBROW, 'shrink-0')}>Next up</span>
          <span
            className="ml-3 min-w-0 truncate text-sm font-semibold text-foreground/85"
            data-testid="session-next-up"
          >
            {nextWorkStationName(state) ?? '—'}
          </span>
        </>
      }
    >
      <RunControls state={state} dispatch={dispatch} />
    </ControlDock>
  )
}
