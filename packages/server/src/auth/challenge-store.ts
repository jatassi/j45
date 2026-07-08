import * as Clock from 'effect/Clock'
import * as Data from 'effect/Data'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Ref from 'effect/Ref'

/**
 * How long an issued WebAuthn challenge stays valid. The design pins this at
 * two minutes: long enough for a real user-verification prompt, short enough
 * that a captured options blob is useless by the time it could be replayed.
 */
export const CHALLENGE_TTL: Duration.Duration = Duration.minutes(2)

/**
 * `take` failed: the challenge was never issued, has passed its
 * `CHALLENGE_TTL`, or was already consumed by an earlier `take`. Callers
 * (`Passkeys`) map this to the domain's `InvalidCredentials`.
 */
export class ChallengeNotFound extends Data.TaggedError('ChallengeNotFound')<
  Record<string, never>
> {}

/**
 * In-memory, single-instance store for the one-time challenges that bind a
 * WebAuthn ceremony's start (`generate*Options`) to its finish (`verify*`).
 * A `Ref<Map>` keyed by the base64url challenge string, with each entry
 * carrying its expiry instant (from Effect `Clock`, so `TestClock` drives
 * TTL). `take` both validates and consumes: a challenge survives at most one
 * successful `take`, and never past its TTL — so a captured or replayed
 * challenge fails closed. A server restart mid-ceremony just means the user
 * retries; the design accepts that for a single-instance deployment.
 */
export class ChallengeStore extends Effect.Service<ChallengeStore>()('ChallengeStore', {
  effect: Effect.gen(function* () {
    const store = yield* Ref.make(new Map<string, number>())

    const remove = (challenge: string) =>
      Ref.update(store, (map) => {
        const next = new Map(map)
        next.delete(challenge)
        return next
      })

    /** Registers `challenge`, valid until `CHALLENGE_TTL` from now. */
    const put = (challenge: string) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const expiresAt = now + Duration.toMillis(CHALLENGE_TTL)
        yield* Ref.update(store, (map) => {
          const next = new Map(map)
          next.set(challenge, expiresAt)
          return next
        })
      })

    /**
     * Consumes `challenge`, returning it on success. Fails `ChallengeNotFound`
     * if it is unknown, expired, or already consumed. The entry is removed on
     * every attempt, so a second `take` of the same challenge always fails.
     */
    const take = (challenge: string) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const expiresAt = (yield* Ref.get(store)).get(challenge)
        if (expiresAt !== undefined) {
          yield* remove(challenge)
        }
        if (expiresAt === undefined || expiresAt <= now) {
          return yield* Effect.fail(new ChallengeNotFound({}))
        }
        return challenge
      })

    return { put, take } as const
  }),
}) {}
