import { compile, Flow, Pod, Round, Station, Workout } from '@j45/domain'
import * as Either from 'effect/Either'
import { describe, expect, it } from 'vitest'

import {
  collapseUniform,
  decodeDraft,
  expandUniform,
  setRoundCount,
  summarizeDraft,
  type DraftFlow,
  type DraftRound,
  type DraftWorkout,
} from '@/lib/workout-draft'

const roundA: DraftRound = { workSeconds: '40', restSeconds: '20' }
const roundB: DraftRound = { workSeconds: '30', restSeconds: '10' }
const roundC: DraftRound = { workSeconds: '25', restSeconds: '5' }
const roundD: DraftRound = { workSeconds: '20', restSeconds: '0' }

const singleRoundFlow = (round: DraftRound = roundA): DraftFlow => ({
  type: 'laps',
  rounds: [round],
})

/** Minimal fully-valid draft (name, focus, one pod/station, one positive work / non-neg rest). */
const validDraft = (overrides: Partial<DraftWorkout> = {}): DraftWorkout => ({
  name: 'Athletica',
  focus: 'cardio',
  pods: [
    {
      name: 'Pod 1',
      stations: [{ name: 'Burpee', detail: '(step back = no-jump)' }],
    },
  ],
  flow: {
    type: 'laps',
    rounds: [{ workSeconds: '40', restSeconds: '20' }],
  },
  ...overrides,
})

/**
 * Full Athletica-shaped draft: 3 pods × 3 stations, uniform 40″/20″ × 3 laps.
 * Domain golden: 27 works, 1605s → "27 works · 26:45".
 */
const athleticaDraft: DraftWorkout = {
  name: 'Athletica',
  focus: 'cardio',
  note: 'One rower/bike? Split stations 1 & 4.',
  pods: [
    {
      name: 'Pod 1',
      stations: [
        { name: 'Rower — strong, steady pulls' },
        { name: 'Dumbbell squat + alternating shoulder press' },
        { name: 'Burpee', detail: '(step back = no-jump)' },
      ],
    },
    {
      name: 'Pod 2',
      stations: [
        { name: 'Bike or treadmill — sprint effort' },
        { name: 'Kettlebell swing' },
        { name: 'Mountain climbers — fast, hips low' },
      ],
    },
    {
      name: 'Pod 3',
      stations: [
        { name: 'Dumbbell single-arm snatch — alternate arms' },
        { name: 'Box / bench explosive step-ups' },
        { name: 'Slam-ball over-shoulder throw', detail: '(sub: dumbbell thruster)' },
      ],
    },
  ],
  flow: {
    type: 'laps',
    rounds: [
      { workSeconds: '40', restSeconds: '20' },
      { workSeconds: '40', restSeconds: '20' },
      { workSeconds: '40', restSeconds: '20' },
    ],
  },
}

const athleticaWorkout = new Workout({
  name: 'Athletica',
  focus: 'cardio',
  note: 'One rower/bike? Split stations 1 & 4.',
  pods: [
    new Pod({
      name: 'Pod 1',
      stations: [
        new Station({ name: 'Rower — strong, steady pulls' }),
        new Station({ name: 'Dumbbell squat + alternating shoulder press' }),
        new Station({ name: 'Burpee', detail: '(step back = no-jump)' }),
      ],
    }),
    new Pod({
      name: 'Pod 2',
      stations: [
        new Station({ name: 'Bike or treadmill — sprint effort' }),
        new Station({ name: 'Kettlebell swing' }),
        new Station({ name: 'Mountain climbers — fast, hips low' }),
      ],
    }),
    new Pod({
      name: 'Pod 3',
      stations: [
        new Station({ name: 'Dumbbell single-arm snatch — alternate arms' }),
        new Station({ name: 'Box / bench explosive step-ups' }),
        new Station({ name: 'Slam-ball over-shoulder throw', detail: '(sub: dumbbell thruster)' }),
      ],
    }),
  ],
  flow: new Flow({
    type: 'laps',
    rounds: [
      new Round({ workSeconds: 40, restSeconds: 20 }),
      new Round({ workSeconds: 40, restSeconds: 20 }),
      new Round({ workSeconds: 40, restSeconds: 20 }),
    ],
  }),
})

describe('expandUniform', () => {
  it('expands a single-round flow to N rounds, each equal to round 1', () => {
    const flow = singleRoundFlow(roundA)
    const expanded = expandUniform(flow, 4)
    expect(expanded.rounds).toHaveLength(4)
    for (const round of expanded.rounds) {
      expect(round).toEqual(roundA)
    }
  })
})

describe('collapseUniform', () => {
  it('collapses an N-round ladder to round 1 only', () => {
    const flow: DraftFlow = {
      type: 'sets',
      rounds: [roundA, roundB, roundC, roundD],
    }
    const collapsed = collapseUniform(flow)
    expect(collapsed.rounds).toHaveLength(1)
    expect(collapsed.rounds[0]).toEqual(roundA)
  })
})

describe('uniform expand → collapse round-trip', () => {
  it('restores a single round equal to the original round 1 pair', () => {
    const flow = singleRoundFlow(roundA)
    const roundTripped = collapseUniform(expandUniform(flow, 4))
    expect(roundTripped.rounds).toHaveLength(1)
    expect(roundTripped.rounds[0]).toEqual(roundA)
  })
})

describe('setRoundCount', () => {
  it('seeds new rounds from the current last round when growing', () => {
    const flow: DraftFlow = { type: 'laps', rounds: [roundA, roundB] }
    const grown = setRoundCount(flow, 4)
    expect(grown.rounds).toHaveLength(4)
    expect(grown.rounds[0]).toEqual(roundA)
    expect(grown.rounds[1]).toEqual(roundB)
    expect(grown.rounds[2]).toEqual(roundB)
    expect(grown.rounds[3]).toEqual(roundB)
  })

  it('truncates to the first count rounds when shrinking', () => {
    const flow: DraftFlow = {
      type: 'laps',
      rounds: [roundA, roundB, roundC, roundD],
    }
    const shrunk = setRoundCount(flow, 2)
    expect(shrunk.rounds).toEqual([roundA, roundB])
  })
})

describe('decodeDraft', () => {
  it('decodes a fully-valid draft to a Workout', () => {
    const result = decodeDraft(validDraft())
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      const workout = result.right
      expect(workout.name).toBe('Athletica')
      expect(workout.focus).toBe('cardio')
      expect(workout.pods).toHaveLength(1)
      expect(workout.pods[0].stations[0].name).toBe('Burpee')
      expect(workout.flow.rounds[0].workSeconds).toBe(40)
      expect(workout.flow.rounds[0].restSeconds).toBe(20)
    }
  })

  it('fails with a non-empty message when pods is empty', () => {
    const result = decodeDraft(validDraft({ pods: [] }))
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.length).toBeGreaterThan(0)
    }
  })

  it('fails with a non-empty message when a station name is empty', () => {
    const result = decodeDraft(
      validDraft({
        pods: [{ name: 'Pod 1', stations: [{ name: '' }] }],
      }),
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.length).toBeGreaterThan(0)
    }
  })

  it('fails with a non-empty message when workSeconds is 0', () => {
    const result = decodeDraft(
      validDraft({
        flow: { type: 'laps', rounds: [{ workSeconds: '0', restSeconds: '20' }] },
      }),
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.length).toBeGreaterThan(0)
    }
  })

  it('fails with a non-empty message when restSeconds is negative', () => {
    const result = decodeDraft(
      validDraft({
        flow: { type: 'laps', rounds: [{ workSeconds: '40', restSeconds: '-5' }] },
      }),
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.length).toBeGreaterThan(0)
    }
  })
})

describe('summarizeDraft', () => {
  it('returns N works · MM:SS for a decodable draft', () => {
    const summary = summarizeDraft(athleticaDraft)
    expect(summary).toMatch(/^\d+ works · \d+:\d{2}$/)

    const compiled = compile(athleticaWorkout)
    const totalSeconds = Math.ceil(compiled.totalDurationMillis / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    const expected = `${compiled.workTotal} works · ${minutes}:${seconds.toString().padStart(2, '0')}`
    expect(summary).toBe(expected)
    expect(summary).toBe('27 works · 26:45')
  })

  it('returns null for a non-decoding draft without throwing', () => {
    expect(() => summarizeDraft(validDraft({ pods: [] }))).not.toThrow()
    expect(summarizeDraft(validDraft({ pods: [] }))).toBeNull()
  })
})
