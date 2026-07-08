import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

/**
 * The minimal ambient shape of `Bun.password` (argon2id hashing plus a
 * constant-time verify) that `PinHashingLive` calls through. `bun-types`
 * isn't a dependency of this package — the production server runs under
 * Bun, but `bun run test`'s vitest workers run under Node (see `sql.ts`'s
 * `SqliteClientLive` comment for the same node/bun split) — so this
 * ambient declaration exists purely to typecheck the live layer below; the
 * real global is only ever present, and only ever called, inside a genuine
 * Bun process.
 */
declare const Bun: {
  readonly password: {
    readonly hash: (
      password: string,
      options: { readonly algorithm: 'argon2id' },
    ) => Promise<string>
    readonly verify: (password: string, hash: string) => Promise<boolean>
  }
}

/**
 * Hides the concrete PIN-hashing algorithm behind a seam so callers never
 * touch `Bun.password` (or any Node global) directly. `PinHashingLive`
 * (`Bun.password`, argon2id) is the only implementation shipped — there is
 * no in-memory fake, because there is nothing safe to fake: getting this
 * wrong means storing PINs in the clear.
 */
export class PinHashing extends Context.Tag('PinHashing')<
  PinHashing,
  {
    /** Hashes a plaintext PIN. Never returns the input unchanged. */
    readonly hash: (pin: string) => Effect.Effect<string>
    /** Constant-time comparison of a plaintext PIN against a stored hash. */
    readonly verify: (pin: string, hash: string) => Effect.Effect<boolean>
  }
>() {}

/**
 * `Bun.password` with argon2id defaults for both hashing and the
 * constant-time verify — the algorithm `docs/designs/auth-accounts`
 * pins for PIN storage.
 */
export const PinHashingLive: Layer.Layer<PinHashing> = Layer.succeed(PinHashing, {
  hash: (pin) => Effect.promise(() => Bun.password.hash(pin, { algorithm: 'argon2id' })),
  verify: (pin, hash) => Effect.promise(() => Bun.password.verify(pin, hash)),
})
