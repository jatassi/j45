import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'

import type { Segment } from './segments.js'

/**
 * `Schema.TaggedError` itself, referenced through a lowercase alias.
 * `eslint-plugin-unicorn`'s `throw-new-error` rule flags any call whose
 * callee name ends in "Error" as a missing `new` — a known false positive
 * for this exact two-step factory (it already special-cases `Data.TaggedError`
 * for the same reason: sindresorhus/eslint-plugin-unicorn#2654). The alias
 * changes nothing about the factory or the classes it produces below.
 */
const taggedError = Schema.TaggedError

/**
 * The new plan does not reach the work ordinal the old position held: it has
 * fewer works than the session has already run. Reported rather than clamped,
 * because clamping backwards would replay a Station the participant finished.
 * The caller ends the session instead.
 */
export class PlanExhausted extends taggedError<PlanExhausted>()('PlanExhausted', {
  workIndex: Schema.Int,
}) {}

const findWork = (segments: readonly Segment[], workIndex: number): number =>
  segments.findIndex((segment) => segment._tag === 'work' && segment.work.workIndex === workIndex)

const findRestBefore = (segments: readonly Segment[], workIndex: number): number =>
  segments.findIndex(
    (segment) => segment._tag === 'rest' && segment.nextWork.workIndex === workIndex,
  )

/**
 * Maps a timer position on one compiled workout onto the equivalent position
 * on another, so a running session can move to an edited plan without losing
 * the participant's place. Pure: it reads two segment lists and returns an
 * index into the second. The caller re-enters that segment at full duration.
 *
 * The key is the flat work ordinal (`WorkContext.workIndex`) that each work
 * and rest segment carries — how far into the plan the participant is, not
 * which Station they are on. There is deliberately no name-based or
 * identity-based anchoring: a Station is free text and carries no stable id,
 * so anchoring on identity would be defeated by a rename of the very Station
 * being remapped — the common edit this exists to serve.
 *
 * The consequence is worth stating: an edit that shifts the ordinals (an
 * insertion or a deletion before the current position, a reorder, a regroup)
 * holds the participant at the same distance into the plan, and the Station
 * at that distance can differ from the one they were on. An edit that leaves
 * the ordinals alone (a rename, a retime, a change after the current
 * position) holds both the distance and the Station.
 *
 * Segment by segment:
 * - `work` lands on the work with the same ordinal.
 * - `rest` lands on the rest before the same ordinal, or on the work itself
 *   when the new plan drops that rest (a round with no rest emits no segment).
 * - `ready` lands on the new plan's own `ready` — no work has run yet. An
 *   index outside the old plan carries no work context either, and lands
 *   there too.
 *
 * Fails with `PlanExhausted` when the new plan has no work at that ordinal.
 */
export const remapPosition = (
  from: readonly Segment[],
  segmentIndex: number,
  to: readonly Segment[],
): Either.Either<number, PlanExhausted> => {
  const current = from[segmentIndex]
  if (current === undefined || current._tag === 'ready') {
    return Either.right(0)
  }
  if (current._tag === 'rest') {
    const rest = findRestBefore(to, current.nextWork.workIndex)
    if (rest !== -1) {
      return Either.right(rest)
    }
  }
  const workIndex = current._tag === 'work' ? current.work.workIndex : current.nextWork.workIndex
  const work = findWork(to, workIndex)
  return work === -1 ? Either.left(new PlanExhausted({ workIndex })) : Either.right(work)
}
