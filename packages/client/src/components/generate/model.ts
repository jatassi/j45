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
 * The Emphasis part of the generate payload.
 *
 * The constraint carries a nonempty list of groups, or nothing at all. An
 * empty selection is therefore not a value that the payload can hold: it is an
 * absence. The form holds the selection as a set, which can be empty, so this
 * is where that empty set becomes an absent key.
 */
export const emphasisPayload = (
  groups: ReadonlySet<MuscleGroup>,
): { readonly emphasis?: readonly [MuscleGroup, ...MuscleGroup[]] } => {
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
