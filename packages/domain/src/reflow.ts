import type { NonEmptyArray } from 'effect/Array'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'

import { flattenStations } from './segments.js'
import { Flow, FlowType, Pod, Round, Workout } from './workout.js'
import type { Station } from './workout.js'

/**
 * `Schema.TaggedError` itself, referenced through a lowercase alias.
 * `eslint-plugin-unicorn`'s `throw-new-error` rule flags any call whose
 * callee name ends in "Error" as a missing `new` — a known false positive
 * for this exact two-step factory (it already special-cases `Data.TaggedError`
 * for the same reason: sindresorhus/eslint-plugin-unicorn#2654). The alias
 * changes nothing about the factory or the classes it produces below.
 */
const taggedError = Schema.TaggedError

/** One pod of the reflowed workout: a name plus references into the source
 *  workout's stations by flattened index (pod order, then station order —
 *  the same order `segments.ts` flattens). */
export class ReflowPod extends Schema.Class<ReflowPod>('ReflowPod')({
  name: Schema.NonEmptyTrimmedString,
  stations: Schema.NonEmptyArray(Schema.Int.pipe(Schema.nonNegative())),
}) {}

/** A regrouping of a workout: new pod boundaries over the source stations
 *  (reorder and drop allowed — an index used at most once; duplication is
 *  out of scope), a flow type, and optional retiming. `rounds` absent means
 *  the source workout's rounds carry over unchanged. */
export class Reflow extends Schema.Class<Reflow>('Reflow')({
  pods: Schema.NonEmptyArray(ReflowPod),
  flowType: FlowType,
  rounds: Schema.optional(Schema.NonEmptyArray(Round)),
}) {}

/** A spec that does not fit its source workout (index out of range, index
 *  referenced twice). Carries a human-readable reason. */
export class ReflowInvalid extends taggedError<ReflowInvalid>()('ReflowInvalid', {
  reason: Schema.String,
}) {}

type FlatSource = ReturnType<typeof flattenStations>

const outOfRange = (index: number, count: number): ReflowInvalid =>
  new ReflowInvalid({
    reason: `Station index ${index} is out of range (source has ${count} stations)`,
  })

const duplicated = (index: number): ReflowInvalid =>
  new ReflowInvalid({
    reason: `Station index ${index} is referenced more than once`,
  })

const resolvePod = (
  reflowPod: ReflowPod,
  flat: FlatSource,
  seen: Set<number>,
): Either.Either<Pod, ReflowInvalid> => {
  const stations: Station[] = []
  for (const index of reflowPod.stations) {
    if (index < 0 || index >= flat.length) {
      return Either.left(outOfRange(index, flat.length))
    }
    if (seen.has(index)) {
      return Either.left(duplicated(index))
    }
    seen.add(index)
    const entry = flat[index]
    if (entry === undefined) {
      return Either.left(outOfRange(index, flat.length))
    }
    stations.push(entry.station)
  }
  const [head, ...tail] = stations
  if (head === undefined) {
    // Schema forbids empty pods; defensive for the type checker.
    return Either.left(new ReflowInvalid({ reason: 'Reflow pod has no stations' }))
  }
  return Either.right(
    new Pod({
      name: reflowPod.name,
      stations: [head, ...tail] satisfies NonEmptyArray<Station>,
    }),
  )
}

export const applyReflow = (
  workout: Workout,
  reflow: Reflow,
): Either.Either<Workout, ReflowInvalid> => {
  const flat = flattenStations(workout)
  const seen = new Set<number>()
  const pods: Pod[] = []

  for (const reflowPod of reflow.pods) {
    const resolved = resolvePod(reflowPod, flat, seen)
    if (Either.isLeft(resolved)) {
      return Either.left(resolved.left)
    }
    pods.push(resolved.right)
  }

  const [headPod, ...tailPods] = pods
  if (headPod === undefined) {
    // Schema forbids empty reflow.pods; defensive for the type checker.
    return Either.left(new ReflowInvalid({ reason: 'Reflow has no pods' }))
  }

  return Either.right(
    new Workout({
      name: workout.name,
      focus: workout.focus,
      note: workout.note,
      pods: [headPod, ...tailPods] satisfies NonEmptyArray<Pod>,
      flow: new Flow({
        type: reflow.flowType,
        rounds: reflow.rounds ?? workout.flow.rounds,
      }),
    }),
  )
}
