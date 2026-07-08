import { describe, expect, it } from '@effect/vitest'
import { RateLimited } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import * as TestClock from 'effect/TestClock'

import type { RateLimitOptions } from '../../src/auth/rate-limiter.js'
import { RateLimiter } from '../../src/auth/rate-limiter.js'

const pinOptions: RateLimitOptions = { limit: 5, window: '15 minutes' }
const inviteOptions: RateLimitOptions = { limit: 10, window: '15 minutes' }

/** Records `count` failures for `key` against `options`, in sequence. */
const failMany = (
  limiter: RateLimiter,
  attempt: { readonly key: string; readonly options: RateLimitOptions; readonly count: number },
) =>
  Effect.forEach(
    Array.from({ length: attempt.count }),
    () => limiter.recordFailure(attempt.key, attempt.options),
    { discard: true },
  )

describe('RateLimiter', () => {
  it.effect(
    "5 recorded failures within the window fail `check` with an accurate retryAfterSeconds, and a later 'correct' attempt still sees the same lock",
    () =>
      Effect.gen(function* () {
        const limiter = yield* RateLimiter
        yield* failMany(limiter, { key: 'pin:alice', options: pinOptions, count: 5 })

        const first = yield* limiter.check('pin:alice', pinOptions).pipe(Effect.flip)
        expect(first).toBeInstanceOf(RateLimited)
        expect(first.retryAfterSeconds).toBe(15 * 60)

        // Nothing about a later "correct" attempt clears the lock by
        // itself — only an explicit recordSuccess does.
        const second = yield* limiter.check('pin:alice', pinOptions).pipe(Effect.flip)
        expect(second.retryAfterSeconds).toBe(15 * 60)
      }).pipe(Effect.provide(RateLimiter.Default)),
  )

  it.effect(
    'advancing the clock past the window unlocks the key, with retryAfterSeconds shrinking as time passes',
    () =>
      Effect.gen(function* () {
        const limiter = yield* RateLimiter
        yield* failMany(limiter, { key: 'pin:bob', options: pinOptions, count: 5 })
        yield* Effect.flip(limiter.check('pin:bob', pinOptions))

        yield* TestClock.adjust('14 minutes')
        const stillLocked = yield* limiter.check('pin:bob', pinOptions).pipe(Effect.flip)
        expect(stillLocked.retryAfterSeconds).toBe(60)

        yield* TestClock.adjust('1 minute')
        const unlocked = yield* Effect.either(limiter.check('pin:bob', pinOptions))
        expect(Either.isRight(unlocked)).toBe(true)
      }).pipe(Effect.provide(RateLimiter.Default)),
  )

  it.effect("a recorded success resets the key's counter", () =>
    Effect.gen(function* () {
      const limiter = yield* RateLimiter
      yield* failMany(limiter, { key: 'pin:carol', options: pinOptions, count: 4 })
      yield* limiter.recordSuccess('pin:carol')

      // Back below the limit — one more failure must not lock the key.
      yield* limiter.recordFailure('pin:carol', pinOptions)
      const result = yield* Effect.either(limiter.check('pin:carol', pinOptions))
      expect(Either.isRight(result)).toBe(true)
    }).pipe(Effect.provide(RateLimiter.Default)),
  )

  it.effect('rate-limits distinct keys independently', () =>
    Effect.gen(function* () {
      const limiter = yield* RateLimiter
      yield* failMany(limiter, { key: 'pin:dave', options: pinOptions, count: 5 })

      yield* Effect.flip(limiter.check('pin:dave', pinOptions))
      const untouched = yield* Effect.either(limiter.check('pin:erin', pinOptions))
      expect(Either.isRight(untouched)).toBe(true)
    }).pipe(Effect.provide(RateLimiter.Default)),
  )

  it.effect(
    'is generic over string keys, applying each call its own limit/window (pin:<username> vs invite:<ip>)',
    () =>
      Effect.gen(function* () {
        const limiter = yield* RateLimiter
        yield* failMany(limiter, { key: 'pin:frank', options: pinOptions, count: 5 })
        yield* failMany(limiter, { key: 'invite:203.0.113.5', options: inviteOptions, count: 9 })

        yield* Effect.flip(limiter.check('pin:frank', pinOptions))
        // invite:<ip> allows 10 before locking — 9 failures leave it open.
        const inviteStillOpen = yield* Effect.either(
          limiter.check('invite:203.0.113.5', inviteOptions),
        )
        expect(Either.isRight(inviteStillOpen)).toBe(true)
      }).pipe(Effect.provide(RateLimiter.Default)),
  )
})
