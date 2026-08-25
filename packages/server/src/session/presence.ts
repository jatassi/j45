import type { Participant, UserId } from '@j45/domain'
import * as Clock from 'effect/Clock'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { publishLobby } from './lobby.js'
import {
  addPresence,
  participantsOf,
  removePresence,
  withState,
  type Registry,
  type SessionHandle,
  type Sub,
} from './session-state.js'

/**
 * Who is in the room, and what happens to the session when that changes —
 * the presence half of a live session, kept apart from `live-sessions.ts` so
 * the actor module stays under the line cap.
 *
 * Every function here is one serialized mutation of a session handle:
 * acquiring a watch, releasing one, and detaching every watch of one user
 * when they leave. All three end at the same two publications — the session
 * snapshot its watchers hold, and the lobby row that carries the count.
 */

// Rebuild the participant list from presence and publish it, with a fresh
// `serverNow`. The lobby row of this session carries the size of that same
// list, so it goes out here too. The caller holds the session's semaphore.
const publishParticipants = (registry: Registry, handle: SessionHandle): Effect.Effect<void> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const presence = yield* Ref.get(handle.presence)
    const state = yield* SubscriptionRef.get(handle.stateRef)
    yield* SubscriptionRef.set(
      handle.stateRef,
      withState(state, { serverNow: now, participants: participantsOf(presence) }),
    )
    yield* publishLobby(registry)
  })

// The same publication, for a caller that does not hold the semaphore yet.
// It takes the permit, so a command and a join never clobber each other.
const republishParticipants = (registry: Registry, handle: SessionHandle): Effect.Effect<void> =>
  handle.sem.withPermits(1)(publishParticipants(registry, handle))

// Acquiring a `watch`: register a fresh `Sub`, count its subscription, add the
// user to presence, (re-)add them to the roster, and clear any departed flag —
// a re-watch after leaving restores them as a fresh ever-participant. Returns
// the `Sub` so the release finalizer can claim its own decrement.
export const join = (
  registry: Registry,
  handle: SessionHandle,
  participant: Participant,
): Effect.Effect<Sub> =>
  Effect.gen(function* () {
    const id = yield* Ref.modify(handle.nextSubId, (n) => [n, n + 1])
    const active = yield* Ref.make(true)
    const interrupt = yield* Deferred.make<undefined>()
    const sub: Sub = { id, userId: participant.userId, active, interrupt }
    yield* Ref.update(handle.subs, HashMap.set(id, sub))
    yield* SubscriptionRef.update(handle.rawSubs, (n) => n + 1)
    yield* Ref.update(handle.presence, addPresence(participant))
    // Add-only: a re-set refreshes their display name but never removes them.
    yield* Ref.update(handle.roster, HashMap.set(participant.userId, participant))
    yield* Ref.update(handle.departed, HashSet.remove(participant.userId))
    yield* republishParticipants(registry, handle)
    return sub
  })

// Releasing a `watch`: drop the sub from the registry, then claim its
// decrement — but only if `leaveSession` did not already detach this user (it
// flips `active` false and does the decrement itself). Claiming is atomic, so
// exactly one of the two paths decrements.
export const leave = (registry: Registry, handle: SessionHandle, sub: Sub): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Ref.update(handle.subs, HashMap.remove(sub.id))
    const claimed = yield* Ref.getAndSet(sub.active, false)
    if (!claimed) {
      return
    }
    yield* SubscriptionRef.update(handle.rawSubs, (n) => Math.max(0, n - 1))
    yield* Ref.update(handle.presence, removePresence(sub.userId))
    yield* republishParticipants(registry, handle)
  })

// Step (3) of a leave: interrupt every one of the leaver's subscriptions and,
// for each one we still own (an atomic `active` claim), drop its presence and
// raw-sub count — so a later stream-release finalizer never double-decrements.
export const detachUser = (
  registry: Registry,
  handle: SessionHandle,
  userId: UserId,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const subs = yield* Ref.get(handle.subs)
    const userSubs = [...HashMap.values(subs)].filter((sub) => sub.userId === userId)
    for (const sub of userSubs) {
      yield* Ref.update(handle.subs, HashMap.remove(sub.id))
      const claimed = yield* Ref.getAndSet(sub.active, false)
      yield* Deferred.succeed(sub.interrupt, undefined)
      if (claimed) {
        yield* SubscriptionRef.update(handle.rawSubs, (n) => Math.max(0, n - 1))
        yield* Ref.update(handle.presence, removePresence(userId))
      }
    }
    // Publish the shrunken list. `leaveSession` already holds the permit, so
    // this is the semaphore-free half.
    yield* publishParticipants(registry, handle)
  })
