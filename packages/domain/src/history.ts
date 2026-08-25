import * as Schema from 'effect/Schema'

import { Participant, SessionId } from './session.js'
import { Workout } from './workout.js'

/**
 * Stable identity of one user's completion record for an ended session.
 * Distinct from `SessionId` — each participant gets their own row with a
 * freshly minted id when the session ends.
 */
export const CompletionId = Schema.String.pipe(Schema.brand('CompletionId'))
export type CompletionId = typeof CompletionId.Type

/**
 * How far a session got by the time a row was written — the furthest segment
 * reached against the as-run workout's segment count. `segmentsCompleted` is
 * the index of the furthest segment entered (the ready segment is `0`);
 * `totalSegments` is `compiled.segments.length` for the workout as run. Lets a
 * per-participant completion say "you made it to station N of M" even when the
 * leaver stopped mid-workout.
 */
export class CompletionProgress extends Schema.Class<CompletionProgress>('CompletionProgress')({
  segmentsCompleted: Schema.Int,
  totalSegments: Schema.Int,
}) {}

/**
 * One user's record of one ended session. `workout` is the as-run snapshot:
 * post-reflow, and the last plan applied while the timer was still live. A
 * change made after the timer is done never reaches it. `progress` is how far
 * the session got, counted in that same plan — optional, because rows written
 * before per-participant leave carry none.
 */
export class SessionCompletion extends Schema.Class<SessionCompletion>('SessionCompletion')({
  id: CompletionId,
  sessionId: SessionId,
  workoutName: Schema.NonEmptyTrimmedString,
  workout: Workout,
  host: Participant,
  participants: Schema.NonEmptyArray(Participant),
  startedAt: Schema.DateTimeUtc,
  endedAt: Schema.DateTimeUtc,
  progress: Schema.optional(CompletionProgress),
}) {}
