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
 * One user's record of one ended session. `workout` is the as-run snapshot
 * (post-reflow), so history stays truthful when the plan later changes.
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
}) {}
