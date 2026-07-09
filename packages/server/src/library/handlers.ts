import type { Rpc } from '@effect/rpc'
import type { SqlError } from '@effect/sql/SqlError'
import { CurrentUser, LibraryRpcs, type LibraryWorkout } from '@j45/domain'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'
import * as Order from 'effect/Order'

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
  | Rpc.Handler<'DeleteWorkout'>,
  never,
  WorkoutsRepo
> = LibraryRpcs.toLayer(
  Effect.gen(function* () {
    const workoutsRepo = yield* WorkoutsRepo

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
          return yield* workoutsRepo.rename(id, user.id, name)
        }).pipe(Effect.catchTag('SqlError', asDefect)),

      DeleteWorkout: ({ id }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          yield* workoutsRepo.delete(id, user.id)
        }).pipe(Effect.catchTag('SqlError', asDefect)),
    }
  }),
)
