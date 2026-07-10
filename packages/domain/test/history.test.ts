import { describe, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import * as SchemaAST from 'effect/SchemaAST'
import { expect } from 'vitest'

import { UserId } from '../src/auth.js'
import { CompletionId, SessionCompletion } from '../src/history.js'
import { HistoryRpcs, J45Rpcs } from '../src/rpc.js'
import { Participant, SessionId } from '../src/session.js'
import { Flow, Pod, Round, Station, Workout } from '../src/workout.js'

describe('CompletionId', () => {
  it('is a branded string schema', () => {
    const id = Schema.decodeSync(CompletionId)('completion-1')
    expect(id).toBe('completion-1')
    // Brand is carried as an AST annotation (not a Refinement) in this Effect version.
    const brand = CompletionId.ast.annotations[SchemaAST.BrandAnnotationId]
    expect(brand).toEqual(['CompletionId'])
  })
})

describe('SessionCompletion', () => {
  it.effect('round-trips through encode/decode', () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now
      const host = new Participant({
        userId: Schema.decodeSync(UserId)('user-1'),
        displayName: 'Alex',
      })
      const guest = new Participant({
        userId: Schema.decodeSync(UserId)('user-2'),
        displayName: 'Blake',
      })
      const workout = new Workout({
        name: 'Athletica',
        focus: 'cardio',
        pods: [new Pod({ name: 'Pod 1', stations: [new Station({ name: 'Burpee' })] })],
        flow: new Flow({
          type: 'laps',
          rounds: [new Round({ workSeconds: 40, restSeconds: 20 })],
        }),
      })
      const original = new SessionCompletion({
        id: Schema.decodeSync(CompletionId)('completion-1'),
        sessionId: Schema.decodeSync(SessionId)('session-1'),
        workoutName: 'Athletica',
        workout,
        host,
        participants: [host, guest],
        startedAt: now,
        endedAt: now,
      })

      const encoded = yield* Schema.encode(SessionCompletion)(original)
      const decoded = yield* Schema.decodeUnknown(SessionCompletion)(encoded)

      expect(decoded).toStrictEqual(original)
    }),
  )
})

describe('HistoryRpcs', () => {
  it('exposes ListHistory only, guarded by AuthMiddleware, and is merged into J45Rpcs', () => {
    const rpcs = HistoryRpcs.requests
    expect(rpcs.size).toBe(1)
    expect(rpcs.has('ListHistory')).toBe(true)

    const listHistory = rpcs.get('ListHistory')
    expect(listHistory).toBeDefined()
    if (listHistory === undefined) {
      return
    }

    expect([...listHistory.middlewares].some((m) => m.key === 'AuthMiddleware')).toBe(true)

    // No payload: Rpc defaults to void.
    expect(listHistory.payloadSchema.ast._tag).toBe('VoidKeyword')

    // Handler-layer commit merges HistoryRpcs into the shared contract.
    expect(J45Rpcs.requests.has('ListHistory')).toBe(true)
    expect(J45Rpcs.requests.size).toBe(26)
  })
})
