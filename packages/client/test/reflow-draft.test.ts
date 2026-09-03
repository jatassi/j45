import { applyReflow, compile, Flow, Pod, Round, Station, Workout } from '@j45/domain'
import * as Either from 'effect/Either'
import { describe, expect, it } from 'vitest'

import {
  computeReflow,
  initReflowDraft,
  moveStationToPod,
  reflowSummary,
  removePod,
  removeStation,
  renamePod,
  setFlowType,
  setRound,
} from '@/lib/reflow-draft'

/**
 * Source: two pods (Alpha: Push, Pull / Bravo: Squat), sets, two equal rounds.
 * Flattened station indexes: 0 Push, 1 Pull, 2 Squat.
 */
const source = new Workout({
  name: 'Src',
  focus: 'strength',
  note: 'a note',
  pods: [
    new Pod({
      name: 'Alpha',
      stations: [new Station({ name: 'Push' }), new Station({ name: 'Pull' })],
    }),
    new Pod({ name: 'Bravo', stations: [new Station({ name: 'Squat' })] }),
  ],
  flow: new Flow({
    type: 'sets',
    rounds: [
      new Round({ workSeconds: 20, restSeconds: 10 }),
      new Round({ workSeconds: 20, restSeconds: 10 }),
    ],
  }),
})

const right = <A, E>(either: Either.Either<A, E>): A => Either.getOrThrow(either)

describe('reflow-draft', () => {
  it('opens carrying the source structure and timing (6 works · 3:20)', () => {
    const result = right(computeReflow(source, initReflowDraft(source)))
    expect(result.workout.name).toBe('Src')
    expect(result.workout.focus).toBe('strength')
    expect(result.workout.note).toBe('a note')
    expect(result.workout.flow.type).toBe('sets')
    expect(result.workout.pods.map((pod) => pod.stations.map((s) => s.name))).toEqual([
      ['Push', 'Pull'],
      ['Squat'],
    ])
    expect(result.compiled.workTotal).toBe(6)
    expect(reflowSummary(result)).toBe('6 works · 3:20')
  })

  it('yields one memoized result whose workout and compiled agree with applyReflow/compile', () => {
    // Criterion 4: the chip (compiled), Start (reflow), and Save (workout)
    // all read from one computeReflow result — they must not diverge.
    const result = right(computeReflow(source, initReflowDraft(source)))
    expect(right(applyReflow(source, result.reflow))).toStrictEqual(result.workout)
    expect(result.compiled).toStrictEqual(compile(result.workout))
  })

  it('regroups into one pod, drops a station, and flips sets→laps (4 works · 2:20)', () => {
    let draft = initReflowDraft(source)
    draft = moveStationToPod(draft, { podIndex: 1, stationIndex: 0, targetPodIndex: 0 })
    draft = removePod(draft, 1)
    draft = removeStation(draft, 0, 1) // drop Pull
    draft = setFlowType(draft, 'laps')
    const result = right(computeReflow(source, draft))
    expect(result.workout.pods).toHaveLength(1)
    expect(result.workout.pods[0].stations.map((s) => s.name)).toEqual(['Push', 'Squat'])
    expect(result.workout.flow.type).toBe('laps')
    expect(result.compiled.workTotal).toBe(4)
    expect(reflowSummary(result)).toBe('4 works · 2:20')
  })

  it('overriding a round replaces the carried timing (40/10 × 2 → 5:20)', () => {
    let draft = initReflowDraft(source) // uniform, 2 rounds of 20/10
    draft = setRound(draft, { index: 0, patch: { workSeconds: '40' } })
    const result = right(computeReflow(source, draft))
    expect(result.compiled.totalDurationMillis).toBe(320_000)
  })

  it('an empty pod is an invalid draft — Left, never a crash', () => {
    let draft = initReflowDraft(source)
    draft = removePod(draft, 1)
    draft = removeStation(draft, 0, 0)
    draft = removeStation(draft, 0, 0) // Alpha now empty
    expect(Either.isLeft(computeReflow(source, draft))).toBe(true)
  })

  it('a blank pod name is an invalid draft — Left', () => {
    const draft = renamePod(initReflowDraft(source), 0, '')
    expect(Either.isLeft(computeReflow(source, draft))).toBe(true)
  })

  it('an empty overridden work-seconds is an invalid draft — Left', () => {
    const draft = setRound(initReflowDraft(source), { index: 0, patch: { workSeconds: '' } })
    expect(Either.isLeft(computeReflow(source, draft))).toBe(true)
  })
})
