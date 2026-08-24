import type { Rpc } from '@effect/rpc'
import type { SqlError } from '@effect/sql/SqlError'
import {
  CurrentUser,
  LibraryRpcs,
  type LibraryWorkout,
  type UserId,
  type WorkoutId,
  type WorkoutNotFound,
} from '@j45/domain'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'
import * as Order from 'effect/Order'

import { PlanChanges } from './plan-changes.js'
import { WorkoutsRepo } from './workouts-repo.js'

/**
 * A `SqlError` mid-request is infrastructure failing, not `WorkoutNotFound` —
 * turned into a defect so each handler's declared error channel stays
 * exactly `WorkoutNotFound` (or, for `ListWorkouts`, no typed error at all).
 * Exactly `auth/passkeys.ts`'s `asDefect` idiom.
 */
const asDefect = (error: SqlError): Effect.Effect<never> => Effect.die(error)

/**
 * `ListWorkouts`' sort: `LibraryWorkout.workout.name`, compared
 * case-insensitively (via `Arr.sortWith`'s lowercased mapping over
 * `Order.string`, so this returns a fresh array rather than mutating the
 * repo's result — `Array#sort`/`Array#toSorted` are the two idiomatic
 * choices here, but `toSorted` needs `lib: es2023`, one target newer than
 * this repo's `tsconfig.json` pins). There is no denormalized name column
 * on the `workouts` table to `ORDER BY` in SQL (`workouts-repo.ts`'s `body`
 * is the only copy of the name) — every row is decoded first, then sorted
 * here.
 */
const sortByNameCaseInsensitive = (workouts: readonly LibraryWorkout[]) =>
  Arr.sortWith(workouts, (workout) => workout.workout.name.toLowerCase(), Order.string)

/** `RenameWorkout`'s target: whose workout, which one, and its new name. */
type RenameInput = {
  readonly id: WorkoutId
  readonly name: string
  readonly ownerId: UserId
}

/**
 * Renames the caller's own workout, then announces the change.
 *
 * A stored plan that a live session runs must not go stale, so the new name
 * is published through `PlanChanges`. Whoever runs that plan consumes the
 * announcement; this module keeps its dependency set and does not know that
 * live sessions exist. It mirrors the session-ended seam, which runs the
 * other way.
 *
 * The announcement follows the write, so a consumer never sees a name that
 * the store does not hold. It carries the stored name back from the repo for
 * the same reason.
 */
const renameAndAnnounce = (
  workoutsRepo: WorkoutsRepo,
  planChanges: PlanChanges,
  input: RenameInput,
): Effect.Effect<LibraryWorkout, WorkoutNotFound | SqlError> =>
  Effect.gen(function* () {
    const renamed = yield* workoutsRepo.rename(input.id, input.ownerId, input.name)
    yield* planChanges.publish({
      _tag: 'renamed',
      workoutId: renamed.id,
      name: renamed.workout.name,
    })
    return renamed
  })

/**
 * Implements every `LibraryRpcs` member in one `toLayer` — like
 * `OwnerHandlersLive`, no other task contributes to this group. Every
 * member scopes its `WorkoutsRepo` call to `CurrentUser.id` (provided by
 * `AuthMiddleware`, guaranteed in context by `LibraryRpcs`'s own
 * `.middleware(AuthMiddleware)`), so a caller only ever sees or mutates
 * their own workouts — `WorkoutsRepo`'s `WHERE id = ? AND owner_id = ?`
 * queries make a foreign id and an absent one both fail `WorkoutNotFound`,
 * never `Forbidden`, so no rpc here leaks whether some other user's
 * workout id exists at all.
 */
export const LibraryHandlersLive: Layer.Layer<
  | Rpc.Handler<'ListWorkouts'>
  | Rpc.Handler<'GetWorkout'>
  | Rpc.Handler<'DuplicateWorkout'>
  | Rpc.Handler<'RenameWorkout'>
  | Rpc.Handler<'DeleteWorkout'>
  | Rpc.Handler<'CreateWorkout'>
  | Rpc.Handler<'UpdateWorkout'>,
  never,
  WorkoutsRepo | PlanChanges
> = LibraryRpcs.toLayer(
  Effect.gen(function* () {
    const workoutsRepo = yield* WorkoutsRepo
    const planChanges = yield* PlanChanges

    return {
      ListWorkouts: () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const workouts = yield* workoutsRepo.listForOwner(user.id)
          return sortByNameCaseInsensitive(workouts)
        }).pipe(Effect.catchTag('SqlError', asDefect)),

      GetWorkout: ({ id }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          return yield* workoutsRepo.getOwned(id, user.id)
        }).pipe(Effect.catchTag('SqlError', asDefect)),

      DuplicateWorkout: ({ id }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          return yield* workoutsRepo.duplicate(id, user.id)
        }).pipe(Effect.catchTag('SqlError', asDefect)),

      RenameWorkout: ({ id, name }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          return yield* renameAndAnnounce(workoutsRepo, planChanges, { id, name, ownerId: user.id })
        }).pipe(Effect.catchTag('SqlError', asDefect)),

      DeleteWorkout: ({ id }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          yield* workoutsRepo.delete(id, user.id)
        }).pipe(Effect.catchTag('SqlError', asDefect)),

      CreateWorkout: ({ workout }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          return yield* workoutsRepo.insert(user.id, workout)
        }).pipe(Effect.catchTag('SqlError', asDefect)),

      // `updatedAt` is the version the caller read: the repo makes it a
      // precondition, so a save built on a stale read fails `WorkoutConflict`
      // instead of clobbering whoever wrote in between.
      UpdateWorkout: ({ id, workout, updatedAt }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          return yield* workoutsRepo.update({
            id,
            ownerId: user.id,
            workout,
            expectedUpdatedAt: updatedAt,
          })
        }).pipe(Effect.catchTag('SqlError', asDefect)),
    }
  }),
)
