import { describe, expect, it } from '@effect/vitest'
import { compile, Participant, WorkoutId, type SessionId, type SessionSummary } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import type * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as TestClock from 'effect/TestClock'

import { LiveSessions } from '../../src/session/live-sessions.js'
import {
  asOwner,
  bobId,
  caraId,
  FlowLive,
  lobbyNow,
  makeWorkout,
  owner,
  seedUser,
} from './plan-flow-harness.js'

/**
 * The lobby feed, observed the only way a caller can observe it: subscribe,
 * and read what arrives and in what order. Nothing here touches how the feed
 * is published — that is implementation, and it will move.
 *
 * Every test drives `LiveSessions` directly and reads snapshots off a queue.
 * A stream consumed through the rpc test client while the same client makes
 * unary calls deadlocks, which is why the rename test below calls the library
 * rpc but never streams through it.
 */

const host = new Participant({ userId: owner, displayName: 'Owner' })
const bob = new Participant({ userId: bobId, displayName: 'Bob' })
const cara = new Participant({ userId: caraId, displayName: 'Cara' })

const fixtureWorkoutId = Schema.decodeSync(WorkoutId)('workout-fixture')

/** One live session of the two-station fixture, started on the service. */
const startFixture = (svc: LiveSessions, name = 'Fixture', workoutId = fixtureWorkoutId) => {
  const workout = makeWorkout(['A', 'B'], {}, name)
  return svc.start({
    host,
    workoutId,
    reflowLaunched: false,
    workoutName: name,
    workout,
    compiled: compile(workout),
  })
}

/** What one lobby subscription hands back, element by element. */
type Frames = Queue.Dequeue<Exit.Exit<readonly SessionSummary[], Option.Option<unknown>>>

/** A lobby subscription, held for the scope of the test. */
const openLobby = (svc: LiveSessions): Effect.Effect<Frames, never, Scope.Scope> =>
  Stream.toQueueOfElements(svc.lobby())

/** The next snapshot the feed publishes to this subscriber. */
const nextFrame = (frames: Frames) => Effect.flatten(Queue.take(frames))

/** The ids of one published snapshot, so membership is assertable. */
const idsOf = (rows: readonly SessionSummary[]): readonly SessionId[] => rows.map((row) => row.id)

/** The row for one session in a published snapshot, if it holds one. */
const rowFor = (rows: readonly SessionSummary[], id: SessionId) => rows.find((row) => row.id === id)

/**
 * Lets every ready fiber run, then answers with whatever the feed has
 * published and nobody has taken. Used to assert that nothing was published.
 */
const publishedSoFar = (frames: Frames) =>
  Effect.gen(function* () {
    for (let i = 0; i < 20; i++) {
      yield* Effect.yieldNow()
    }
    return yield* Queue.takeAll(frames)
  })

/** Drains frames until one satisfies `predicate`, and answers with it. */
const frameWhere = (frames: Frames, predicate: (rows: readonly SessionSummary[]) => boolean) =>
  Effect.gen(function* () {
    for (let i = 0; i < 50; i++) {
      const rows = yield* nextFrame(frames)
      if (predicate(rows)) {
        return rows
      }
    }
    throw new Error('the lobby feed never published the expected snapshot')
  })

describe('the lobby feed of LiveSessions', () => {
  it.scoped('opens on the set of live sessions as it stands', () =>
    Effect.gen(function* () {
      yield* seedUser(owner, 'Owner')
      const svc = yield* LiveSessions
      const first = yield* startFixture(svc, 'First')
      const second = yield* startFixture(svc, 'Second')

      const frames = yield* openLobby(svc)
      const opening = yield* nextFrame(frames)

      expect(idsOf(opening)).toHaveLength(2)
      expect(idsOf(opening)).toContain(first.id)
      expect(idsOf(opening)).toContain(second.id)
      expect(rowFor(opening, first.id)?.workoutName).toBe('First')
      expect(rowFor(opening, second.id)?.hostDisplayName).toBe('Owner')
      expect(rowFor(opening, second.id)?.participantCount).toBe(0)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('publishes a session that starts after the subscription opened', () =>
    Effect.gen(function* () {
      yield* seedUser(owner, 'Owner')
      const svc = yield* LiveSessions

      const frames = yield* openLobby(svc)
      expect(yield* nextFrame(frames)).toEqual([])

      const started = yield* startFixture(svc, 'Started')

      const afterStart = yield* nextFrame(frames)
      expect(idsOf(afterStart)).toEqual([started.id])
      expect(rowFor(afterStart, started.id)?.workoutName).toBe('Started')
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('publishes the count as a participant joins and again as they go', () =>
    Effect.gen(function* () {
      yield* seedUser(owner, 'Owner')
      yield* seedUser(bob.userId, 'Bob')
      const svc = yield* LiveSessions
      const started = yield* startFixture(svc)
      const frames = yield* openLobby(svc)
      expect(rowFor(yield* nextFrame(frames), started.id)?.participantCount).toBe(0)

      // A watch is a join: acquiring it puts the watcher in the room.
      const watching = yield* Effect.fork(Stream.runDrain(svc.watch(started.id, bob)))
      const joined = yield* frameWhere(
        frames,
        (rows) => rowFor(rows, started.id)?.participantCount === 1,
      )
      expect(rowFor(joined, started.id)?.participantCount).toBe(1)

      // Releasing the watch takes them out of the room again.
      yield* Fiber.interrupt(watching)
      const left = yield* frameWhere(
        frames,
        (rows) => rowFor(rows, started.id)?.participantCount === 0,
      )
      expect(idsOf(left)).toEqual([started.id])
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('publishes the smaller count when one of two participants leaves', () =>
    Effect.gen(function* () {
      yield* seedUser(owner, 'Owner')
      yield* seedUser(bob.userId, 'Bob')
      yield* seedUser(cara.userId, 'Cara')
      const svc = yield* LiveSessions
      const started = yield* startFixture(svc)
      yield* Effect.fork(Stream.runDrain(svc.watch(started.id, bob)))
      yield* Effect.fork(Stream.runDrain(svc.watch(started.id, cara)))
      const frames = yield* openLobby(svc)
      yield* frameWhere(frames, (rows) => rowFor(rows, started.id)?.participantCount === 2)

      // Bob departs and Cara stays, so the session lives on with one fewer.
      yield* svc.leaveSession(started.id, bob.userId)

      const afterLeave = yield* frameWhere(
        frames,
        (rows) => rowFor(rows, started.id)?.participantCount === 1,
      )
      expect(idsOf(afterLeave)).toEqual([started.id])
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('drops a session that the last participant left', () =>
    Effect.gen(function* () {
      yield* seedUser(owner, 'Owner')
      const svc = yield* LiveSessions
      const started = yield* startFixture(svc)
      const frames = yield* openLobby(svc)
      expect(idsOf(yield* nextFrame(frames))).toEqual([started.id])

      // The host is the whole roster, so their leave ends the session at once.
      yield* svc.leaveSession(started.id, host.userId)

      expect(yield* frameWhere(frames, (rows) => rows.length === 0)).toEqual([])
      expect(yield* lobbyNow(svc)).toHaveLength(0)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('drops a session that the idle collector ended', () =>
    Effect.gen(function* () {
      yield* seedUser(owner, 'Owner')
      const svc = yield* LiveSessions
      const started = yield* startFixture(svc)
      const frames = yield* openLobby(svc)
      expect(idsOf(yield* nextFrame(frames))).toEqual([started.id])

      // Nobody ever watched, so the abandon clock runs from the start.
      yield* TestClock.adjust('60 seconds')

      expect(yield* frameWhere(frames, (rows) => rows.length === 0)).toEqual([])
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('publishes the new name when the host renames the workout', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B'], {}, 'Old') },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })

      const svc = yield* LiveSessions
      const frames = yield* openLobby(svc)
      expect(rowFor(yield* nextFrame(frames), started.id)?.workoutName).toBe('Old')

      yield* library.RenameWorkout({ id: created.id, name: 'New' }, { headers })

      const renamed = yield* frameWhere(
        frames,
        (rows) => rowFor(rows, started.id)?.workoutName === 'New',
      )
      expect(idsOf(renamed)).toEqual([started.id])
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('publishes the new name a held edit brings with it at the next boundary', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B'], {}, 'Old') },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })

      const svc = yield* LiveSessions
      const frames = yield* openLobby(svc)
      expect(rowFor(yield* nextFrame(frames), started.id)?.workoutName).toBe('Old')

      // A new name and new content together: the edit waits for the boundary,
      // so the row must keep the old name until the plan comes into force.
      yield* library.UpdateWorkout(
        {
          id: created.id,
          workout: makeWorkout(['A', 'C'], {}, 'New'),
          updatedAt: created.updatedAt,
        },
        { headers },
      )
      expect(yield* publishedSoFar(frames)).toHaveLength(0)

      // The ready segment ends at 5s, and the held plan goes into force.
      yield* TestClock.adjust('5 seconds')

      const renamed = yield* frameWhere(
        frames,
        (rows) => rowFor(rows, started.id)?.workoutName === 'New',
      )
      expect(idsOf(renamed)).toEqual([started.id])
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('says nothing while the timer runs, because no summary moves with it', () =>
    Effect.gen(function* () {
      yield* seedUser(owner, 'Owner')
      yield* seedUser(bob.userId, 'Bob')
      const svc = yield* LiveSessions
      const started = yield* startFixture(svc)
      // One watcher, so the abandon clock never runs during the advance.
      yield* Effect.fork(Stream.runDrain(svc.watch(started.id, bob)))
      const frames = yield* openLobby(svc)
      yield* frameWhere(frames, (rows) => rowFor(rows, started.id)?.participantCount === 1)

      // Ready 5s, work 10s, rest 5s, work 10s — this runs the timer to done.
      yield* TestClock.adjust('30 seconds')
      expect((yield* svc.snapshot(started.id)).timer._tag).toBe('done')

      expect(yield* publishedSoFar(frames)).toHaveLength(0)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('gives every subscriber every change', () =>
    Effect.gen(function* () {
      yield* seedUser(owner, 'Owner')
      yield* seedUser(bob.userId, 'Bob')
      const svc = yield* LiveSessions
      const first = yield* openLobby(svc)
      const second = yield* openLobby(svc)
      expect(yield* nextFrame(first)).toEqual([])
      expect(yield* nextFrame(second)).toEqual([])

      const started = yield* startFixture(svc)
      expect(idsOf(yield* nextFrame(first))).toEqual([started.id])
      expect(idsOf(yield* nextFrame(second))).toEqual([started.id])

      yield* Effect.fork(Stream.runDrain(svc.watch(started.id, bob)))
      const counted = (frames: Frames) =>
        frameWhere(frames, (rows) => rowFor(rows, started.id)?.participantCount === 1)
      expect(rowFor(yield* counted(first), started.id)?.participantCount).toBe(1)
      expect(rowFor(yield* counted(second), started.id)?.participantCount).toBe(1)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('leaves nothing behind when a subscriber lets its subscription go', () =>
    Effect.gen(function* () {
      yield* seedUser(owner, 'Owner')
      yield* seedUser(cara.userId, 'Cara')
      const svc = yield* LiveSessions
      const staying = yield* openLobby(svc)
      expect(yield* nextFrame(staying)).toEqual([])

      // Ten subscribers that come and go, each in its own scope.
      for (let i = 0; i < 10; i++) {
        const held = yield* Effect.scoped(
          Effect.flatMap(openLobby(svc), (frames) => Effect.as(nextFrame(frames), frames)),
        )
        // Its queue goes with its scope — the subscription reads no more.
        expect(yield* Queue.isShutdown(held)).toBe(true)
      }

      // A subscriber that outlived them all still gets every change, and the
      // registry still answers exactly what the feed says.
      const started = yield* startFixture(svc)
      expect(idsOf(yield* nextFrame(staying))).toEqual([started.id])
      yield* Effect.fork(Stream.runDrain(svc.watch(started.id, cara)))
      const joined = yield* frameWhere(
        staying,
        (rows) => rowFor(rows, started.id)?.participantCount === 1,
      )
      expect(idsOf(joined)).toEqual(idsOf(yield* lobbyNow(svc)))
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('stops the subscriber’s fiber when its scope closes', () =>
    Effect.gen(function* () {
      yield* seedUser(owner, 'Owner')
      const svc = yield* LiveSessions
      const running = yield* Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkScoped(Stream.runDrain(svc.lobby()))
          yield* startFixture(svc)
          return fiber
        }),
      )

      // Closing the scope ends the draining fiber rather than leaking it.
      // A leaked fiber would never be awaited to completion here.
      expect(Exit.isInterrupted(yield* Fiber.await(running))).toBe(true)
    }).pipe(Effect.provide(FlowLive)),
  )
})

/**
 * The same feed, read through the rpc contract — the shape a client sees.
 *
 * Every test here starts and ends sessions on the service, never through the
 * client it streams on. A stream consumed through the rpc test client while
 * that same client makes unary calls deadlocks.
 */
describe('the WatchActiveSessions rpc', () => {
  it.scoped('opens on the set of live sessions as it stands', () =>
    Effect.gen(function* () {
      const { headers, sessions } = yield* asOwner
      const svc = yield* LiveSessions
      const started = yield* startFixture(svc, 'Opening')

      const frames = yield* Stream.toQueueOfElements(
        sessions.WatchActiveSessions(undefined, { headers }),
      )
      const opening = yield* nextFrame(frames)

      expect(idsOf(opening)).toEqual([started.id])
      expect(rowFor(opening, started.id)?.workoutName).toBe('Opening')
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('publishes a session that starts, and drops it when it ends', () =>
    Effect.gen(function* () {
      const { headers, sessions } = yield* asOwner
      const svc = yield* LiveSessions

      const frames = yield* Stream.toQueueOfElements(
        sessions.WatchActiveSessions(undefined, { headers }),
      )
      expect(yield* nextFrame(frames)).toEqual([])

      const started = yield* startFixture(svc, 'Later')
      expect(idsOf(yield* frameWhere(frames, (rows) => rows.length === 1))).toEqual([started.id])

      // The host is the whole roster, so their leave ends the session at once.
      yield* svc.leaveSession(started.id, host.userId)
      expect(yield* frameWhere(frames, (rows) => rows.length === 0)).toEqual([])
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('gives a subscriber that attaches mid-flight the current set, not the history', () =>
    Effect.gen(function* () {
      const { headers, sessions } = yield* asOwner
      yield* seedUser(bob.userId, 'Bob')
      const svc = yield* LiveSessions

      // Two sessions come and one goes before anybody subscribes.
      const gone = yield* startFixture(svc, 'Gone')
      const staying = yield* startFixture(svc, 'Staying')
      yield* svc.leaveSession(gone.id, host.userId)

      const frames = yield* Stream.toQueueOfElements(
        sessions.WatchActiveSessions(undefined, { headers }),
      )
      const opening = yield* nextFrame(frames)

      expect(idsOf(opening)).toEqual([staying.id])
    }).pipe(Effect.provide(FlowLive)),
  )
})
