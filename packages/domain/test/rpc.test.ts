import { describe, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { expect } from 'vitest'

import { J45Rpcs, ServerInfo } from '../src/index.js'

describe('ServerInfo', () => {
  it.effect('round-trips through encode/decode', () =>
    Effect.gen(function* () {
      const original = new ServerInfo({
        sha: 'abc1234',
        version: '0.0.0',
        serverTime: yield* DateTime.now,
      })

      const encoded = yield* Schema.encode(ServerInfo)(original)
      const decoded = yield* Schema.decodeUnknown(ServerInfo)(encoded)

      expect(decoded).toStrictEqual(original)
    }),
  )
})

describe('J45Rpcs', () => {
  it('merges PublicRpcs, AccountRpcs, OwnerRpcs, LibraryRpcs, ExerciseRpcs, SessionRpcs, and HistoryRpcs', () => {
    const rpcs = J45Rpcs.requests
    expect(rpcs.size).toBe(26)
    expect(rpcs.has('ServerInfo')).toBe(true)
    expect(rpcs.has('Me')).toBe(true)
    expect(rpcs.has('ListUsers')).toBe(true)
    expect(rpcs.has('ListWorkouts')).toBe(true)
    expect(rpcs.has('ListExercises')).toBe(true)
    expect(rpcs.has('StartSession')).toBe(true)
    expect(rpcs.has('ListHistory')).toBe(true)
  })
})
