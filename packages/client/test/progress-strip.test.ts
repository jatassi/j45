// @vitest-environment jsdom
//
// The derivation itself is pure and touches no dom. The environment is for
// the module it lives in: `@/lib/session` also holds the session's atoms, and
// the rpc client they build reads `location` at import time.
import { compile, Flow, Pod, Round, Station, Workout, type FlowType } from '@j45/domain'
import { describe, expect, it } from 'vitest'

import {
  progressStrip,
  STRIP_BUDGET,
  type CellState,
  type ProgressStrip,
  type StripBudget,
} from '@/lib/session'

/**
 * A compiled plan from a shape: pods named by their station lists, one flow,
 * and `rounds` equal rounds. Timing is irrelevant here — the strip reads
 * structure and ordinals only.
 */
const planOf = (flow: FlowType, pods: readonly (readonly string[])[], rounds: number) =>
  compile(
    new Workout({
      name: 'Strip',
      focus: 'strength',
      pods: pods.map(
        (stations, index) =>
          new Pod({
            name: `Pod ${index + 1}`,
            stations: stations.map((name) => new Station({ name })) as [Station, ...Station[]],
          }),
      ) as [Pod, ...Pod[]],
      flow: new Flow({
        type: flow,
        rounds: Array.from(
          { length: rounds },
          () => new Round({ workSeconds: 20, restSeconds: 10 }),
        ) as [Round, ...Round[]],
      }),
    }),
  )

const names = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`)

/**
 * Two pods of unequal size — Alpha holds three stations, Bravo one. The
 * uneven shape is what makes the two groupings tell themselves apart, and
 * Bravo is the single-station pod.
 */
const unevenPods = [['Push', 'Pull', 'Squat'], ['Row']] as const

/** Every state the strip may report, so a test can prove no fourth value leaks. */
const STATES: readonly CellState[] = ['done', 'active', 'upcoming']

describe('progressStrip — grouping', () => {
  it('yields one bar per pod on `laps`, each carrying one cell per station', () => {
    const strip = progressStrip(planOf('laps', unevenPods, 2), undefined)
    expect(strip.bars.map((bar) => bar.key)).toEqual(['pod-0', 'pod-1'])
    expect(strip.bars.map((bar) => bar.cells.length)).toEqual([3, 1])
  })

  it('yields one bar per station on `sets`, in the order the stations run', () => {
    const strip = progressStrip(planOf('sets', unevenPods, 2), undefined)
    expect(strip.bars.map((bar) => bar.key)).toEqual([
      'pod-0-station-1',
      'pod-0-station-2',
      'pod-0-station-3',
      'pod-1-station-1',
    ])
    // A station is a group of one station, so its bar holds one cell. No
    // branch makes this true — the rule "one cell per station in the group"
    // does.
    expect(strip.bars.map((bar) => bar.cells.length)).toEqual([1, 1, 1, 1])
  })

  it('marks the pod boundary on a multi-pod `sets` workout, and never the first bar', () => {
    const strip = progressStrip(planOf('sets', unevenPods, 2), undefined)
    expect(strip.bars.map((bar) => bar.startsPodRun)).toEqual([false, false, false, true])
  })

  it('gives a one-pod `sets` workout plain one-cell bars and no pod boundary', () => {
    const strip = progressStrip(planOf('sets', [['Push', 'Pull']], 2), undefined)
    expect(strip.bars.map((bar) => bar.cells.length)).toEqual([1, 1])
    expect(strip.bars.map((bar) => bar.startsPodRun)).toEqual([false, false])
  })

  it('marks no boundary on `laps`, where the pod boundary is already the bar boundary', () => {
    const strip = progressStrip(planOf('laps', unevenPods, 2), undefined)
    expect(strip.bars.map((bar) => bar.startsPodRun)).toEqual([false, false])
  })

  it('groups a single-station pod by the stated flow, not by the order of the works', () => {
    // Every pod holds one station, so `laps` and `sets` compile to the very
    // same segment order. The grouping must still follow the stated flow.
    const pods = [['Push'], ['Pull']]
    expect(progressStrip(planOf('laps', pods, 3), undefined).bars.map((bar) => bar.key)).toEqual([
      'pod-0',
      'pod-1',
    ])
    expect(progressStrip(planOf('sets', pods, 3), undefined).bars.map((bar) => bar.key)).toEqual([
      'pod-0-station-1',
      'pod-1-station-1',
    ])
  })

  it('groups a single-round flow by the stated flow, not by the order of the works', () => {
    // One round: pod-major and station-major traversal are the same order.
    const pods = [
      ['Push', 'Pull'],
      ['Row', 'Press'],
    ]
    const laps = progressStrip(planOf('laps', pods, 1), undefined)
    const sets = progressStrip(planOf('sets', pods, 1), undefined)
    expect(laps.bars.map((bar) => bar.cells.length)).toEqual([2, 2])
    expect(sets.bars.map((bar) => bar.cells.length)).toEqual([1, 1, 1, 1])
    expect(laps.dots).toHaveLength(1)
    expect(sets.dots).toHaveLength(1)
  })
})

describe('progressStrip — states', () => {
  it('reads the cells of the bar that is now against the current round', () => {
    // laps, Alpha [Push, Pull, Squat] + Bravo [Row], 2 rounds. Work 3 is
    // Alpha round 2 station 1: the later stations are ahead again, not done.
    const strip = progressStrip(planOf('laps', unevenPods, 2), 3)
    expect(strip.bars.map((bar) => bar.state)).toEqual(['active', 'upcoming'])
    expect(strip.bars.map((bar) => bar.cells)).toEqual([
      ['active', 'upcoming', 'upcoming'],
      ['upcoming'],
    ])
  })

  it('reads a done bar as all done and an ahead bar as all ahead', () => {
    // Work 6 is Bravo round 1: Alpha is finished, and Bravo is running.
    const strip = progressStrip(planOf('laps', [...unevenPods, ['Press', 'Hinge']], 2), 6)
    expect(strip.bars.map((bar) => bar.state)).toEqual(['done', 'active', 'upcoming'])
    expect(strip.bars.map((bar) => bar.cells)).toEqual([
      ['done', 'done', 'done'],
      ['active'],
      ['upcoming', 'upcoming'],
    ])
  })

  it('reads the bar that holds the current work as now on `sets` too', () => {
    // sets, 2 rounds. Work 4 is Squat round 1 — the third station.
    const strip = progressStrip(planOf('sets', unevenPods, 2), 4)
    expect(strip.bars.map((bar) => bar.state)).toEqual(['done', 'done', 'active', 'upcoming'])
    expect(strip.bars.map((bar) => bar.cells)).toEqual([
      ['done'],
      ['done'],
      ['active'],
      ['upcoming'],
    ])
  })

  it('yields one dot per round, following the current work’s round', () => {
    const strip = progressStrip(planOf('laps', unevenPods, 3), 4)
    // Work 4 is Alpha round 2 station 2.
    expect(strip.dots).toEqual(['done', 'active', 'upcoming'])
  })

  it('restarts the dots with the pod on `laps`', () => {
    // Work 6 is Bravo round 1 — the round counter restarted with the pod, so
    // the dots restart with it.
    const strip = progressStrip(planOf('laps', unevenPods, 2), 6)
    expect(strip.dots).toEqual(['active', 'upcoming'])
  })

  it('reads every bar, cell and dot as ahead when no work is in focus', () => {
    const strip = progressStrip(planOf('laps', unevenPods, 2), undefined)
    expect(strip.bars.map((bar) => bar.state)).toEqual(['upcoming', 'upcoming'])
    expect(strip.bars.flatMap((bar) => bar.cells)).toEqual([
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
    ])
    expect(strip.dots).toEqual(['upcoming', 'upcoming'])
  })

  it('reads an ordinal outside the plan the same way — everything ahead', () => {
    // A stale index survives an applied plan change. It must not paint a
    // station that nobody started.
    const plan = planOf('laps', unevenPods, 2)
    const strip = progressStrip(plan, plan.workTotal + 5)
    expect(strip.bars.map((bar) => bar.state)).toEqual(['upcoming', 'upcoming'])
    expect(strip.bars.flatMap((bar) => bar.cells).every((cell) => cell === 'upcoming')).toBe(true)
    expect(strip.dots).toEqual(['upcoming', 'upcoming'])
  })

  it('gives every bar, cell and dot exactly one of the three states', () => {
    const plan = planOf('sets', unevenPods, 2)
    for (let index = 0; index < plan.workTotal; index++) {
      const strip = progressStrip(plan, index)
      const values = [
        ...strip.bars.map((bar) => bar.state),
        ...strip.bars.flatMap((bar) => bar.cells),
        ...strip.dots,
      ]
      for (const value of values) {
        expect(STATES).toContain(value)
      }
      // Exactly one bar is now, and exactly one dot is now.
      expect(strip.bars.filter((bar) => bar.state === 'active')).toHaveLength(1)
      expect(strip.dots.filter((state) => state === 'active')).toHaveLength(1)
    }
  })
})

/**
 * The width one cell of a bar really gets, laid out the way
 * `progress-strip.tsx` draws it.
 *
 * The bars share what the strip has left after the gap between each pair of
 * them and the wider gap before each pod run. The cells of one bar then share
 * their bar's width after the gaps between themselves. `cells` is the bar's
 * station count, which a bar that went plain no longer reports, so the caller
 * names it from the shape it authored.
 *
 * This restates the renderer's geometry, not the derivation's expression. It
 * cannot be measured instead: jsdom runs no layout, so every width it reports
 * is zero.
 */
const renderedCellWidthPx = (strip: ProgressStrip, budget: StripBudget, cells: number): number => {
  const bars = strip.bars.length
  const podRuns = strip.bars.filter((bar) => bar.startsPodRun).length
  const gapsPx = budget.barGapPx * Math.max(bars - 1, 0) + budget.podRunGapPx * podRuns
  const barPx = (budget.stripWidthPx - gapsPx) / bars
  return (barPx - budget.cellGapPx * (cells - 1)) / cells
}

/**
 * Every uniform shape the collapse sweep reads: both flows, one to six pods,
 * one to twelve stations each. Uniform pods give one station count per bar,
 * which is what lets the sweep name the width a bar that went plain would
 * have been drawn at.
 */
const SWEEP_SHAPES = (['laps', 'sets'] as const).flatMap((flow) =>
  Array.from({ length: 6 }, (_, pod) =>
    Array.from({ length: 12 }, (_, station) => ({
      flow,
      podCount: pod + 1,
      stationCount: station + 1,
    })),
  ).flat(),
)

/** The default budget with every gap taken out, so one gap can be added back alone. */
const NO_GAPS: StripBudget = { ...STRIP_BUDGET, barGapPx: 0, podRunGapPx: 0, cellGapPx: 0 }

describe('progressStrip — cell collapse', () => {
  it('drops the cells of a bar whose share is too narrow, and keeps its neighbour’s', () => {
    // Budget 20px over 2 bars, less the 6px gap between them, is a 7px share.
    // Alpha's three cells would be 5px after their two 1px gaps — 1.7px each,
    // under the 4px minimum, so Alpha goes plain. Bravo's one cell takes no
    // gap and gets the whole 7px, so Bravo keeps it.
    const strip = progressStrip(planOf('laps', unevenPods, 2), 3, {
      ...STRIP_BUDGET,
      stripWidthPx: 20,
    })
    expect(strip.bars.map((bar) => bar.cells)).toEqual([[], ['upcoming']])
    // A plain bar still says where the session is.
    expect(strip.bars.map((bar) => bar.state)).toEqual(['active', 'upcoming'])
  })

  it('drops the cells under the default budget when a workout authors too many stations', () => {
    // 3 pods x 24 stations: each bar's share of the default budget divides
    // into cells below the minimum, so every bar renders plain.
    const pods = [names(24, 'A'), names(24, 'B'), names(24, 'C')]
    const strip = progressStrip(planOf('laps', pods, 1), 0)
    expect(strip.bars).toHaveLength(3)
    expect(strip.bars.every((bar) => bar.cells.length === 0)).toBe(true)
    // The budget is the input that decides it: widen it and the same plan
    // keeps every cell.
    const wide = progressStrip(planOf('laps', pods, 1), 0, { ...STRIP_BUDGET, stripWidthPx: 2000 })
    expect(wide.bars.every((bar) => bar.cells.length === 24)).toBe(true)
  })

  it('keeps the cells of both 48-work worst cases', () => {
    const laps = progressStrip(planOf('laps', [names(4, 'A'), names(4, 'B'), names(4, 'C')], 4), 0)
    expect(laps.bars.map((bar) => bar.cells.length)).toEqual([4, 4, 4])
    expect(laps.dots).toHaveLength(4)

    const sets = progressStrip(planOf('sets', [names(12, 'S')], 4), 0)
    expect(sets.bars).toHaveLength(12)
    expect(sets.bars.every((bar) => bar.cells.length === 1)).toBe(true)
    expect(sets.dots).toHaveLength(4)
  })
})

/**
 * The gaps the renderer draws are width the cells never get, so the collapse
 * spends them before it divides. Each test below adds one gap back on its own
 * to a plan the budget otherwise keeps, and the plan gives its cells up.
 */
describe('progressStrip — cell collapse counts the renderer’s gaps', () => {
  it('counts the gap between the bars', () => {
    // 7 pods of 8 stations. Without the gap the share is 40px and a cell is
    // 4.1px, so the cells stay. The six 6px gaps take the share to 34.9px and
    // the cell to 3.5px, under the floor.
    const pods = Array.from({ length: 7 }, (_, pod) => names(8, `P${pod}`))
    const plan = planOf('laps', pods, 1)
    const kept = progressStrip(plan, 0, { ...NO_GAPS, cellGapPx: STRIP_BUDGET.cellGapPx })
    expect(kept.bars.every((bar) => bar.cells.length === 8)).toBe(true)

    const dropped = progressStrip(plan, 0)
    expect(dropped.bars.every((bar) => bar.cells.length === 0)).toBe(true)
  })

  it('counts the gap between the cells of one bar', () => {
    // 2 pods of 30 stations, with the bar gaps taken out so only the cell gap
    // moves. 140px over 30 cells is 4.7px each; the twenty-nine 1px gaps take
    // 111px over 30 to 3.7px, under the floor.
    const plan = planOf('laps', [names(30, 'A'), names(30, 'B')], 1)
    const kept = progressStrip(plan, 0, NO_GAPS)
    expect(kept.bars.every((bar) => bar.cells.length === 30)).toBe(true)

    const dropped = progressStrip(plan, 0, { ...NO_GAPS, cellGapPx: STRIP_BUDGET.cellGapPx })
    expect(dropped.bars.every((bar) => bar.cells.length === 0)).toBe(true)
  })

  it('counts the wider gap a bar that opens a pod run takes', () => {
    // A `sets` workout of 2 pods of 14 stations: 28 one-cell bars, one of
    // which opens the second pod's run. After the bar gaps the share is
    // 4.2px, so the cells stay. That one bar's extra 8px takes every share to
    // 3.9px, under the floor — the boundary of one bar collapses all 28.
    const plan = planOf('sets', [names(14, 'A'), names(14, 'B')], 1)
    const kept = progressStrip(plan, 0, { ...STRIP_BUDGET, podRunGapPx: 0 })
    expect(kept.bars).toHaveLength(28)
    expect(kept.bars.every((bar) => bar.cells.length === 1)).toBe(true)

    const dropped = progressStrip(plan, 0)
    expect(dropped.bars.every((bar) => bar.cells.length === 0)).toBe(true)
  })

  it('drops the cells of a plan the ungapped budget called exactly wide enough', () => {
    // 7 pods of 10 stations divides the bare 280px into cells of exactly 4px,
    // which a budget blind to the gaps reports as kept. The strip draws six
    // 6px gaps and nine 1px gaps per bar, so the cell is really 2.6px.
    const pods = Array.from({ length: 7 }, (_, pod) => names(10, `P${pod}`))
    const strip = progressStrip(planOf('laps', pods, 1), 0)
    expect(strip.bars).toHaveLength(7)
    expect(strip.bars.every((bar) => bar.cells.length === 0)).toBe(true)
    expect(renderedCellWidthPx(strip, STRIP_BUDGET, 10)).toBeLessThan(STRIP_BUDGET.minCellWidthPx)
  })

  it('gives every bar up when the gaps alone would spend the whole strip', () => {
    // 60 one-cell bars carry 59 gaps of 6px — 354px of a 280px strip. The
    // share goes negative rather than to a nonsense width, and every bar
    // renders plain while the strip still says where the session is.
    const strip = progressStrip(planOf('sets', [names(60, 'S')], 1), 0)
    expect(strip.bars).toHaveLength(60)
    expect(strip.bars.every((bar) => bar.cells.length === 0)).toBe(true)
    expect(strip.bars.filter((bar) => bar.state === 'active')).toHaveLength(1)
  })

  it('keeps a cell at or above the floor, and drops one below it, for every shape swept', () => {
    // The rule's whole claim, over both flows: a bar reports cells only where
    // the renderer draws them at the floor or wider, and never where it would
    // draw them narrower. Uniform pods keep one station count per bar, so the
    // sweep can name the width a plain bar would have had.
    let kept = 0
    let plain = 0
    for (const { flow, podCount, stationCount } of SWEEP_SHAPES) {
      const pods = Array.from({ length: podCount }, (_, pod) => names(stationCount, `P${pod}`))
      const strip = progressStrip(planOf(flow, pods, 1), 0)
      // A `laps` bar is a pod, a `sets` bar is one station of one pod.
      const cells = flow === 'laps' ? stationCount : 1
      const widthPx = renderedCellWidthPx(strip, STRIP_BUDGET, cells)
      for (const bar of strip.bars) {
        if (bar.cells.length === 0) {
          plain++
          expect(widthPx).toBeLessThan(STRIP_BUDGET.minCellWidthPx)
        } else {
          kept++
          expect(bar.cells).toHaveLength(cells)
          expect(widthPx).toBeGreaterThanOrEqual(STRIP_BUDGET.minCellWidthPx)
        }
      }
    }
    // Neither branch may be the only one the sweep reached, or it proves half
    // a rule.
    expect(kept).toBeGreaterThan(0)
    expect(plain).toBeGreaterThan(0)
  })
})
