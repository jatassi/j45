import type { Rpc } from '@effect/rpc'
import type { SqlError } from '@effect/sql/SqlError'
import { CurrentUser, ExerciseRpcs, type LibraryExercise } from '@j45/domain'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'
import * as Order from 'effect/Order'

import { ExercisesRepo } from './exercises-repo.js'

/**
 * A `SqlError` mid-request is infrastructure failing, not `ExerciseNotFound` —
 * turned into a defect so each handler's declared error channel stays
 * exactly `ExerciseNotFound` (or, for `ListExercises`/`CreateExercise`, no
 * typed error at all). Exactly `auth/passkeys.ts`'s `asDefect` idiom.
 */
const asDefect = (error: SqlError): Effect.Effect<never> => Effect.die(error)

/**
 * `ListExercises`' sort: `LibraryExercise.exercise.name`, compared
 * case-insensitively (via `Arr.sortWith`'s lowercased mapping over
 * `Order.string`, so this returns a fresh array rather than mutating the
 * repo's result — `Array#sort`/`Array#toSorted` are the two idiomatic
 * choices here, but `toSorted` needs `lib: es2023`, one target newer than
 * this repo's `tsconfig.json` pins). There is no denormalized name column
 * on the `exercises` table to `ORDER BY` in SQL (`exercises-repo.ts`'s `body`
 * is the only copy of the name) — every row is decoded first, then sorted
 * here.
 */
const sortByNameCaseInsensitive = (exercises: readonly LibraryExercise[]) =>
  Arr.sortWith(exercises, (exercise) => exercise.exercise.name.toLowerCase(), Order.string)

/**
 * Implements every `ExerciseRpcs` member in one `toLayer` — like
 * `LibraryHandlersLive`, no other task contributes to this group. Every
 * member scopes its `ExercisesRepo` call to `CurrentUser.id` (provided by
 * `AuthMiddleware`, guaranteed in context by `ExerciseRpcs`'s own
 * `.middleware(AuthMiddleware)`), so a caller only ever sees or mutates
 * their own exercises — `ExercisesRepo`'s `WHERE id = ? AND owner_id = ?`
 * queries make a foreign id and an absent one both fail `ExerciseNotFound`,
 * never `Forbidden`, so no rpc here leaks whether some other user's
 * exercise id exists at all.
 */
export const ExerciseHandlersLive: Layer.Layer<
  | Rpc.Handler<'ListExercises'>
  | Rpc.Handler<'CreateExercise'>
  | Rpc.Handler<'UpdateExercise'>
  | Rpc.Handler<'DeleteExercise'>,
  never,
  ExercisesRepo
> = ExerciseRpcs.toLayer(
  Effect.gen(function* () {
    const exercisesRepo = yield* ExercisesRepo

    return {
      ListExercises: () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const exercises = yield* exercisesRepo.listForOwner(user.id)
          return sortByNameCaseInsensitive(exercises)
        }).pipe(Effect.catchTag('SqlError', asDefect)),

      CreateExercise: ({ exercise }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          return yield* exercisesRepo.insert(user.id, exercise)
        }).pipe(Effect.catchTag('SqlError', asDefect)),

      UpdateExercise: ({ id, exercise }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          return yield* exercisesRepo.update(id, user.id, exercise)
        }).pipe(Effect.catchTag('SqlError', asDefect)),

      DeleteExercise: ({ id }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          yield* exercisesRepo.delete(id, user.id)
        }).pipe(Effect.catchTag('SqlError', asDefect)),
    }
  }),
)
