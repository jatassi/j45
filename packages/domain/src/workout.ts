import * as Schema from 'effect/Schema'

/**
 * One repetition of a lap or set: how long the work interval runs and how
 * long the rest after it lasts. `restSeconds` of `0` is legal — it means
 * "no rest", and the compiler omits the segment entirely rather than emit a
 * zero-length one.
 */
export class Round extends Schema.Class<Round>('Round')({
  workSeconds: Schema.Int.pipe(Schema.positive()),
  restSeconds: Schema.Int.pipe(Schema.nonNegative()),
}) {}

/**
 * A single exercise. Plain text only — no inline HTML. `detail` carries a
 * parenthetical aside (e.g. a substitution note) as its own field so
 * presentation markup stays the client's job.
 */
export class Station extends Schema.Class<Station>('Station')({
  name: Schema.NonEmptyTrimmedString,
  detail: Schema.optional(Schema.String),
}) {}

/** A group of stations run together as one circuit. */
export class Pod extends Schema.Class<Pod>('Pod')({
  name: Schema.NonEmptyTrimmedString,
  stations: Schema.NonEmptyArray(Station),
}) {}

/** `laps`: pod-major traversal. `sets`: station-major traversal. */
export const FlowType = Schema.Literal('laps', 'sets')
export type FlowType = typeof FlowType.Type

export const flowTypeLabel: Record<FlowType, string> = { laps: 'Laps', sets: 'Sets' }

/**
 * The lap/set structure of a workout. `rounds.length` *is* the lap or set
 * count — there is no separate counter to keep in sync, and no distinction
 * between "uniform" and "ladder" rounds; uniform is just all rounds equal.
 */
export class Flow extends Schema.Class<Flow>('Flow')({
  type: FlowType,
  rounds: Schema.NonEmptyArray(Round),
}) {}

export const Focus = Schema.Literal('cardio', 'strength', 'hybrid')
export type Focus = typeof Focus.Type

export const focusLabel: Record<Focus, string> = {
  cardio: 'Cardio',
  strength: 'Strength',
  hybrid: 'Hybrid',
}

/**
 * A complete workout: its pods and the flow that sequences their stations.
 * A value object — no identity, no ownership; those arrive with whatever
 * wraps this type for persistence.
 */
export class Workout extends Schema.Class<Workout>('Workout')({
  name: Schema.NonEmptyTrimmedString,
  focus: Focus,
  note: Schema.optional(Schema.String),
  pods: Schema.NonEmptyArray(Pod),
  flow: Flow,
}) {}
