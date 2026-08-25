import { describe, expect, it } from '@effect/vitest'
import { Participant, SessionId, SessionNotFound } from '@j45/domain'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as TestClock from 'effect/TestClock'

import { LiveSessions } from '../../src/session/live-sessions.js'
import { RECENTLY_ENDED_LIMIT } from '../../src/session/session-state.js'
import { asOwner, bobId, FlowLive, makeWorkout, owner, seedUser } from './plan-flow-harness.js'

/**
 * What a participant learns when they come back to a session that is already
 * over. Their socket dropped, the workout went while they were away, and the
 * watch they retry finds nothing.
 *
 * A session that ended is gone from the registry, so nothing about it can be
 * read off a handle. The server keeps a short record of how the last sessions
 * ended, and the failed watch answers from it. This is the only way the two
 * endings stay apart for the participant most likely to be confused by them.
 */

const bob = new Participant({ userId: bobId, displayName: 'Bob' })

/** Why a watch of an ended session says the session ended, or `undefined`. */
const watchFailure = (svc: LiveSessions, id: Parameters<LiveSessions['watch']>[0]) =>
  Effect.map(Effect.exit(Stream.runHead(svc.watch(id, bob))), (exit) => {
    if (!Exit.isFailure(exit)) {
      return undefined
    }
    const error = Cause.failureOption(exit.cause)
    return Option.isSome(error) && error.value instanceof SessionNotFound
      ? error.value.endedAs
      : undefined
  })

describe('watching a session that is already over', () => {
  it.scoped('says the plan was deleted, not merely that the session is gone', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      yield* seedUser(bob.userId, 'Bob')
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      // Bob is away — nobody holds a stream — when the workout goes.
      yield* TestClock.adjust('10 seconds')
      yield* library.DeleteWorkout({ id: created.id }, { headers })

      expect(yield* watchFailure(svc, started.id)).toBe('plan-deleted')
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('says an ordinary close for a session that simply stopped', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      yield* seedUser(bob.userId, 'Bob')
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      yield* svc.leaveSession(started.id, owner)

      expect(yield* watchFailure(svc, started.id)).toBe('closed')
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('says nothing about a session id the server never had', () =>
    Effect.gen(function* () {
      yield* asOwner
      yield* seedUser(bob.userId, 'Bob')
      const svc = yield* LiveSessions

      const unknown = Schema.decodeSync(SessionId)('never-existed')
      expect(yield* watchFailure(svc, unknown)).toBe(null)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('forgets the oldest endings once the record is full', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      yield* seedUser(bob.userId, 'Bob')
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )
      const svc = yield* LiveSessions

      // The record holds a fixed number of endings, so it cannot grow for the
      // life of the process. One ending more than it holds pushes the first
      // one out.
      const started = []
      for (let index = 0; index <= RECENTLY_ENDED_LIMIT; index++) {
        started.push(yield* sessions.StartSession({ workoutId: created.id }, { headers }))
      }
      for (const session of started) {
        yield* svc.leaveSession(session.id, owner)
      }

      const first = started[0]
      const last = started.at(-1)
      expect(first === undefined ? undefined : yield* watchFailure(svc, first.id)).toBe(null)
      expect(last === undefined ? undefined : yield* watchFailure(svc, last.id)).toBe('closed')
    }).pipe(Effect.provide(FlowLive)),
  )
})
