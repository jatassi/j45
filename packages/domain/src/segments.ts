import type { NonEmptyReadonlyArray } from 'effect/Array'
import type * as Equivalence from 'effect/Equivalence'
import * as Schema from 'effect/Schema'

import { Station, type Workout } from './workout.js'

/** Leading countdown before the first work segment, in seconds. */
export const READY_SECONDS = 5

/** Everything a work or rest segment needs to say "which work is this". */
export class WorkContext extends Schema.Class<WorkContext>('WorkContext')({
  station: Station,
  podIndex: Schema.Int,
  podName: Schema.String,
  stationInPod: Schema.Int,
  round: Schema.Int,
  workIndex: Schema.Int,
}) {}

export class ReadySegment extends Schema.TaggedClass<ReadySegment>()('ready', {
  durationMillis: Schema.Int,
}) {}
export class WorkSegment extends Schema.TaggedClass<WorkSegment>()('work', {
  durationMillis: Schema.Int,
  work: WorkContext,
}) {}
export class RestSegment extends Schema.TaggedClass<RestSegment>()('rest', {
  durationMillis: Schema.Int,
  nextWork: WorkContext,
}) {}
export const Segment = Schema.Union(ReadySegment, WorkSegment, RestSegment)
export type Segment = typeof Segment.Type

export class CompiledWorkout extends Schema.Class<CompiledWorkout>('CompiledWorkout')({
  segments: Schema.NonEmptyArray(Segment),
  workTotal: Schema.Int,
  totalDurationMillis: Schema.Int,
}) {}

/**
 * Structural equality on compiled plans — whether two stored workouts give a
 * participant the same thing to run.
 *
 * The workout *name* is not in a compiled plan, so two workouts that differ
 * only by name are equal here. That is the point: a new name is a rename, and
 * a rename changes nothing anyone runs.
 */
export const compiledEquals: Equivalence.Equivalence<CompiledWorkout> =
  Schema.equivalence(CompiledWorkout)

/**
 * Structural equality on one segment — whether two plans give a participant
 * the same interval to run at some position.
 *
 * Same kind, same duration, and the same work context: the station, its pod,
 * its place in the pod, its round, and its ordinal. A segment that is equal
 * under this is one that nothing the participant is doing has changed.
 *
 * A plan change reads it to decide whether a paused countdown must restart.
 */
export const segmentsEqual: Equivalence.Equivalence<Segment> = Schema.equivalence(Segment)

type WorkEntry = {
  readonly context: WorkContext
  readonly workSeconds: number
  readonly restSeconds: number
}

type FlatStation = {
  readonly station: Station
  readonly podIndex: number
  readonly podName: string
  readonly stationInPod: number
}

export const flattenStations = (workout: Workout): readonly FlatStation[] =>
  workout.pods.flatMap((pod, podIndex) =>
    pod.stations.map((station, index) => ({
      station,
      podIndex,
      podName: pod.name,
      stationInPod: index + 1,
    })),
  )

// Pod-major: every round of a pod finishes before the next pod starts; within
// a round, its stations run in order.
const buildLapsWorks = (workout: Workout): readonly WorkEntry[] => {
  const entries: WorkEntry[] = []
  let workIndex = 0
  for (const [podIndex, pod] of workout.pods.entries()) {
    for (const [roundIndex, { workSeconds, restSeconds }] of workout.flow.rounds.entries()) {
      for (const [index, station] of pod.stations.entries()) {
        const context = new WorkContext({
          station,
          podIndex,
          podName: pod.name,
          stationInPod: index + 1,
          round: roundIndex + 1,
          workIndex: workIndex++,
        })
        entries.push({ context, workSeconds, restSeconds })
      }
    }
  }
  return entries
}

// Station-major: every round of a station finishes before the next station,
// over the pods flattened in order.
const buildSetsWorks = (workout: Workout): readonly WorkEntry[] => {
  const entries: WorkEntry[] = []
  let workIndex = 0
  for (const flat of flattenStations(workout)) {
    for (const [roundIndex, { workSeconds, restSeconds }] of workout.flow.rounds.entries()) {
      entries.push({
        context: new WorkContext({ ...flat, round: roundIndex + 1, workIndex: workIndex++ }),
        workSeconds,
        restSeconds,
      })
    }
  }
  return entries
}

const buildWorks = (workout: Workout): readonly WorkEntry[] =>
  workout.flow.type === 'laps' ? buildLapsWorks(workout) : buildSetsWorks(workout)

/**
 * Compiles a workout into the flat, timed sequence a session runs: one
 * leading `ready` segment, then each work in order with a `rest` after it —
 * except after the very last work of the whole workout, and except when the
 * completed round's rest is `0` (omitted, never a zero-length segment). The
 * rest's duration is always the round of the work that just finished, not
 * the one about to start. Total: every schema-valid `Workout` compiles.
 */
export const compile = (workout: Workout): CompiledWorkout => {
  const works = buildWorks(workout)
  const segments: [Segment, ...Segment[]] = [
    new ReadySegment({ durationMillis: READY_SECONDS * 1000 }),
  ]
  works.forEach((entry, index) => {
    segments.push(
      new WorkSegment({ durationMillis: entry.workSeconds * 1000, work: entry.context }),
    )
    const nextEntry = works[index + 1]
    if (nextEntry && entry.restSeconds > 0) {
      segments.push(
        new RestSegment({ durationMillis: entry.restSeconds * 1000, nextWork: nextEntry.context }),
      )
    }
  })
  return new CompiledWorkout({
    segments: segments satisfies NonEmptyReadonlyArray<Segment>,
    workTotal: works.length,
    totalDurationMillis: segments.reduce((sum, segment) => sum + segment.durationMillis, 0),
  })
}
