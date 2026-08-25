import { describe, expect, it } from '@effect/vitest'
import { Participant, type SessionId, type SessionSummary } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as TestClock from 'effect/TestClock'

import { LiveSessions } from '../../src/session/live-sessions.js'
import { asOwner, bobId, FlowLive, makeWorkout, owner, seedUser } from './plan-flow-harness.js'

/**
 * The lobby feed, observed only where a subscriber can see it: the listings
 * `watchLobby` emits, in order. Nothing here asserts how the feed is built —
 * the signal plumbing behind it is implementation and will move.
 *
 * Sessions are started through the rpc contract, over the same merged handler
 * layers `server.ts` wires; the feed itself is consumed on the service, never
 * through the rpc test client, because a stream taken through that client
 * deadlocks against unary calls on the same client.
 */

const bob = new Participant({ userId: bobId, displayName: 'Bob' })

/** The lobby feed as a queue of the listings it emits. */
const openLobby = (svc: LiveSessions) =>
  Stream.toQueueOfElements(svc.watchLobby(), { capacity: 64 })

type LobbyQueue = Queue.Dequeue<Exit.Exit<readonly SessionSummary[], Option.Option<never>>>

/** The next listing the feed emits. */
const nextLobby = (queue: LobbyQueue): Effect.Effect<readonly SessionSummary[]> =>
  Effect.orDie(Effect.flatten(Queue.take(queue)))

const idsOf = (rows: readonly SessionSummary[]): readonly SessionId[] => rows.map((row) => row.id)

const rowFor = (rows: readonly SessionSummary[], id: SessionId) => rows.find((row) => row.id === id)

/** Lets every runnable fiber finish, so an emission that is coming has landed. */
const settle = Effect.repeatN(Effect.yieldNow(), 50)

/**
 * Opens a session watch in a closeable scope and pulls its first element, so
 * the join has landed by the time this returns. Closing the scope leaves.
 */
const openWatch = (svc: LiveSessions, id: SessionId, participant: Participant) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const pull = yield* Scope.extend(scope)(Stream.toPull(svc.watch(id, participant)))
    yield* pull
    return scope
  })

describe('the live-session lobby feed', () => {
  it.scoped('opens on the sessions that are live when the subscriber arrives', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )
      const first = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const second = yield* sessions.StartSession({ workoutId: created.id }, { headers })

      const opening = yield* nextLobby(yield* openLobby(yield* LiveSessions))

      expect(opening).toHaveLength(2)
      expect(idsOf(opening)).toContain(first.id)
      expect(idsOf(opening)).toContain(second.id)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('a session that starts later reaches a subscriber that is already open', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )

      const lobby = yield* openLobby(yield* LiveSessions)
      expect(yield* nextLobby(lobby)).toEqual([])

      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })

      expect(idsOf(yield* nextLobby(lobby))).toEqual([started.id])
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('a session its last participant leaves disappears from the feed', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })

      const svc = yield* LiveSessions
      const lobby = yield* openLobby(svc)
      expect(yield* nextLobby(lobby)).toHaveLength(1)

      yield* svc.leaveSession(started.id, owner)

      expect(yield* nextLobby(lobby)).toEqual([])
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('a session the idle collector ends disappears, and the feed joined none of it', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })

      const svc = yield* LiveSessions
      const lobby = yield* openLobby(svc)
      expect(yield* nextLobby(lobby)).toHaveLength(1)

      // Watching the lobby is not watching a session: nobody is present, so
      // the collector still ends this one on its own 60-second clock.
      expect((yield* svc.snapshot(started.id)).participants).toEqual([])
      yield* TestClock.adjust('60 seconds')

      expect(yield* nextLobby(lobby)).toEqual([])
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('a participant joining and leaving an existing session moves its count', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      yield* seedUser(bob.userId, 'Bob')
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })

      const svc = yield* LiveSessions
      const lobby = yield* openLobby(svc)
      expect(rowFor(yield* nextLobby(lobby), started.id)?.participantCount).toBe(0)

      const watching = yield* openWatch(svc, started.id, bob)
      expect(rowFor(yield* nextLobby(lobby), started.id)?.participantCount).toBe(1)

      yield* Scope.close(watching, Exit.void)
      expect(rowFor(yield* nextLobby(lobby), started.id)?.participantCount).toBe(0)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('renaming the workout moves the name on its lobby row', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B'], {}, 'Old') },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })

      const lobby = yield* openLobby(yield* LiveSessions)
      expect(rowFor(yield* nextLobby(lobby), started.id)?.workoutName).toBe('Old')

      yield* library.RenameWorkout({ id: created.id, name: 'New' }, { headers })

      expect(rowFor(yield* nextLobby(lobby), started.id)?.workoutName).toBe('New')
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('a ticker advance alone moves no lobby row', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })

      const svc = yield* LiveSessions
      const lobby = yield* openLobby(svc)
      expect(yield* nextLobby(lobby)).toHaveLength(1)

      // Ready is 5s: the ticker crosses into work and republishes the session.
      yield* TestClock.adjust('5 seconds')
      expect((yield* svc.snapshot(started.id)).timer._tag).toBe('running')

      // Nothing a lobby row shows has moved, so the feed stays quiet.
      yield* settle
      expect(Option.isNone(yield* Queue.poll(lobby))).toBe(true)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('every open subscriber receives every change', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )

      const svc = yield* LiveSessions
      const one = yield* openLobby(svc)
      const two = yield* openLobby(svc)
      expect(yield* nextLobby(one)).toEqual([])
      expect(yield* nextLobby(two)).toEqual([])

      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })

      expect(idsOf(yield* nextLobby(one))).toEqual([started.id])
      expect(idsOf(yield* nextLobby(two))).toEqual([started.id])

      yield* svc.leaveSession(started.id, owner)

      expect(yield* nextLobby(one)).toEqual([])
      expect(yield* nextLobby(two)).toEqual([])
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('releasing a subscription takes its fiber with it and leaves the rest alone', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )
      const svc = yield* LiveSessions

      const scope = yield* Scope.make()
      const draining = yield* Scope.extend(scope)(
        Effect.forkScoped(Stream.runDrain(svc.watchLobby())),
      )
      yield* settle
      yield* Scope.close(scope, Exit.void)

      // The released subscription's fiber is gone, not left running.
      yield* Fiber.await(draining)
      expect(yield* Fiber.status(draining)).toMatchObject({ _tag: 'Done' })

      // And the registry it was reading carries on: a fresh subscriber still
      // opens on the truth.
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      expect(idsOf(yield* nextLobby(yield* openLobby(svc)))).toEqual([started.id])
    }).pipe(Effect.provide(FlowLive)),
  )
})
