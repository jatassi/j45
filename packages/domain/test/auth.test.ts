import { describe, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'
import { expect } from 'vitest'

import {
  Forbidden,
  InvalidCredentials,
  InvalidInvite,
  Pin,
  RateLimited,
  Unauthorized,
  Username,
  UsernameTaken,
} from '../src/auth.js'

describe('Username', () => {
  it('accepts 3-20 chars starting alphanumeric', () => {
    expect(Either.isRight(Schema.decodeUnknownEither(Username)('abc'))).toBe(true)
    expect(Either.isRight(Schema.decodeUnknownEither(Username)('a'.repeat(20)))).toBe(true)
    expect(Either.isRight(Schema.decodeUnknownEither(Username)('user_1.name-2'))).toBe(true)
  })

  it('rejects too-short, too-long, and non-alnum-starting values', () => {
    expect(Either.isLeft(Schema.decodeUnknownEither(Username)('ab'))).toBe(true)
    expect(Either.isLeft(Schema.decodeUnknownEither(Username)('a'.repeat(21)))).toBe(true)
    expect(Either.isLeft(Schema.decodeUnknownEither(Username)('_abc'))).toBe(true)
    expect(Either.isLeft(Schema.decodeUnknownEither(Username)('-abc'))).toBe(true)
  })
})

describe('Pin', () => {
  it('accepts exactly 4 digits', () => {
    expect(Either.isRight(Schema.decodeUnknownEither(Pin)('1234'))).toBe(true)
    expect(Either.isRight(Schema.decodeUnknownEither(Pin)('0000'))).toBe(true)
  })

  it('rejects too-short, too-long, and non-digit values', () => {
    expect(Either.isLeft(Schema.decodeUnknownEither(Pin)('123'))).toBe(true)
    expect(Either.isLeft(Schema.decodeUnknownEither(Pin)('12345'))).toBe(true)
    expect(Either.isLeft(Schema.decodeUnknownEither(Pin)('12a4'))).toBe(true)
  })
})

const roundTrips = <A, I>(schema: Schema.Schema<A, I>, original: A) =>
  Effect.gen(function* () {
    const encoded = yield* Schema.encode(schema)(original)
    const decoded = yield* Schema.decodeUnknown(schema)(encoded)
    expect(decoded).toStrictEqual(original)
  })

describe('tagged errors', () => {
  it.effect('round-trip through encode/decode', () =>
    Effect.all([
      roundTrips(Unauthorized, new Unauthorized()),
      roundTrips(Forbidden, new Forbidden()),
      roundTrips(InvalidCredentials, new InvalidCredentials()),
      roundTrips(InvalidInvite, new InvalidInvite()),
      roundTrips(UsernameTaken, new UsernameTaken()),
      roundTrips(RateLimited, new RateLimited({ retryAfterSeconds: 42 })),
    ]),
  )
})
