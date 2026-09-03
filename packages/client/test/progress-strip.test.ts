// @vitest-environment jsdom
//
// The derivation itself is pure and touches no dom. The environment is for
// the module it lives in: `@/lib/session` also holds the session's atoms, and
// the rpc client they build reads `location` at import time.
import { compile, Flow, Pod, Round, Station, Workout, type FlowType } from '@j45/domain'
import { describe, expect, it } from 'vitest'

import {
  progressStrip,
  runState,
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

/** The lengths of every pod's runs — the shape the strip draws the plan as. */
const runShape = (strip: ProgressStrip) =>
  strip.pods.map((pod) => pod.runs.map((run) => run.length))

/** Every mark of the strip, pod by pod and run by run. */
const marksOf = (strip: ProgressStrip): readonly CellState[] =>
  strip.pods.flatMap((pod) => pod.runs.flat())

/**
 * A budget with no gaps at all, so a test that is about the floors states its
 * own width and divides it evenly.
 */
const bare = (over: Partial<StripBudget> = {}): StripBudget => ({
  ...STRIP_BUDGET,
  dotGapPx: 0,
  runGapPx: 0,
  podGapPx: 0,
  ...over,
})

/** Wide enough that every shape below stays open at the full dot cap. */
const WIDE: StripBudget = { ...STRIP_BUDGET, stripWidthPx: 4000 }

describe('progressStrip — runs', () => {
  it('makes a run of each round on `laps`, holding the pod’s stations', () => {
    const strip = progressStrip(planOf('laps', unevenPods, 2), undefined, WIDE)
    expect(strip.pods.map((pod) => pod.key)).toEqual(['pod-0', 'pod-1'])
    expect(runShape(strip)).toEqual([
      [3, 3],
      [1, 1],
    ])
  })

  it('makes a run of each station on `sets`, holding that station’s rounds', () => {
    const strip = progressStrip(planOf('sets', unevenPods, 2), undefined, WIDE)
    expect(strip.pods.map((pod) => pod.key)).toEqual(['pod-0', 'pod-1'])
    expect(runShape(strip)).toEqual([[2, 2, 2], [2]])
  })

  it('groups a pod of one station by the stated flow, not by the work order', () => {
    // Every pod holds one station, so `laps` and `sets` compile to the very
    // same work order. The grouping must still follow the stated flow.
    const pods = [['Push'], ['Pull']]
    expect(runShape(progressStrip(planOf('laps', pods, 3), undefined, WIDE))).toEqual([
      [1, 1, 1],
      [1, 1, 1],
    ])
    expect(runShape(progressStrip(planOf('sets', pods, 3), undefined, WIDE))).toEqual([[3], [3]])
  })

  it('groups a flow of one round by the stated flow, not by the work order', () => {
    const pods = [
      ['Push', 'Pull'],
      ['Row', 'Press'],
    ]
    expect(runShape(progressStrip(planOf('laps', pods, 1), undefined, WIDE))).toEqual([[2], [2]])
    expect(runShape(progressStrip(planOf('sets', pods, 1), undefined, WIDE))).toEqual([
      [1, 1],
      [1, 1],
    ])
  })

  it('draws every work of the plan exactly once, over both flows', () => {
    for (const flow of ['laps', 'sets'] as const) {
      const plan = planOf(flow, unevenPods, 3)
      expect(marksOf(progressStrip(plan, undefined, WIDE))).toHaveLength(plan.workTotal)
    }
  })

  it('keeps the runs of every pod, whatever the mode', () => {
    // A pill says nothing about the works inside it, but the renderer still
    // reads its runs.
    const strip = progressStrip(planOf('laps', unevenPods, 2), 0, bare({ stripWidthPx: 1 }))
    expect(strip.layout).toBe('focus')
    expect(strip.pods.map((pod) => pod.mode)).toContain('pill')
    expect(runShape(strip)).toEqual([
      [3, 3],
      [1, 1],
    ])
  })
})

describe('progressStrip — degenerate shapes', () => {
  const shapes = [
    ['one pod of one station, one round', planOf('laps', [['Push']], 1)],
    ['one pod of one station, many rounds', planOf('sets', [['Push']], 5)],
    ['one pod of many stations, one round', planOf('laps', [names(4, 'A')], 1)],
    ['many pods of one station', planOf('sets', [['Push'], ['Pull'], ['Row']], 2)],
    ['uneven pods', planOf('laps', [...unevenPods, ['Press', 'Hinge']], 3)],
  ] as const

  for (const [label, plan] of shapes) {
    it(`gives ${label} a whole strip`, () => {
      const strip = progressStrip(plan, 0)
      expect(strip.pods.length).toBeGreaterThan(0)
      expect(strip.pods.every((pod) => pod.runs.length > 0)).toBe(true)
      expect(marksOf(strip)).toHaveLength(plan.workTotal)
      expect(Number.isFinite(strip.dotSizePx)).toBe(true)
      expect(strip.dotSizePx).toBeGreaterThanOrEqual(0)
    })
  }
})

describe('progressStrip — layout', () => {
  // One pod of four stations, one round: four works over a gapless budget, so
  // the open dot is the width divided by four.
  const plan = planOf('laps', [names(4, 'A')], 1)

  it('stays open while the dot sits on the open floor', () => {
    const strip = progressStrip(plan, 0, bare({ stripWidthPx: 24 }))
    expect(strip.layout).toBe('open')
    expect(strip.pods.every((pod) => pod.mode === 'dots')).toBe(true)
  })

  it('falls to focus when the dot goes under the open floor', () => {
    expect(progressStrip(plan, 0, bare({ stripWidthPx: 23 })).layout).toBe('focus')
  })

  it('never lets the dot pass the cap', () => {
    for (const budget of [WIDE, STRIP_BUDGET, bare({ stripWidthPx: 1 })]) {
      const strip = progressStrip(planOf('sets', unevenPods, 2), 0, budget)
      expect(strip.dotSizePx).toBeLessThanOrEqual(budget.dotCapPx)
      expect(strip.dotSizePx).toBeGreaterThanOrEqual(0)
    }
  })

  it('holds one layout for the whole session', () => {
    // The choice reads the plan and the budget only. A layout that moved with
    // the work would shift the strip under the participant mid-session.
    for (const plan of [
      planOf('laps', [names(3, 'A'), names(3, 'B')], 2),
      planOf('sets', [names(6, 'A'), names(6, 'B'), names(6, 'C'), names(6, 'D')], 4),
    ]) {
      const first = progressStrip(plan, undefined).layout
      for (let index = -1; index <= plan.workTotal; index++) {
        expect(progressStrip(plan, index).layout).toBe(first)
      }
    }
  })
})

describe('progressStrip — focus', () => {
  // Two pods of four stations, one round. Eight works make the open dot far
  // too small, so the strip is in focus; the open pod then divides the width
  // among its own four works.
  const plan = planOf('laps', [names(4, 'A'), names(4, 'B')], 1)
  const focusBudget = bare({ stripWidthPx: 16, pillWidthPx: 0 })

  it('gives the open pod dots while its dot holds the focus floor', () => {
    const strip = progressStrip(plan, 0, focusBudget)
    expect(strip.layout).toBe('focus')
    expect(strip.pods.map((pod) => pod.mode)).toEqual(['dots', 'pill'])
    expect(strip.dotSizePx).toBe(4)
  })

  it('gives the open pod cells when its dot goes under the focus floor', () => {
    const strip = progressStrip(plan, 0, { ...focusBudget, stripWidthPx: 15 })
    expect(strip.pods.map((pod) => pod.mode)).toEqual(['cells', 'pill'])
  })

  it('opens the pod that holds the current work', () => {
    expect(progressStrip(plan, 5, focusBudget).pods.map((pod) => pod.mode)).toEqual([
      'pill',
      'dots',
    ])
  })

  it('opens the first pod when no work is in focus', () => {
    expect(progressStrip(plan, undefined, focusBudget).pods.map((pod) => pod.mode)).toEqual([
      'dots',
      'pill',
    ])
  })

  it('opens the last pod when the ordinal is past the plan', () => {
    expect(
      progressStrip(plan, plan.workTotal + 5, focusBudget).pods.map((pod) => pod.mode),
    ).toEqual(['pill', 'dots'])
  })

  it('opens the first pod on an ordinal before the plan', () => {
    expect(progressStrip(plan, -1, focusBudget).pods.map((pod) => pod.mode)).toEqual([
      'dots',
      'pill',
    ])
  })

  it('gives the open pod up to cells when the gaps alone spend the whole strip', () => {
    const strip = progressStrip(planOf('sets', [names(30, 'S')], 2), 0, {
      ...STRIP_BUDGET,
      stripWidthPx: 10,
    })
    expect(strip.layout).toBe('focus')
    expect(strip.dotSizePx).toBe(0)
    expect(strip.pods.map((pod) => pod.mode)).toEqual(['cells'])
  })
})

describe('progressStrip — states', () => {
  it('reads the current round of the pod that is now, on `laps`', () => {
    // Alpha [Push, Pull, Squat] + Bravo [Row], 2 rounds. Work 3 opens Alpha's
    // second round: the later stations are ahead again, not done.
    const strip = progressStrip(planOf('laps', unevenPods, 2), 3, WIDE)
    expect(strip.pods.map((pod) => pod.state)).toEqual(['active', 'upcoming'])
    expect(strip.pods.map((pod) => pod.runs)).toEqual([
      [
        ['done', 'done', 'done'],
        ['active', 'upcoming', 'upcoming'],
      ],
      [['upcoming'], ['upcoming']],
    ])
  })

  it('reads a pod that is over as done and one not started as ahead', () => {
    // Work 6 is Bravo round 1: Alpha is finished, and Charlie has not begun.
    const strip = progressStrip(planOf('laps', [...unevenPods, ['Press', 'Hinge']], 2), 6, WIDE)
    expect(strip.pods.map((pod) => pod.state)).toEqual(['done', 'active', 'upcoming'])
    expect(strip.pods[1].runs).toEqual([['active'], ['upcoming']])
  })

  it('reads the station that is now, on `sets`', () => {
    // Work 3 is Pull round 2 — the second station's second round.
    const strip = progressStrip(planOf('sets', unevenPods, 2), 3, WIDE)
    expect(strip.pods.map((pod) => pod.state)).toEqual(['active', 'upcoming'])
    expect(strip.pods.map((pod) => pod.runs)).toEqual([
      [
        ['done', 'done'],
        ['done', 'active'],
        ['upcoming', 'upcoming'],
      ],
      [['upcoming', 'upcoming']],
    ])
  })

  it('reads everything ahead when no work is in focus', () => {
    const strip = progressStrip(planOf('laps', unevenPods, 2), undefined, WIDE)
    expect(strip.pods.map((pod) => pod.state)).toEqual(['upcoming', 'upcoming'])
    expect(marksOf(strip).every((mark) => mark === 'upcoming')).toBe(true)
  })

  it('reads an ordinal before the plan the same way — everything ahead', () => {
    // A stale index survives an applied plan change. It must not paint a
    // station that nobody started.
    const plan = planOf('laps', unevenPods, 2)
    const strip = progressStrip(plan, -1, WIDE)
    expect(strip.pods.map((pod) => pod.state)).toEqual(['upcoming', 'upcoming'])
    expect(marksOf(strip).every((mark) => mark === 'upcoming')).toBe(true)
  })

  it('reads an ordinal at or past the plan as the finish — everything done', () => {
    // The two ends of a session must not draw one picture. A strip that read
    // ahead at the finish would say the workout never ran.
    const plan = planOf('laps', unevenPods, 2)
    for (const ordinal of [plan.workTotal, plan.workTotal + 5]) {
      const strip = progressStrip(plan, ordinal, WIDE)
      expect(strip.pods.map((pod) => pod.state)).toEqual(['done', 'done'])
      expect(marksOf(strip).every((mark) => mark === 'done')).toBe(true)
    }
  })

  it('gives every pod and every mark exactly one of the three states', () => {
    for (const flow of ['laps', 'sets'] as const) {
      const plan = planOf(flow, [...unevenPods, ['Press', 'Hinge']], 3)
      for (let index = 0; index < plan.workTotal; index++) {
        const strip = progressStrip(plan, index, WIDE)
        const marks = marksOf(strip)
        for (const value of [...strip.pods.map((pod) => pod.state), ...marks]) {
          expect(STATES).toContain(value)
        }
        // Exactly one work is now, and it makes exactly one pod now.
        expect(marks.filter((mark) => mark === 'active')).toHaveLength(1)
        expect(strip.pods.filter((pod) => pod.state === 'active')).toHaveLength(1)
      }
    }
  })
})

describe('runState', () => {
  it('reads now when the run holds the current work', () => {
    expect(runState(['done', 'active', 'upcoming'])).toBe('active')
  })

  it('reads done when every work of the run is done', () => {
    expect(runState(['done', 'done'])).toBe('done')
  })

  it('reads ahead otherwise', () => {
    expect(runState(['done', 'upcoming'])).toBe('upcoming')
    expect(runState(['upcoming'])).toBe('upcoming')
    expect(runState([])).toBe('upcoming')
  })
})
