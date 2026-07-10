/**
 * Launch-mode reflow draft: spec-shaped state and its pure transitions.
 *
 * Unlike the normal editor's `Workout.Encoded`-shaped draft
 * (`workout-editor-state.ts`), this draft is the `Reflow` *spec* itself —
 * pods of references into the source workout's flattened stations (by index,
 * pod order then station order, the order `segments.ts` flattens). Station
 * names/details are carried only for read-only display; the spec is built
 * from the immutable per-station `sourceIndex`, never re-derived from a
 * mutated `Workout` copy (which is where duplicate-index bugs would breed).
 *
 * `computeReflow` decodes the draft into a `Reflow`, applies it to the source
 * (`applyReflow` + `compile`), and returns one result the chip AND both exits
 * consume — recomputing per consumer would risk chip/save divergence.
 */

import { applyReflow, compile, Reflow } from '@j45/domain'
import type { CompiledWorkout, Workout } from '@j45/domain'
import * as Either from 'effect/Either'
import type { ParseError } from 'effect/ParseResult'
import * as ParseResult from 'effect/ParseResult'
import * as Schema from 'effect/Schema'

import { collapseUniform, expandUniform, setRoundCount } from '@/lib/workout-draft'
import type { DraftFlow, DraftRound } from '@/lib/workout-draft'

/** A monotonic key source; structural ops mint fresh ids, edits keep them. */
let idSeq = 0
const nextId = (): number => (idSeq += 1)

/** A reference to one source station: its flattened `sourceIndex` plus its
 *  name/detail for read-only display. */
export type RStation = {
  readonly id: number
  readonly sourceIndex: number
  readonly name: string
  readonly detail?: string
}

export type RPod = {
  readonly id: number
  readonly name: string
  readonly stations: readonly RStation[]
}

export type RRound = {
  readonly id: number
  readonly workSeconds: string
  readonly restSeconds: string
}

/**
 * `rounds`/`uniform`/`roundCountText` mirror the normal editor's round
 * machinery. `roundsOverridden` starts `false` so the source workout's timing
 * carries over (the spec omits `rounds`); any round edit flips it `true`,
 * making the spec carry the edited rounds.
 */
export type ReflowDraft = {
  readonly pods: readonly RPod[]
  readonly flowType: 'laps' | 'sets'
  readonly rounds: readonly RRound[]
  readonly uniform: boolean
  readonly roundCountText: string
  readonly roundsOverridden: boolean
}

/** The single result the chip and both exits consume: the decoded spec, the
 *  applied workout (for Save to plan), and the compiled timing (for the chip
 *  and Start session). */
export type ReflowResult = {
  readonly reflow: Reflow
  readonly workout: Workout
  readonly compiled: CompiledWorkout
}

/** A fresh draft that reproduces the source's pods/stations and flow, with
 *  rounds carried over (not yet overridden). Station indexes count pod-major
 *  then station order — the same order `segments.ts` flattens and
 *  `applyReflow` resolves. */
export const initReflowDraft = (workout: Workout): ReflowDraft => {
  let index = 0
  const pods = workout.pods.map((pod) => ({
    id: nextId(),
    name: pod.name,
    stations: pod.stations.map((station) => ({
      id: nextId(),
      sourceIndex: index++,
      name: station.name,
      ...(station.detail === undefined ? {} : { detail: station.detail }),
    })),
  }))
  const rounds = workout.flow.rounds.map((round) => ({
    workSeconds: String(round.workSeconds),
    restSeconds: String(round.restSeconds),
  }))
  const [first, ...rest] = rounds
  const uniform = rest.every(
    (round) => round.workSeconds === first.workSeconds && round.restSeconds === first.restSeconds,
  )
  return {
    pods,
    flowType: workout.flow.type,
    rounds: (uniform ? [first] : rounds).map((round) => ({ id: nextId(), ...round })),
    uniform,
    roundCountText: String(rounds.length),
    roundsOverridden: false,
  }
}

const updateAt = <T>(arr: readonly T[], index: number, fn: (value: T) => T): readonly T[] =>
  arr.map((value, i) => (i === index ? fn(value) : value))

const setPods = (draft: ReflowDraft, pods: readonly RPod[]): ReflowDraft => ({ ...draft, pods })

export const renamePod = (draft: ReflowDraft, index: number, name: string): ReflowDraft =>
  setPods(
    draft,
    updateAt(draft.pods, index, (pod) => ({ ...pod, name })),
  )

export const addPod = (draft: ReflowDraft): ReflowDraft =>
  setPods(draft, [
    ...draft.pods,
    { id: nextId(), name: `Pod ${draft.pods.length + 1}`, stations: [] },
  ])

export const removePod = (draft: ReflowDraft, index: number): ReflowDraft =>
  setPods(
    draft,
    draft.pods.filter((_, i) => i !== index),
  )

const podStations = (
  draft: ReflowDraft,
  podIndex: number,
  fn: (stations: readonly RStation[]) => readonly RStation[],
): ReflowDraft =>
  setPods(
    draft,
    updateAt(draft.pods, podIndex, (pod) => ({ ...pod, stations: fn(pod.stations) })),
  )

export const removeStation = (
  draft: ReflowDraft,
  podIndex: number,
  stationIndex: number,
): ReflowDraft => podStations(draft, podIndex, (st) => st.filter((_, i) => i !== stationIndex))

export type StationMove = {
  readonly podIndex: number
  readonly stationIndex: number
  readonly direction: -1 | 1
}

export const moveStation = (draft: ReflowDraft, args: StationMove): ReflowDraft =>
  podStations(draft, args.podIndex, (st) => {
    const target = args.stationIndex + args.direction
    if (target < 0 || target >= st.length) {
      return st
    }
    const copy = [...st]
    const moved = copy[args.stationIndex]
    copy[args.stationIndex] = copy[target]
    copy[target] = moved
    return copy
  })

export type StationPodMove = {
  readonly podIndex: number
  readonly stationIndex: number
  readonly targetPodIndex: number
}

/** Remove a station-reference from its pod and append it to another pod. */
export const moveStationToPod = (draft: ReflowDraft, args: StationPodMove): ReflowDraft => {
  const { podIndex, stationIndex, targetPodIndex } = args
  const inRange = (i: number) => i >= 0 && i < draft.pods.length
  if (!inRange(podIndex) || !inRange(targetPodIndex) || targetPodIndex === podIndex) {
    return draft
  }
  const sourceStations = draft.pods[podIndex].stations
  if (stationIndex < 0 || stationIndex >= sourceStations.length) {
    return draft
  }
  const station = sourceStations[stationIndex]
  const withoutSource = removeStation(draft, podIndex, stationIndex)
  return podStations(withoutSource, targetPodIndex, (st) => [...st, station])
}

export const setFlowType = (draft: ReflowDraft, type: 'laps' | 'sets'): ReflowDraft => ({
  ...draft,
  flowType: type,
})

const toDraftFlow = (draft: ReflowDraft): DraftFlow => ({
  type: draft.flowType,
  rounds: draft.rounds.map(({ workSeconds, restSeconds }) => ({ workSeconds, restSeconds })),
})

/** Adopt a draft flow's rounds (minting fresh ids) and mark rounds overridden. */
const withRounds = (draft: ReflowDraft, flow: DraftFlow): ReflowDraft => ({
  ...draft,
  flowType: flow.type,
  rounds: flow.rounds.map((round) => ({ id: nextId(), ...round })),
  roundsOverridden: true,
})

export const toggleUniform = (draft: ReflowDraft): ReflowDraft => {
  const flow = toDraftFlow(draft)
  if (draft.uniform) {
    const count = Number.parseInt(draft.roundCountText, 10) || 1
    return { ...withRounds(draft, expandUniform(flow, count)), uniform: false }
  }
  return {
    ...withRounds(draft, collapseUniform(flow)),
    uniform: true,
    roundCountText: String(draft.rounds.length),
  }
}

export const changeRoundCount = (draft: ReflowDraft, text: string): ReflowDraft => {
  if (draft.uniform) {
    return { ...draft, roundCountText: text, roundsOverridden: true }
  }
  const n = Number.parseInt(text, 10)
  if (Number.isNaN(n) || n < 1) {
    return { ...draft, roundCountText: text }
  }
  return { ...withRounds(draft, setRoundCount(toDraftFlow(draft), n)), roundCountText: text }
}

export const setRound = (
  draft: ReflowDraft,
  args: { readonly index: number; readonly patch: Partial<DraftRound> },
): ReflowDraft => ({
  ...draft,
  roundsOverridden: true,
  rounds: updateAt(draft.rounds, args.index, (round) => ({ ...round, ...args.patch })),
})

const parseSeconds = (value: string): number => (value.trim() === '' ? Number.NaN : Number(value))

/** The draft as a `Reflow.Encoded`-shaped plain object. `rounds` is present
 *  only when overridden — absent carries the source's rounds through. */
const buildReflowEncoded = (draft: ReflowDraft): unknown => {
  const flow = toDraftFlow(draft)
  const rounds = draft.uniform
    ? expandUniform(flow, Number.parseInt(draft.roundCountText, 10))
    : flow
  return {
    pods: draft.pods.map((pod) => ({
      name: pod.name,
      stations: pod.stations.map((station) => station.sourceIndex),
    })),
    flowType: draft.flowType,
    ...(draft.roundsOverridden
      ? {
          rounds: rounds.rounds.map((round) => ({
            workSeconds: parseSeconds(round.workSeconds),
            restSeconds: parseSeconds(round.restSeconds),
          })),
        }
      : {}),
  }
}

const firstError = (error: ParseError): string => {
  const first = ParseResult.ArrayFormatter.formatErrorSync(error).at(0)
  return first === undefined ? ParseResult.TreeFormatter.formatErrorSync(error) : first.message
}

/**
 * Decode the draft into a `Reflow`, apply it to the source, and compile —
 * one `Either` the chip and both exits share. `Left` when the draft is not a
 * valid spec (an empty pod, a blank pod name, an ill-typed round) or does not
 * fit the source; the caller disables its exits rather than crashing.
 */
export const computeReflow = (
  source: Workout,
  draft: ReflowDraft,
): Either.Either<ReflowResult, string> => {
  const decoded = Schema.decodeUnknownEither(Reflow)(buildReflowEncoded(draft))
  if (Either.isLeft(decoded)) {
    return Either.left(firstError(decoded.left))
  }
  const applied = applyReflow(source, decoded.right)
  if (Either.isLeft(applied)) {
    return Either.left(applied.left.reason)
  }
  return Either.right({
    reflow: decoded.right,
    workout: applied.right,
    compiled: compile(applied.right),
  })
}

/** MM:SS, rounding up to the next whole second — matching `workouts.ts`'s
 *  `formatDuration` and the normal editor's chip. Kept local so this pure
 *  module stays free of the rpc-client `workouts.ts` pulls in. */
const formatDuration = (totalDurationMillis: number): string => {
  const totalSeconds = Math.ceil(totalDurationMillis / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/** The `N works · MM:SS` chip text for a computed reflow. */
export const reflowSummary = (result: ReflowResult): string =>
  `${result.compiled.workTotal} works · ${formatDuration(result.compiled.totalDurationMillis)}`
