import type { CellState, ProgressBar, ProgressStrip as StripModel } from '@/lib/session'
import { STRIP_BUDGET } from '@/lib/session'
import { cn } from '@/lib/utils'

/**
 * The three states as a fill, shared by the bars, their cells and the dots.
 * Nothing here fills part-way: a mark is done, now (`active`) or ahead
 * (`upcoming`), and never anything between.
 */
const FILL: Record<CellState, string> = {
  done: 'bg-primary/50',
  active: 'bg-primary',
  upcoming: 'bg-input/60',
}

/**
 * One bar — a group of works, never a **Segment**.
 *
 * A bar with cells shows them: the cells carry the reading, and the bar is
 * their track. A bar that gave its cells up to the width budget fills with
 * its own state instead, and says nothing about the station. Either way the
 * bar itself reports done, now or ahead.
 *
 * `startsPodRun` opens a new pod's run on a `sets` workout. It takes a wider
 * leading gap, so the pod boundary stays visible without a second tier.
 *
 * The two gaps come from `STRIP_BUDGET`, not from a spacing class, because
 * the cell collapse subtracts these very pixels before it divides. A class
 * here and a number there would drift, and the drift shows up as a bar the
 * derivation calls wide enough and the screen draws under the floor.
 *
 * The position of a cell is its identity: a cell is the nth station of this
 * bar, and one compiled plan never reorders them. `Array.from` says that, and
 * the repo's lint refuses an index key on `.map`.
 */
function Bar({ bar, index }: { readonly bar: ProgressBar; readonly index: number }) {
  return (
    <div
      data-testid={`session-strip-bar-${index}`}
      data-state={bar.state}
      // `min-w-0` with `flex-1` is what lets the bars shrink to fit instead of
      // wrapping, however many the workout has.
      className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
      style={{
        gap: `${STRIP_BUDGET.cellGapPx}px`,
        marginLeft: bar.startsPodRun ? `${STRIP_BUDGET.podRunGapPx}px` : undefined,
      }}
    >
      {bar.cells.length === 0 ? (
        <span className={cn('flex-1', FILL[bar.state])} />
      ) : (
        Array.from(bar.cells, (state, cell) => (
          <span
            key={cell}
            data-testid={`session-strip-cell-${index}-${cell}`}
            data-state={state}
            className={cn('min-w-0 flex-1', FILL[state])}
          />
        ))
      )}
    </div>
  )
}

/**
 * The Progress strip: one bar per group above a fixed row of one dot per
 * round.
 *
 * The bars never wrap and the dots do, so the strip keeps one height for the
 * whole of one workout, and the dot row never moves under the active bar.
 * Every dot keeps one size for the same reason — the running round is told by
 * its fill and its ping, which do not change the height of the row.
 *
 * The strip takes no taps. Seeking needs a session command of its own, and a
 * participant who holds a weight must not move the timer by accident.
 *
 * Every rule behind the states lives in `progressStrip`. This draws what it
 * is given and decides nothing.
 */
export function ProgressStrip({
  strip,
  barsWidth,
}: {
  readonly strip: StripModel
  /**
   * What the bar row is drawn to, as a CSS length. The live screen passes the
   * inner span of the **Progress arc**, so the bars start and end under the
   * inside of the arc's stroke and the two read as one column.
   *
   * The dots are not held to it. They wrap, and a round count that needed a
   * second line would take one sooner in a narrower row for no reading gain.
   *
   * Left out, the row takes the whole strip. `STRIP_BUDGET.stripWidthPx` is
   * the floor the cell collapse divides, and it follows the live screen's
   * width: a caller that draws the bars narrower than that must move it too.
   */
  readonly barsWidth?: string
}) {
  return (
    <div
      // `max-w-sm` is the width the top strip and the centre stack already
      // keep, so the strip lines up with them.
      className="pointer-events-none flex w-full max-w-sm flex-col items-center gap-2"
      data-testid="session-progress"
    >
      <div
        // The gap between the bars is the budget's, for the same reason the
        // gaps inside a bar are: the collapse spends it before it divides.
        className="flex w-full flex-nowrap items-center"
        style={{ gap: `${STRIP_BUDGET.barGapPx}px`, width: barsWidth, maxWidth: '100%' }}
        data-testid="session-strip-bars"
      >
        {strip.bars.map((bar, index) => (
          <Bar key={bar.key} bar={bar} index={index} />
        ))}
      </div>
      <div
        className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2"
        data-testid="session-strip-dots"
      >
        {Array.from(strip.dots, (state, round) => (
          <span
            key={round}
            data-testid={`session-strip-dot-${round}`}
            data-state={state}
            className={cn(
              'size-2.5 rounded-full',
              state === 'active' && 'player-dot-pulse',
              FILL[state],
            )}
          />
        ))}
      </div>
    </div>
  )
}
