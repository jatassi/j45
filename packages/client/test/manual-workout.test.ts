import { compile, Workout } from '@j45/domain'
import { describe, expect, it } from 'vitest'

import { buildManualWorkout } from '@/lib/manual-workout'

describe('buildManualWorkout', () => {
  it('returns a schema-valid Workout (domain Workout class)', () => {
    const workout = buildManualWorkout(40, 20, 9)
    expect(workout).toBeInstanceOf(Workout)
    expect(workout.name).toBe('Manual timer')
    expect(workout.focus).toBe('hybrid')
    expect(workout.flow.type).toBe('sets')
    expect(workout.flow.rounds).toHaveLength(9)
    expect(workout.pods).toHaveLength(1)
    expect(workout.pods[0].stations).toHaveLength(1)
  })

  it('work=40 / rest=20 / rounds=9 compiles to ready + 9 work + 8 rest, total 525000ms', () => {
    const compiled = compile(buildManualWorkout(40, 20, 9))

    expect(compiled.totalDurationMillis).toBe(525_000)
    expect(compiled.workTotal).toBe(9)

    const tags = compiled.segments.map((segment) => segment._tag)
    expect(tags).toStrictEqual([
      'ready',
      'work',
      'rest',
      'work',
      'rest',
      'work',
      'rest',
      'work',
      'rest',
      'work',
      'rest',
      'work',
      'rest',
      'work',
      'rest',
      'work',
      'rest',
      'work',
    ])

    expect(compiled.segments[0].durationMillis).toBe(5000)

    const workSegments = compiled.segments.filter((segment) => segment._tag === 'work')
    expect(workSegments).toHaveLength(9)
    for (const segment of workSegments) {
      expect(segment.durationMillis).toBe(40_000)
    }

    const restSegments = compiled.segments.filter((segment) => segment._tag === 'rest')
    expect(restSegments).toHaveLength(8)
    for (const segment of restSegments) {
      expect(segment.durationMillis).toBe(20_000)
    }
  })

  it('rest=0 yields zero rest segments in the compiled output', () => {
    const compiled = compile(buildManualWorkout(40, 0, 9))
    const restSegments = compiled.segments.filter((segment) => segment._tag === 'rest')
    expect(restSegments).toHaveLength(0)
    expect(compiled.segments.map((segment) => segment._tag)).toStrictEqual([
      'ready',
      'work',
      'work',
      'work',
      'work',
      'work',
      'work',
      'work',
      'work',
      'work',
    ])
  })
})
