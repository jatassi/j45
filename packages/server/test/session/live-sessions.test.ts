import { describe, expect, it } from '@effect/vitest'
import {
  compile,
  Flow,
  Participant,
  Pod,
  Round,
  Station,
  UserId,
  Workout,
  type SessionId,
  type SessionState,
} from '@j45/domain'
import * as Chunk from 'effect/Chunk'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as TestClock from 'effect/TestClock'

import { LiveSessions } from '../../src/session/live-sessions.js'

// A deterministic fixture workout. Compiled it becomes four segments with
// round, self-checkable deadlines (TestClock starts at epoch 0):
//   seg0 ready  5_000ms  -> deadline  5_000
//   seg1 work  10_000ms  -> deadline 15_000
//   seg2 rest   5_000ms  -> deadline 20_000
//   seg3 work  10_000ms  -> deadline 30_000 -> done
const compiled = compile(
  new Workout({
    name: 'Fixture',
    focus: 'cardio',
    pods: [
      new Pod({ name: 'P', stations: [new Station({ name: 'A' }), new Station({ name: 'B' })] }),
    ],
    flow: new Flow({ type: 'laps', rounds: [new Round({ workSeconds: 10, restSeconds: 5 })] }),
  }),
)

const userId = (id: string) => Schema.decodeSync(UserId)(id)
const alice = new Participant({ userId: userId('alice'), displayName: 'Alice' })
const bob = new Participant({ userId: userId('bob'), displayName: 'Bob' })

const startFixture = (svc: LiveSessions) =>
  svc.start({ host: alice, workoutName: 'Fixture', compiled })

const participantIds = (state: SessionState): readonly UserId[] =>
  state.participants.map((p) => p.userId)

const running = (state: SessionState) => {
  expect(state.timer._tag).toBe('running')
  if (state.timer._tag !== 'running') {
    throw new Error('expected a running timer')
  }
  return state.timer
}

// Opens a `watch` subscription in a standalone, manually-closeable scope and
// pulls its first element (the current snapshot). Returning the scope lets a
// test release subscriptions in a deliberate order — the key to testing
// presence de-duplication and the abandonment GC without nested scopes.
const openWatch = (svc: LiveSessions, id: SessionId, participant: Participant) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const pull = yield* Scope.extend(scope)(Stream.toPull(svc.watch(id, participant)))
    const first = yield* pull
    return { scope, pull, first }
  })

describe('LiveSessions', () => {
  it.effect('a session created from a compiled workout starts at the ready segment', () =>
    Effect.gen(function* () {
      const svc = yield* LiveSessions
      const summary = yield* startFixture(svc)
      const state = yield* svc.snapshot(summary.id)

      const timer = running(state)
      expect(timer.segmentIndex).toBe(0)
      expect(state.compiled.segments[0]._tag).toBe('ready')
      // endsAtMillis is absolute server-epoch time (5s ready, clock at 0).
      expect(timer.endsAtMillis).toBe(5000)
      expect(state.serverNow).toBe(0)
    }).pipe(Effect.provide(LiveSessions.Default)),
  )

  it.effect('the ticker advances exactly at each chained segment deadline', () =>
    Effect.gen(function* () {
      const svc = yield* LiveSessions
      const { id } = yield* startFixture(svc)

      yield* TestClock.adjust('5 seconds')
      expect(running(yield* svc.snapshot(id)).segmentIndex).toBe(1)
      expect(running(yield* svc.snapshot(id)).endsAtMillis).toBe(15_000)

      yield* TestClock.adjust('10 seconds')
      expect(running(yield* svc.snapshot(id)).segmentIndex).toBe(2)
      expect(running(yield* svc.snapshot(id)).endsAtMillis).toBe(20_000)

      yield* TestClock.adjust('5 seconds')
      expect(running(yield* svc.snapshot(id)).segmentIndex).toBe(3)

      yield* TestClock.adjust('10 seconds')
      expect((yield* svc.snapshot(id)).timer._tag).toBe('done')
    }).pipe(Effect.provide(LiveSessions.Default)),
  )

  it.effect('the ticker catches up across multiple boundaries after one long adjust', () =>
    Effect.gen(function* () {
      const svc = yield* LiveSessions
      const { id } = yield* startFixture(svc)

      // 21s crosses the 5_000 / 15_000 / 20_000 deadlines in a single jump.
      yield* TestClock.adjust('21 seconds')

      const timer = running(yield* svc.snapshot(id))
      expect(timer.segmentIndex).toBe(3)
      expect(timer.endsAtMillis).toBe(30_000)
    }).pipe(Effect.provide(LiveSessions.Default)),
  )

  it.effect('pause freezes remaining time and resume re-anchors the deadline', () =>
    Effect.gen(function* () {
      const svc = yield* LiveSessions
      const { id } = yield* startFixture(svc)

      yield* TestClock.adjust('2 seconds')
      yield* svc.command(id, 'pause')
      const paused = yield* svc.snapshot(id)
      expect(paused.timer._tag).toBe('paused')
      if (paused.timer._tag === 'paused') {
        expect(paused.timer.remainingMillis).toBe(3000)
      }

      // While paused the ticker idles: 10s later nothing has advanced.
      yield* TestClock.adjust('10 seconds')
      const stillPaused = yield* svc.snapshot(id)
      expect(stillPaused.timer._tag).toBe('paused')
      if (stillPaused.timer._tag === 'paused') {
        expect(stillPaused.timer.remainingMillis).toBe(3000)
      }

      // Resume at t=12_000 re-anchors the deadline to now + remaining.
      yield* svc.command(id, 'resume')
      expect(running(yield* svc.snapshot(id)).endsAtMillis).toBe(15_000)

      // And the re-anchored ticker fires at the new deadline, not the old one.
      yield* TestClock.adjust('3 seconds')
      expect(running(yield* svc.snapshot(id)).segmentIndex).toBe(1)
    }).pipe(Effect.provide(LiveSessions.Default)),
  )

  it.effect('skip and prev enter the target segment at full duration', () =>
    Effect.gen(function* () {
      const svc = yield* LiveSessions
      const { id } = yield* startFixture(svc)

      // skip from the ready segment enters seg1 at its full 10s (endsAt 10_000),
      // not the chained 15_000 deadline.
      yield* svc.command(id, 'skip')
      const skipped = running(yield* svc.snapshot(id))
      expect(skipped.segmentIndex).toBe(1)
      expect(skipped.endsAtMillis).toBe(10_000)

      // prev re-enters seg0 at its full 5s duration.
      yield* svc.command(id, 'prev')
      const back = running(yield* svc.snapshot(id))
      expect(back.segmentIndex).toBe(0)
      expect(back.endsAtMillis).toBe(5000)
    }).pipe(Effect.provide(LiveSessions.Default)),
  )

  it.effect('a command issued by a non-host participant applies', () =>
    Effect.gen(function* () {
      const svc = yield* LiveSessions
      const { id } = yield* startFixture(svc)

      // bob is a non-host participant; commands are identity-agnostic, so his
      // pause affects the shared session.
      const { scope } = yield* openWatch(svc, id, bob)
      yield* svc.command(id, 'pause')
      expect((yield* svc.snapshot(id)).timer._tag).toBe('paused')
      yield* Scope.close(scope, Exit.void)
    }).pipe(Effect.provide(LiveSessions.Default)),
  )

  it.effect(
    'watch delivers the current snapshot first, then each change with fresh serverNow',
    () =>
      Effect.gen(function* () {
        const svc = yield* LiveSessions
        const { id } = yield* startFixture(svc)

        const { scope, pull, first } = yield* openWatch(svc, id, alice)

        const snap0 = Chunk.last(first)
        expect(snap0._tag).toBe('Some')
        if (snap0._tag === 'Some') {
          const timer = running(snap0.value)
          expect(timer.segmentIndex).toBe(0)
          expect(timer.endsAtMillis).toBe(5000)
          expect(snap0.value.serverNow).toBe(0)
          // Subscribing is joining: the first snapshot already lists alice.
          expect(participantIds(snap0.value)).toContain(alice.userId)
        }

        // A single boundary crossing publishes exactly one change.
        yield* TestClock.adjust('5 seconds')
        const snap1 = Chunk.last(yield* pull)
        expect(snap1._tag).toBe('Some')
        if (snap1._tag === 'Some') {
          const timer = running(snap1.value)
          expect(timer.segmentIndex).toBe(1)
          expect(timer.endsAtMillis).toBe(15_000)
          expect(snap1.value.serverNow).toBe(5000)
        }

        yield* Scope.close(scope, Exit.void)
      }).pipe(Effect.provide(LiveSessions.Default)),
  )

  it.effect('a late subscriber receives the current state as its first element', () =>
    Effect.gen(function* () {
      const svc = yield* LiveSessions
      const { id } = yield* startFixture(svc)

      // Two transitions happen before anyone subscribes.
      yield* TestClock.adjust('15 seconds')

      const { scope, first } = yield* openWatch(svc, id, bob)
      const snap = Chunk.last(first)
      expect(snap._tag).toBe('Some')
      if (snap._tag === 'Some') {
        expect(running(snap.value).segmentIndex).toBe(2)
      }
      yield* Scope.close(scope, Exit.void)
    }).pipe(Effect.provide(LiveSessions.Default)),
  )

  it.effect('subscribing adds the caller to participants and unsubscribing removes them', () =>
    Effect.gen(function* () {
      const svc = yield* LiveSessions
      const { id } = yield* startFixture(svc)

      const { scope } = yield* openWatch(svc, id, bob)
      expect(participantIds(yield* svc.snapshot(id))).toContain(bob.userId)
      expect((yield* svc.list())[0]?.participantCount).toBe(1)

      // The scope's finalizer removes bob when the stream releases.
      yield* Scope.close(scope, Exit.void)
      expect((yield* svc.snapshot(id)).participants).toHaveLength(0)
      expect((yield* svc.list())[0]?.participantCount).toBe(0)
    }).pipe(Effect.provide(LiveSessions.Default)),
  )

  it.effect(
    'two subscriptions by one user list them once and remove only on the last release',
    () =>
      Effect.gen(function* () {
        const svc = yield* LiveSessions
        const { id } = yield* startFixture(svc)

        const w1 = yield* openWatch(svc, id, bob)
        const w2 = yield* openWatch(svc, id, bob)

        // Deduped: bob appears once despite two live subscriptions.
        expect((yield* svc.snapshot(id)).participants).toHaveLength(1)
        expect((yield* svc.list())[0]?.participantCount).toBe(1)

        // One subscription released, but bob's other one still holds him in.
        yield* Scope.close(w2.scope, Exit.void)
        expect(participantIds(yield* svc.snapshot(id))).toContain(bob.userId)

        // Last subscription released: bob is gone.
        yield* Scope.close(w1.scope, Exit.void)
        expect((yield* svc.snapshot(id)).participants).toHaveLength(0)
      }).pipe(Effect.provide(LiveSessions.Default)),
  )

  it.effect('a subscriber whose stream is interrupted mid-flight is still removed', () =>
    Effect.gen(function* () {
      const svc = yield* LiveSessions
      const { id } = yield* startFixture(svc)

      const subscribed = yield* Deferred.make<undefined>()
      const fiber = yield* Effect.scoped(
        Effect.gen(function* () {
          const pull = yield* Stream.toPull(svc.watch(id, bob))
          yield* pull
          yield* Deferred.succeed(subscribed, undefined)
          yield* Effect.never
        }),
      ).pipe(Effect.fork)

      yield* Deferred.await(subscribed)
      expect(participantIds(yield* svc.snapshot(id))).toContain(bob.userId)

      // Interruption (a dropped socket) must still run the release finalizer.
      yield* Fiber.interrupt(fiber)
      expect((yield* svc.snapshot(id)).participants).toHaveLength(0)
    }).pipe(Effect.provide(LiveSessions.Default)),
  )

  it.effect('quit completes every subscriber stream and removes the session', () =>
    Effect.gen(function* () {
      const svc = yield* LiveSessions
      const { id } = yield* startFixture(svc)

      // The subscriber first receives the live snapshot.
      const { scope, pull, first } = yield* openWatch(svc, id, bob)
      expect(Chunk.isNonEmpty(first)).toBe(true)

      yield* svc.command(id, 'quit')

      // Then the stream ends: no further element is produced.
      expect(Exit.isFailure(yield* Effect.exit(pull))).toBe(true)
      yield* Scope.close(scope, Exit.void)

      // The session is gone from the active list and can no longer be found.
      expect(yield* svc.list()).toHaveLength(0)
      expect(Exit.isFailure(yield* Effect.exit(svc.snapshot(id)))).toBe(true)
      expect(Exit.isFailure(yield* Effect.exit(svc.command(id, 'pause')))).toBe(true)
    }).pipe(Effect.provide(LiveSessions.Default)),
  )

  it.effect('a session with zero subscribers for 60 consecutive seconds ends and disappears', () =>
    Effect.gen(function* () {
      const svc = yield* LiveSessions
      const { id } = yield* startFixture(svc)

      // Pause so the ticker idles and only the GC clock is in play.
      yield* svc.command(id, 'pause')

      // 59s of abandonment is not yet enough.
      yield* TestClock.adjust('59 seconds')
      expect(yield* svc.list()).toHaveLength(1)

      // Crossing 60 consecutive seconds ends the session.
      yield* TestClock.adjust('1 seconds')
      expect(yield* svc.list()).toHaveLength(0)
      expect(Exit.isFailure(yield* Effect.exit(svc.snapshot(id)))).toBe(true)
    }).pipe(Effect.provide(LiveSessions.Default)),
  )

  it.effect('a live subscription resets the 60-second abandonment clock', () =>
    Effect.gen(function* () {
      const svc = yield* LiveSessions
      const { id } = yield* startFixture(svc)
      yield* svc.command(id, 'pause')

      yield* TestClock.adjust('30 seconds')

      // A live subscriber keeps the session alive well past 60s.
      const { scope } = yield* openWatch(svc, id, alice)
      yield* TestClock.adjust('90 seconds')
      expect(yield* svc.list()).toHaveLength(1)
      yield* Scope.close(scope, Exit.void)

      // Only after the last subscriber leaves does a fresh 60s window end it.
      yield* TestClock.adjust('59 seconds')
      expect(yield* svc.list()).toHaveLength(1)
      yield* TestClock.adjust('1 seconds')
      expect(yield* svc.list()).toHaveLength(0)
    }).pipe(Effect.provide(LiveSessions.Default)),
  )

  it.effect('rebuilding the layer yields an empty session list', () =>
    Effect.gen(function* () {
      // First instance: a session exists.
      yield* Effect.gen(function* () {
        const svc = yield* LiveSessions
        yield* startFixture(svc)
        expect(yield* svc.list()).toHaveLength(1)
      }).pipe(Effect.provide(LiveSessions.Default))

      // A freshly built layer starts empty — sessions are in-memory only.
      yield* Effect.gen(function* () {
        const svc = yield* LiveSessions
        expect(yield* svc.list()).toHaveLength(0)
      }).pipe(Effect.provide(LiveSessions.Default))
    }),
  )
})
