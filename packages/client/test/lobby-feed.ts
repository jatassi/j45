import type { SessionSummary } from '@j45/domain'
import { act } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'

/**
 * Lobby feeds for the screen suites — what a fake `WatchActiveSessions`
 * handler answers with.
 *
 * The server's feed publishes the whole set of live sessions and then stays
 * open for as long as the subscriber holds it. A handler that ends its stream
 * would say something different: the client reads a stream that stops as the
 * transport going away, and reconnects. Every feed here therefore stays open.
 */

/** A feed that publishes `rows` and then says nothing more. */
export const staticLobby =
  (rows: readonly SessionSummary[]) => (): Stream.Stream<readonly SessionSummary[]> =>
    Stream.make(rows).pipe(Stream.concat(Stream.never))

/** A feed that publishes nothing at all — a subscription that has not answered. */
export const silentLobby = (): Stream.Stream<readonly SessionSummary[]> => Stream.never

/** A feed with no live sessions in it. */
export const emptyLobby = staticLobby([])

/**
 * A feed a test drives: the handler to install, plus the next snapshot to
 * publish.
 *
 * With no `opening` the feed has answered nothing at all — the state a fresh
 * subscription is in before its first snapshot arrives — and it stays that
 * way until the test publishes one. A test that needs the client to read the
 * feed before and after its first answer drives it that way, so the two
 * readings cannot swap places under load.
 */
export const makeLobby = (opening?: readonly SessionSummary[]) => {
  const queue = Effect.runSync(Queue.unbounded<readonly SessionSummary[]>())
  if (opening !== undefined) {
    Effect.runSync(Queue.offer(queue, opening))
  }
  return {
    handler: (): Stream.Stream<readonly SessionSummary[]> => Stream.fromQueue(queue),
    /** The next whole snapshot the server publishes — a start, an end, a join. */
    publish: (rows: readonly SessionSummary[]): Promise<void> =>
      act(async () => {
        await Effect.runPromise(Queue.offer(queue, rows))
      }),
  }
}
