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
  it('defines the ServerInfo rpc exactly once', () => {
    const rpcs = J45Rpcs.requests
    expect(rpcs.size).toBe(1)
    expect(rpcs.has('ServerInfo')).toBe(true)
  })
})
