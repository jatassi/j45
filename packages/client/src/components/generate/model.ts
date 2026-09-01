import type * as React from 'react'

import { compile, Equipment, Focus, MuscleGroup, type Workout } from '@j45/domain'
import * as Arr from 'effect/Array'

import { formatDuration } from '@/lib/workouts'

export const FOCI = Focus.literals
export const EQUIPMENT = Equipment.literals
export const MUSCLE_GROUPS = MuscleGroup.literals
export const MIN_MINUTES = 15
export const MAX_MINUTES = 45
export const STEP = 5

export type Preview = { readonly workout: Workout; readonly seed: number }
export type Constraints = {
  readonly focus: Focus
  readonly targetMinutes: number
  readonly equipment: ReadonlySet<Equipment>
  readonly emphasis: ReadonlySet<MuscleGroup>
  readonly noRepeatSessions: number
}
export type FormModel = {
  readonly c: Constraints
  readonly setFocus: (f: Focus) => void
  readonly setMinutes: React.Dispatch<React.SetStateAction<number>>
  readonly setEquipment: React.Dispatch<React.SetStateAction<ReadonlySet<Equipment>>>
  readonly setEmphasis: React.Dispatch<React.SetStateAction<ReadonlySet<MuscleGroup>>>
  readonly setNoRepeat: React.Dispatch<React.SetStateAction<number>>
}

/**
 * Whether the Emphasis field is disabled for a focus.
 *
 * Emphasis narrows the strength picks, and it does nothing to a cardio pick.
 * It therefore has no work to do under a cardio focus. The field then states
 * that and stops taking input, instead of looking live while it has no effect.
 *
 * The rule lives here because two places read it: the field, which disables
 * its chips, and the payload, which drops the key. It is a rule about which
 * field accepts input, and not a rule of generation — the domain already lets
 * every cardio exercise pass the emphasis filter — so it stays in the form.
 */
export const isEmphasisDisabled = (focus: Focus): boolean => focus === 'cardio'

/**
 * The Emphasis part of the generate payload.
 *
 * The constraint carries a nonempty list of groups, or nothing at all. An
 * empty selection is therefore not a value that the payload can hold: it is an
 * absence. The form holds the selection as a set, which can be empty, so this
 * is where that empty set becomes an absent key.
 *
 * A disabled field sends nothing either, and it keeps the selection it holds.
 * The two halves are deliberate: the kept selection protects the work of the
 * user across a change of focus, and the absent key keeps the request true to
 * what the form applies. The workout is the same either way, because a cardio
 * focus admits no strength exercise.
 */
export const emphasisPayload = (
  focus: Focus,
  groups: ReadonlySet<MuscleGroup>,
): { readonly emphasis?: readonly [MuscleGroup, ...MuscleGroup[]] } => {
  if (isEmphasisDisabled(focus)) {
    return {}
  }
  const list = [...groups]
  return Arr.isNonEmptyReadonlyArray(list) ? { emphasis: list } : {}
}

export const mintSeed = (): number => Math.floor(Math.random() * 2 ** 31)
export const clampMin = (n: number): number =>
  Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(n / STEP) * STEP))
export const isFocus = (v: string): v is Focus => (FOCI as readonly string[]).includes(v)

export const infeasibleReason = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined
  if (!('_tag' in error) || error._tag !== 'GenerationInfeasible') return undefined
  return 'reason' in error && typeof error.reason === 'string' ? error.reason : undefined
}

export const summaryOf = (w: Workout): string => {
  const { workTotal, totalDurationMillis } = compile(w)
  return `${workTotal} works · ${formatDuration(totalDurationMillis)}`
}
