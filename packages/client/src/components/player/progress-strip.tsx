import type { CellState, ProgressStrip as StripModel, StripPod } from '@/lib/session'
import { podDotsWidthPx, runState, STRIP_BUDGET } from '@/lib/session'
import { cn } from '@/lib/utils'

/**
 * The three states as a fill, shared by every mark: the dots, the cells and
 * the pills. Nothing here fills part-way: a mark is done, now (`active`) or
 * ahead (`upcoming`), and never anything between.
 *
 * The change between two states eases over `--duration-state`, but the
 * states themselves stay three, and the ease is a colour crossing, not a
 * part-way fill.
 */
const FILL: Record<CellState, string> = {
  done: 'bg-primary/50',
  active: 'bg-primary',
  upcoming: 'bg-input/60',
}

/**
 * The same three states for the hairline track under an open pod's dots.
 *
 * The track carries the pod's own reading at a lower alpha than the dots on
 * it. It has to stay under the dots: the dots hold the reading, and a track
 * as strong as them would compete with the mark that moves.
 */
const TRACK_FILL: Record<CellState, string> = {
  done: 'bg-primary/25',
  active: 'bg-primary/50',
  upcoming: 'bg-input/30',
}

/**
 * One height for the whole session: the dot cap, the gap under it, and the
 * track. Every pod takes this height, whatever the layout, the mode or the
 * dot size, so nothing under the strip moves as the session runs.
 *
 * A dot smaller than the cap is centred in the dot band; it does not shrink
 * the band.
 */
const STRIP_HEIGHT_PX = STRIP_BUDGET.dotCapPx + STRIP_BUDGET.trackGapPx + STRIP_BUDGET.trackPx

/** The colour crossing every mark shares. */
const STATE_EASE = 'transition-colors duration-[var(--duration-state)] ease-[var(--ease-out)]'

/**
 * One run of a pod: one dot per work, the dots the only mark that counts
 * work.
 *
 * Only a dot pulses, and only the one that is now. A participant looks up
 * once mid-work, and the moving mark has to be the smallest one — the work
 * they are in.
 *
 * The gap between two dots comes from `STRIP_BUDGET`, not from a spacing
 * class, because the derivation subtracts these very pixels before it
 * divides. A class here and a number there would drift, and the drift shows
 * up as a dot the derivation calls big enough that the screen draws under the
 * floor.
 *
 * The position of a mark is its identity: a dot is the nth work of this pod,
 * and one compiled plan never reorders them. `Array.from` says that, and the
 * repo's lint refuses an index key on `.map`.
 */
function RunDots({
  run,
  podIndex,
  firstOrdinal,
  dotSizePx,
}: {
  readonly run: readonly CellState[]
  readonly podIndex: number
  /** The ordinal of this run's first work, counted across the whole pod. */
  readonly firstOrdinal: number
  readonly dotSizePx: number
}) {
  return (
    <div className="flex items-center" style={{ gap: `${STRIP_BUDGET.dotGapPx}px` }}>
      {Array.from(run, (state, work) => (
        <span
          key={work}
          data-testid={`session-strip-work-${podIndex}-${firstOrdinal + work}`}
          data-state={state}
          className={cn(
            'shrink-0 rounded-full',
            STATE_EASE,
            state === 'active' && 'player-dot-pulse',
            FILL[state],
          )}
          style={{ width: `${dotSizePx}px`, height: `${dotSizePx}px` }}
        />
      ))}
    </div>
  )
}

/**
 * A pod drawn as dots: its runs in order, then the track under them.
 *
 * A run is a gap and nothing else. Runs are told apart by the wider space
 * between them, never by ink, so the dot stays the only mark that counts
 * work. The bar under them is the pod: a hairline track, which says where one
 * pod starts and the next one ends without a second tier of marks.
 */
function DotsPod({
  pod,
  index,
  dotSizePx,
}: {
  readonly pod: StripPod
  readonly index: number
  readonly dotSizePx: number
}) {
  // The ordinal counts works across the pod's runs, in run order, so a work
  // keeps one name whatever run it falls in. `firstOrdinals[n]` is where run
  // `n` starts.
  const firstOrdinals: number[] = []
  let ordinal = 0
  for (const run of pod.runs) {
    firstOrdinals.push(ordinal)
    ordinal += run.length
  }
  return (
    <>
      <div
        className="flex items-center"
        style={{ height: `${STRIP_BUDGET.dotCapPx}px`, gap: `${STRIP_BUDGET.runGapPx}px` }}
      >
        {Array.from(pod.runs, (run, runIndex) => (
          <RunDots
            key={runIndex}
            run={run}
            podIndex={index}
            firstOrdinal={firstOrdinals[runIndex] ?? 0}
            dotSizePx={dotSizePx}
          />
        ))}
      </div>
      <span
        className={cn('w-full rounded-full', STATE_EASE, TRACK_FILL[pod.state])}
        style={{
          height: `${STRIP_BUDGET.trackPx}px`,
          marginTop: `${STRIP_BUDGET.trackGapPx}px`,
        }}
      />
    </>
  )
}

/**
 * A pod drawn as cells: one cell per run on a single bar.
 *
 * This is the last honest rendering before plain. The pod's dots would fall
 * under the floor, so the runs speak for their works: a cell reads now if the
 * current work is inside it, done when every work in it is done, and ahead
 * otherwise. `runState` decides that, so this states no rule of its own.
 *
 * A cell never pulses. The mark that pulses is the work, and a cell is a run.
 *
 * The cells are split by the dot gap — the one gap inside a pod that is not a
 * run gap — so the bar still reads as one bar and not as loose parts.
 */
function CellsPod({ pod, index }: { readonly pod: StripPod; readonly index: number }) {
  return (
    <div
      className="flex w-full overflow-hidden rounded-full"
      style={{ height: `${STRIP_BUDGET.dotCapPx}px`, gap: `${STRIP_BUDGET.dotGapPx}px` }}
    >
      {Array.from(pod.runs, (run, runIndex) => {
        const state = runState(run)
        return (
          <span
            key={runIndex}
            data-testid={`session-strip-cell-${index}-${runIndex}`}
            data-state={state}
            className={cn('min-w-0 flex-1', STATE_EASE, FILL[state])}
          />
        )
      })}
    </div>
  )
}

/**
 * A pod drawn as a pill: closed, carrying the pod's own state and nothing
 * about the works inside it.
 *
 * The pill is a fixed width, never proportional to the pod's work count. The
 * pill counts pods; the arc and the digits count time. A pill that grew with
 * the works would claim a reading it gave up.
 */
function PillPod({ pod }: { readonly pod: StripPod }) {
  return (
    <span
      className={cn('w-full rounded-full', STATE_EASE, FILL[pod.state])}
      style={{ height: `${STRIP_BUDGET.dotCapPx}px` }}
    />
  )
}

/**
 * One pod of the strip, in the mode the derivation chose for it.
 *
 * Every pod takes the strip's one height. A `dots` pod fills it top-down —
 * the dot band, then the track. A `cells` pod and a `pill` pod hold one bar,
 * centred in the same height, so the row keeps one middle line whatever the
 * modes on it are.
 *
 * The width is stated for `dots` and `pill`, and left to the row for `cells`.
 * A `cells` pod is the open pod that could not afford its dots, so it takes
 * whatever the pills beside it leave, which is the width the derivation
 * divided when it chose the mode.
 */
function StripPodView({
  pod,
  index,
  dotSizePx,
}: {
  readonly pod: StripPod
  readonly index: number
  readonly dotSizePx: number
}) {
  const dots = pod.mode === 'dots'
  // A `cells` pod states no width: it takes its share of the row.
  let width: string | undefined
  if (dots) {
    width = `${podDotsWidthPx(pod, dotSizePx)}px`
  } else if (pod.mode === 'pill') {
    width = `${STRIP_BUDGET.pillWidthPx}px`
  }
  return (
    <div
      data-testid={`session-strip-pod-${index}`}
      data-state={pod.state}
      data-mode={pod.mode}
      // `player-strip-pod` eases the width. At a pod boundary the open pod
      // moves on, and the widths on either side of it change; the ease is
      // what makes that a move and not a jump. Reduced motion cuts it.
      className={cn(
        'player-strip-pod flex shrink-0 flex-col',
        dots ? 'justify-start' : 'justify-center',
        pod.mode === 'cells' && 'min-w-0 flex-1 shrink',
      )}
      style={{ height: `${STRIP_HEIGHT_PX}px`, width }}
    >
      {dots && <DotsPod pod={pod} index={index} dotSizePx={dotSizePx} />}
      {pod.mode === 'cells' && <CellsPod pod={pod} index={index} />}
      {pod.mode === 'pill' && <PillPod pod={pod} />}
    </div>
  )
}

/**
 * The Progress strip: one dot per work, one bar per pod, one gap per run, on
 * a single row that never wraps.
 *
 * The row holds one height for the whole session, so nothing under it moves
 * as the session runs. A strip whose dots reached the cap is narrower than
 * the width it is given, and it sits centred under the arc rather than
 * stretching to fill it.
 *
 * The strip takes no taps. Seeking needs a session command of its own, and a
 * participant who holds a weight must not move the timer by accident.
 *
 * Every rule behind the layout, the modes and the states lives in
 * `progressStrip`. This draws what it is given and decides nothing.
 */
export function ProgressStrip({
  strip,
  width,
}: {
  readonly strip: StripModel
  /**
   * What the row is drawn to, as a CSS length. The live screen passes the
   * inner span of the **Progress arc**, so the strip starts and ends under
   * the inside of the arc's stroke and the two read as one column.
   *
   * Left out, the row takes the whole strip. `STRIP_BUDGET.stripWidthPx` is
   * the width the derivation divides, and it follows the live screen's: a
   * caller that draws the strip narrower than that must move it too.
   */
  readonly width?: string
}) {
  return (
    <div
      // `max-w-sm` is the width the top strip and the centre stack already
      // keep, so the strip lines up with them.
      className="pointer-events-none flex w-full max-w-sm flex-col items-center"
      data-testid="session-progress"
      data-layout={strip.layout}
    >
      <div
        // The gap between two pods is the budget's, for the same reason the
        // gaps inside a pod are: the derivation spends it before it divides.
        // `justify-center` is what centres a strip that came out narrower
        // than the row it is drawn in.
        className="flex flex-nowrap items-start justify-center"
        style={{
          gap: `${STRIP_BUDGET.podGapPx}px`,
          height: `${STRIP_HEIGHT_PX}px`,
          width,
          maxWidth: '100%',
        }}
      >
        {strip.pods.map((pod, index) => (
          <StripPodView key={pod.key} pod={pod} index={index} dotSizePx={strip.dotSizePx} />
        ))}
      </div>
    </div>
  )
}
