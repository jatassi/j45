import { RateLimited } from '@j45/domain'
import * as Clock from 'effect/Clock'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Ref from 'effect/Ref'

/**
 * A fixed-window limit: `limit` recorded failures within `window` locks the
 * key. Callers supply this per call — `http-routes` uses one pair for
 * `pin:<username>` (5 / 15 min) and a looser one for `invite:<ip>` (10 / 15
 * min) against the very same service.
 */
export type RateLimitOptions = {
  readonly limit: number
  readonly window: Duration.DurationInput
}

type Window = {
  readonly count: number
  readonly windowStartMillis: number
}

/**
 * In-memory fixed-window rate limiter. State is a single `Ref` of a
 * `Map<string, Window>`; every timestamp comes from Effect `Clock`, so
 * `TestClock` drives window expiry deterministically in tests and nothing
 * here ever reads the wall clock directly.
 *
 * Keys are opaque strings — this service knows nothing about `pin:` or
 * `invite:` prefixes; that naming, and the decision of when to call
 * `check`/`recordFailure`/`recordSuccess`, belongs entirely to callers
 * (`http-routes`).
 */
export class RateLimiter extends Effect.Service<RateLimiter>()('@j45/server/auth/RateLimiter', {
  effect: Effect.gen(function* () {
    const windows = yield* Ref.make(new Map<string, Window>())

    /**
     * Fails `RateLimited` (with an accurate `retryAfterSeconds`) when `key`
     * already has `limit` or more failures recorded within the current
     * `window`; a pure read otherwise — it never mutates state, so calling
     * it again (e.g. for what would otherwise be a correct attempt) reports
     * the same lock until the window elapses or a success resets it.
     */
    const check = (key: string, options: RateLimitOptions): Effect.Effect<void, RateLimited> =>
      Effect.gen(function* () {
        const entry = (yield* Ref.get(windows)).get(key)
        if (entry === undefined) {
          return
        }

        const now = yield* Clock.currentTimeMillis
        const windowMillis = Duration.toMillis(options.window)
        const elapsedMillis = now - entry.windowStartMillis
        if (elapsedMillis >= windowMillis || entry.count < options.limit) {
          return
        }

        const retryAfterSeconds = Math.ceil((windowMillis - elapsedMillis) / 1000)
        yield* Effect.fail(new RateLimited({ retryAfterSeconds }))
      })

    /**
     * Records a failed attempt against `key`: starts a fresh window (count
     * 1) if none exists yet or the previous one has fully elapsed,
     * otherwise increments the count within the current window.
     */
    const recordFailure = (key: string, options: RateLimitOptions): Effect.Effect<void> =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const windowMillis = Duration.toMillis(options.window)

        yield* Ref.update(windows, (map) => {
          const entry = map.get(key)
          const isFreshWindow = entry === undefined || now - entry.windowStartMillis >= windowMillis
          const next = new Map(map)
          next.set(
            key,
            isFreshWindow
              ? { count: 1, windowStartMillis: now }
              : { count: entry.count + 1, windowStartMillis: entry.windowStartMillis },
          )
          return next
        })
      })

    /** Records a successful attempt against `key`, resetting its counter. */
    const recordSuccess = (key: string): Effect.Effect<void> =>
      Ref.update(windows, (map) => {
        if (!map.has(key)) {
          return map
        }
        const next = new Map(map)
        next.delete(key)
        return next
      })

    return { check, recordFailure, recordSuccess } as const
  }),
}) {}
