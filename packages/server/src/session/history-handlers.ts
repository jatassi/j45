import type { Rpc } from '@effect/rpc'
import type { SqlError } from '@effect/sql/SqlError'
import { CurrentUser, HistoryRpcs } from '@j45/domain'
import * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'

import { CompletionsRepo } from './completions-repo.js'

/**
 * A `SqlError` mid-request is infrastructure failing, not a declared rpc
 * error — turned into a defect so `ListHistory`'s declared error channel
 * stays empty. Exactly `session/handlers.ts`'s `asDefect` idiom.
 */
const asDefect = (error: SqlError): Effect.Effect<never> => Effect.die(error)

/**
 * Implements every `HistoryRpcs` member in one `toLayer` — a thin
 * wire-through onto `CompletionsRepo.listForUser` scoped to
 * `CurrentUser.id` (provided by `AuthMiddleware`, guaranteed in context by
 * `HistoryRpcs`'s own `.middleware(AuthMiddleware)`).
 */
export const HistoryHandlersLive: Layer.Layer<
  Rpc.Handler<'ListHistory'>,
  never,
  CompletionsRepo
> = HistoryRpcs.toLayer(
  Effect.gen(function* () {
    const completionsRepo = yield* CompletionsRepo

    return {
      ListHistory: () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          return yield* completionsRepo.listForUser(user.id)
        }).pipe(Effect.catchTag('SqlError', asDefect)),
    }
  }),
)
