import type { SqlClient } from '@effect/sql'
import type { SqlError } from '@effect/sql/SqlError'
import type { InviteCode } from '@j45/domain'
import type { ConfigError } from 'effect/ConfigError'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'

import { FirstRunInviteConfig } from '../config.js'
import { Invites } from './invites.js'
import { UserRepo } from './user-repo.js'

/**
 * The label the startup banner is keyed on — exported so
 * `test/auth/first-run.test.ts` can find it in captured stdout without
 * duplicating the exact banner text.
 */
export const FIRST_RUN_BANNER_LABEL = 'FIRST-RUN REGISTRATION INVITE'

/**
 * If `users` is empty and no unspent registration invite already exists,
 * mints a no-expiry first-run invite — `FIRST_RUN_INVITE`'s exact value
 * when set, a random code otherwise (`Invites.mint`'s `firstRun`/`code`
 * params) — and logs it in a boxed banner at `logWarning`, well above the
 * noise floor of ordinary request logs, so an operator reading a dev
 * console or `journalctl` can't miss it. A reset code can never be the
 * "unspent registration invite" this checks for — `reset_user_id` is a
 * foreign key into `users`, which is empty on this branch — but the filter
 * (`resetUserId === undefined`) documents that distinction explicitly
 * rather than leaning on the coincidence. Restarting while an unspent
 * invite still exists mints nothing new.
 */
const bootstrap = Effect.gen(function* () {
  const userRepo = yield* UserRepo
  const invites = yield* Invites

  const userCount = yield* userRepo.count()
  if (userCount > 0) {
    return
  }

  const unspentInvites = yield* invites.list()
  const hasUnspentRegistrationInvite = unspentInvites.some(
    (invite) => invite.resetUserId === undefined,
  )
  if (hasUnspentRegistrationInvite) {
    return
  }

  const pinnedCode = yield* FirstRunInviteConfig
  const invite = yield* invites.mint({
    firstRun: true,
    ...(Option.isSome(pinnedCode) && { code: pinnedCode.value as InviteCode }),
  })

  yield* Effect.logWarning(
    ['', '#'.repeat(64), `# ${FIRST_RUN_BANNER_LABEL}: ${invite.code}`, '#'.repeat(64), ''].join(
      '\n',
    ),
  )
})

/**
 * `Layer.effectDiscard` — the same shape `sql.ts`'s `MigratorLive` uses —
 * so merging this into `main.ts` runs `bootstrap` once at startup.
 * Requires `SqlClient.SqlClient` (via `Invites`/`UserRepo`, both of which
 * depend only on that generic tag): `main.ts` threads `SqlLive`'s output
 * into this layer with `provideMerge`, which is what guarantees `bootstrap`
 * never runs until `SqlLive`'s migrations (the `invites`/`users` tables)
 * already exist.
 */
export const FirstRunLive: Layer.Layer<never, SqlError | ConfigError, SqlClient.SqlClient> =
  Layer.effectDiscard(bootstrap).pipe(
    Layer.provide(Layer.mergeAll(Invites.Default, UserRepo.Default)),
  )
