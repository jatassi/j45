/**
 * Editor draft types and pure functions. Single source of draft truth —
 * the same decode path powers Save and the live summary chip.
 *
 * Draft numeric fields are strings (what inputs hold mid-edit); only
 * `decodeDraft` converts and validates against the domain `Workout` schema.
 */

import { compile, Workout } from '@j45/domain'
import * as Either from 'effect/Either'
import type { ParseError } from 'effect/ParseResult'
import * as ParseResult from 'effect/ParseResult'
import * as Schema from 'effect/Schema'

// ── Draft types (Workout.Encoded-shaped, work/rest as strings) ───────────

export type DraftRound = {
  readonly workSeconds: string
  readonly restSeconds: string
}

export type DraftStation = {
  readonly name: string
  readonly detail?: string
}

export type DraftPod = {
  readonly name: string
  readonly stations: readonly DraftStation[]
}

export type DraftFlow = {
  readonly type: 'laps' | 'sets'
  readonly rounds: readonly DraftRound[]
}

export type DraftWorkout = {
  readonly name: string
  readonly focus: string
  readonly note?: string
  readonly pods: readonly DraftPod[]
  readonly flow: DraftFlow
}

// ── Uniform expand / collapse ────────────────────────────────────────────

/**
 * Expand to a uniform ladder: every round copies round 1's current work/rest.
 * Used when the editor turns "uniform" off and needs N identical pairs.
 */
export function expandUniform(flow: DraftFlow, count: number): DraftFlow {
  const n = Math.max(1, Math.trunc(count))
  const first = flow.rounds[0] ?? { workSeconds: '', restSeconds: '' }
  const pair: DraftRound = {
    workSeconds: first.workSeconds,
    restSeconds: first.restSeconds,
  }
  return {
    ...flow,
    rounds: Array.from({ length: n }, () => ({ ...pair })),
  }
}

/**
 * Collapse a multi-round flow to a single round keeping round 1's pair
 * (discards rounds 2+). Used when turning "uniform" on.
 */
export function collapseUniform(flow: DraftFlow): DraftFlow {
  const first = flow.rounds[0] ?? { workSeconds: '', restSeconds: '' }
  return {
    ...flow,
    rounds: [
      {
        workSeconds: first.workSeconds,
        restSeconds: first.restSeconds,
      },
    ],
  }
}

/**
 * Toggle uniform mode: multi-round → collapse to round 1; single-round →
 * expand to `targetRoundCount` copies of round 1.
 */
export function toggleUniform(flow: DraftFlow, targetRoundCount: number): DraftFlow {
  if (flow.rounds.length > 1) {
    return collapseUniform(flow)
  }
  return expandUniform(flow, targetRoundCount)
}

// ── Round-count change (non-uniform ladder length) ───────────────────────

/**
 * Grow or shrink the ladder. Growth seeds each new round from the current
 * last round (not round 1). Shrink truncates to the first `count` rounds.
 * Clamps to at least 1 round defensively.
 */
export function setRoundCount(flow: DraftFlow, count: number): DraftFlow {
  const n = Math.max(1, Math.trunc(count))
  if (n === flow.rounds.length) {
    return flow
  }
  if (n < flow.rounds.length) {
    return { ...flow, rounds: flow.rounds.slice(0, n) }
  }
  const last = flow.rounds.at(-1) ?? {
    workSeconds: '',
    restSeconds: '',
  }
  const seed: DraftRound = {
    workSeconds: last.workSeconds,
    restSeconds: last.restSeconds,
  }
  const rounds = [...flow.rounds]
  while (rounds.length < n) {
    rounds.push({ ...seed })
  }
  return { ...flow, rounds }
}

// ── Decode ───────────────────────────────────────────────────────────────

/**
 * Convert a draft second string to a number for schema decode.
 * Empty / whitespace → NaN so both work and rest fail cleanly ('' would
 * otherwise become 0 via `Number`, wrongly accepting empty rest as valid).
 */
const parseSeconds = (value: string): number => {
  if (value.trim() === '') {
    return Number.NaN
  }
  return Number(value)
}

/** Build a Workout.Encoded-shaped plain object from the stringy draft. */
const draftToEncoded = (draft: DraftWorkout): unknown => ({
  name: draft.name,
  focus: draft.focus,
  ...(draft.note === undefined ? {} : { note: draft.note }),
  pods: draft.pods.map((pod) => ({
    name: pod.name,
    stations: pod.stations.map((station) => ({
      name: station.name,
      ...(station.detail === undefined ? {} : { detail: station.detail }),
    })),
  })),
  flow: {
    type: draft.flow.type,
    rounds: draft.flow.rounds.map((round) => ({
      workSeconds: parseSeconds(round.workSeconds),
      restSeconds: parseSeconds(round.restSeconds),
    })),
  },
})

const firstErrorMessage = (error: ParseError): string => {
  const first = ParseResult.ArrayFormatter.formatErrorSync(error).at(0)
  if (first === undefined) {
    return ParseResult.TreeFormatter.formatErrorSync(error)
  }
  return first.message
}

/**
 * Convert draft string fields → numbers, then `Schema.decodeUnknown(Workout)`.
 * Success: Right(Workout). Failure: Left(first schema-error message).
 */
export function decodeDraft(draft: DraftWorkout): Either.Either<Workout, string> {
  const result = Schema.decodeUnknownEither(Workout)(draftToEncoded(draft))
  return Either.mapLeft(result, firstErrorMessage)
}

// ── Summary chip ─────────────────────────────────────────────────────────

/** MM:SS, rounding up to the next whole second (same as `formatDuration` in workouts.ts). */
const formatDuration = (totalDurationMillis: number): string => {
  const totalSeconds = Math.ceil(totalDurationMillis / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/**
 * Live summary for the editor chip: `N works · MM:SS` when the draft
 * decodes; `null` when it does not (no fabricated summary).
 */
export function summarizeDraft(draft: DraftWorkout): string | null {
  const decoded = decodeDraft(draft)
  if (Either.isLeft(decoded)) {
    return null
  }
  const { workTotal, totalDurationMillis } = compile(decoded.right)
  return `${workTotal} works · ${formatDuration(totalDurationMillis)}`
}
