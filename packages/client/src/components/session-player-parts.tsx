import { useReducer } from 'react'

import type { Participant, SessionCommand, SessionState, WorkContext } from '@j45/domain'
import { LogOut, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'

import { ArcBox } from '@/components/player/arc-box'
import { ControlDock } from '@/components/player/control-dock'
import { MarqueeText } from '@/components/player/marquee-text'
import type { PlayerPhase } from '@/components/player/phase'
import { PHASE_HUE } from '@/components/player/phase'
import { ARC_INNER_SHARE, ProgressArc } from '@/components/player/progress-arc'
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
import { arcFraction, nextWorkStationName, timerUrgency, type TimerUrgency } from '@/lib/session'
import { cn } from '@/lib/utils'
import { audioState, unlockAudio } from '@/player/audio'
import { countdownTypeScale, formatCountdown } from '@/player/countdown-format'

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

/** What the live session's arc takes when the centre column has the height for it. */
const ARC_WIDTH = 'min(92vw, 420px)'

/**
 * The span between the inner edges of the arc's stroke. The **Progress strip**
 * draws its bars to this, so the bars and the arc read as one column rather
 * than two widths that nearly agree.
 */
export const ARC_INNER_WIDTH = `calc(${ARC_WIDTH} * ${ARC_INNER_SHARE})`

/**
 * The immersive centrepiece: the phase-tinted Progress arc with the huge
 * tabular-nums countdown on the arc's chord, and the exercise name (plus its
 * optional `detail`, e.g. "10 cal") beneath. The arc depletes from the same
 * interpolated `remainingMillis` the digits show, so a pause freezes both.
 *
 * The phase word is not written here. It belongs to the {@link TopStrip},
 * under the workout name: the two together say which workout is running and
 * where in it, and the centrepiece is left to the count alone.
 *
 * Pod, round and station are not written here either. The Progress strip below
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
  const digits = formatCountdown(count)
  const fraction = arcFraction(state, count)
  const urgency = timerUrgency(phase, count)
  return (
    <div className="flex min-h-0 w-full max-w-sm flex-col items-center gap-2">
      <ArcBox width={ARC_WIDTH} countSize={countdownTypeScale(digits)}>
        <ProgressArc fraction={fraction} phase={phase} dirtyValue={digits}>
          <span
            data-testid="session-count"
            data-arc-digits=""
            data-urgency={urgency}
            className={cn(
              'player-digits inline-flex text-[length:var(--count-size)] leading-none font-semibold tabular-nums',
              URGENCY_DIGIT_COLOR[urgency ?? 'none'],
            )}
          >
            <RollingDigits value={digits} />
          </span>
        </ProgressArc>
      </ArcBox>
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

/**
 * A round icon control — the >=64px `primary` (Pause·Resume) or a >=48px
 * side. `disabled` is how a timer command stands down while the connection is
 * away: a participant cannot drive a timer they cannot reach, and a control
 * that looked available would be tapped and do nothing.
 */
function RoundButton({
  testId,
  label,
  icon: Icon,
  onClick,
  primary = false,
  disabled = false,
}: {
  readonly testId: string
  readonly label: string
  readonly icon: typeof Pause
  readonly onClick: () => void
  readonly primary?: boolean
  readonly disabled?: boolean
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center justify-center rounded-full disabled:opacity-40',
        primary
          ? 'player-press-lg size-16 bg-primary text-primary-foreground shadow-[0_10px_40px_-8px_var(--primary)]'
          : 'player-press size-12 bg-foreground/5 text-foreground/70 ring-1 ring-border',
      )}
    >
      <Icon className={primary ? 'size-7' : 'size-5'} />
    </button>
  )
}

/** Prev, the Pause/Resume primary (>=64px), and Skip — the timer-driving row. */
function RunControls({
  state,
  offline,
  dispatch,
}: {
  readonly state: SessionState
  readonly offline: boolean
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
        disabled={offline}
      />
      <RoundButton
        testId={paused ? 'session-resume' : 'session-pause'}
        label={paused ? 'Resume' : 'Pause'}
        icon={paused ? Play : Pause}
        onClick={() => dispatch(paused ? 'resume' : 'pause')}
        primary
        disabled={offline}
      />
      <RoundButton
        testId="session-skip"
        label="Skip"
        icon={SkipForward}
        onClick={() => dispatch('skip')}
        disabled={offline}
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
        className="player-press flex size-11 items-center justify-center rounded-full bg-destructive/15 text-destructive ring-1 ring-destructive/30"
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
      className="player-press flex size-11 items-center justify-center rounded-full text-muted-foreground"
    >
      {audio === 'on' ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
    </button>
  )
}

/**
 * The notice that the connection is being retried, sitting under the top
 * strip on the same layout the workout already occupies.
 *
 * It is part of the layout and not a toast. A toast is built to appear and
 * dismiss itself, where a connection state persists and must clear the moment
 * the connection returns; and a toast can be pushed off screen by a plan
 * change arriving at the same time.
 *
 * It is read mid-exercise from arm's length, so it is sized to be legible
 * without stopping — and kept small enough that it never covers the count or
 * the station name.
 */
export function ReconnectingChip() {
  return (
    <div
      data-testid="session-reconnecting"
      role="status"
      className="inline-flex shrink-0 items-center gap-2 rounded-full bg-foreground/10 px-3 py-1 text-sm font-medium text-foreground/80 ring-1 ring-border"
    >
      <span className="size-2 animate-pulse rounded-full bg-destructive" aria-hidden="true" />
      Reconnecting…
    </div>
  )
}

/**
 * The top chrome: rose Leave (left), LIVE eyebrow + workout name + the phase
 * word (center), audio (right).
 *
 * The connection eyebrow reads `Offline` while the connection is away, because
 * a screen that kept saying `Live` would be telling the participant something
 * false. It is too quiet to carry the news on its own, which is what the
 * {@link ReconnectingChip} is for.
 *
 * The phase word sits under the workout name because the two answer one
 * question between them — which workout, and where in it. It carries no dot.
 * The word is already tinted by phase, so a dot in the same hue repeated the
 * only thing it could have said.
 */
export function TopStrip({
  workoutName,
  phase,
  phaseText,
  offline,
  showLeave,
  onLeave,
}: {
  readonly workoutName: string
  readonly phase: PlayerPhase
  /** The phase as a word — `Work`, `Rest`, `Paused`, `Done`. */
  readonly phaseText: string
  readonly offline: boolean
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
        <p className={EYEBROW} data-testid="session-connection">
          {offline ? 'Offline' : 'Live'}
        </p>
        <p className="font-heading text-sm font-bold tracking-tight">{workoutName}</p>
        <p
          data-testid="session-phase"
          className="text-xs font-medium tracking-wide uppercase"
          style={{ color: PHASE_HUE[phase] }}
        >
          {phaseText}
        </p>
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
  offline,
  dispatch,
  onLeave,
}: {
  readonly state: SessionState
  readonly offline: boolean
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
          <MarqueeText
            className="ml-3 text-sm font-semibold text-foreground/85"
            data-testid="session-next-up"
          >
            {nextWorkStationName(state) ?? '—'}
          </MarqueeText>
        </>
      }
    >
      <RunControls state={state} offline={offline} dispatch={dispatch} />
    </ControlDock>
  )
}
