import { Atom } from '@effect-atom/atom-react'
import { SessionNotFound } from '@j45/domain'
import type { Segment, SessionId, SessionState, WorkContext } from '@j45/domain'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Stream from 'effect/Stream'

import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * The connection-level view of a watched session. `WatchSession` is a
 * streaming rpc, so its declared error (`SessionNotFound`) and transport
 * failures both arrive as *stream* failures — this feed folds all three
 * outcomes the screen must distinguish into one value the atom can hold:
 *
 * - `live` — the latest server snapshot.
 * - `reconnecting` — a transport failure is being retried with backoff.
 * - `ended` — the session is gone (clean completion *or* `SessionNotFound`);
 *   the screen navigates home.
 */
export type SessionFeed =
  | { readonly _tag: 'live'; readonly state: SessionState }
  | { readonly _tag: 'reconnecting' }
  | { readonly _tag: 'ended' }

const endedFeed: SessionFeed = { _tag: 'ended' }
const reconnectingFeed: SessionFeed = { _tag: 'reconnecting' }

/** The flat rpc client `ServerRpcClient` resolves to. */
type WatchClient = Effect.Effect.Success<typeof ServerRpcClient>

/** Exponential reconnect backoff, capped at 8s so a long outage keeps retrying. */
const reconnectDelay = (attempt: number): Duration.Duration =>
  Duration.millis(Math.min(500 * 2 ** attempt, 8000))

/**
 * The retrying watch stream. Each server snapshot becomes a `live` feed;
 * a clean completion or a `SessionNotFound` failure becomes `ended` (both
 * mean "the session is over — go home"); every other failure emits
 * `reconnecting`, waits out the backoff, then resubscribes — the fresh
 * snapshot heals whatever drift the disconnect caused.
 */
const watchFeed = (
  client: WatchClient,
  id: SessionId,
  attempt: number,
): Stream.Stream<SessionFeed> =>
  client('WatchSession', { id }).pipe(
    Stream.map((state): SessionFeed => ({ _tag: 'live', state })),
    Stream.concat(Stream.make(endedFeed)),
    Stream.catchAll((error) =>
      error instanceof SessionNotFound
        ? Stream.make(endedFeed)
        : Stream.make(reconnectingFeed).pipe(
            Stream.concat(
              Stream.fromEffect(Effect.sleep(reconnectDelay(attempt))).pipe(
                Stream.flatMap(() => watchFeed(client, id, attempt + 1)),
              ),
            ),
          ),
    ),
  )

/**
 * One latest-state atom per `SessionId`, memoized by `Atom.family` for a
 * stable identity across the screen's re-renders. Built over the rpc
 * client's `WatchSession` `Stream` directly (not the pull-based `.query`
 * atom) so the tag-discriminated retry above can hang off it.
 */
export const sessionFeedFamily = Atom.family((id: SessionId) =>
  ServerRpcClient.runtime.atom(
    Stream.unwrap(Effect.map(ServerRpcClient, (client) => watchFeed(client, id, 0))),
  ),
)

/** Drives `SendSessionCommand`; any participant may pause/resume/skip/prev. */
export const sendSessionCommandAtom = ServerRpcClient.mutation('SendSessionCommand')

/**
 * Drives `LeaveSession` — the only exit from a session. Leaving records the
 * caller's progress (if the session progressed) and removes them; when the last
 * participant leaves the session ends. The leaver's own feed folds to `ended`
 * once their stream detaches, which navigates them home.
 */
export const leaveSessionAtom = ServerRpcClient.mutation('LeaveSession')

/** Every work in run order — the flat list the progress cells render. */
export const sessionWorks = (segments: readonly Segment[]): readonly WorkContext[] =>
  segments.flatMap((segment) => (segment._tag === 'work' ? [segment.work] : []))

/** The works of one pod, in run order, for a progress-cell row. */
export type PodGroup = {
  readonly podIndex: number
  readonly podName: string
  readonly works: readonly WorkContext[]
}

/** Works grouped by pod (pod-index ascending) — the progress cells, one row per pod. */
export const podGroups = (works: readonly WorkContext[]): readonly PodGroup[] => {
  const byPod = new Map<number, WorkContext[]>()
  for (const work of works) {
    const existing = byPod.get(work.podIndex)
    if (existing === undefined) byPod.set(work.podIndex, [work])
    else existing.push(work)
  }
  return [...byPod.entries()]
    .toSorted(([a], [b]) => a - b)
    .map(([podIndex, podWorks]) => ({ podIndex, podName: podWorks[0].podName, works: podWorks }))
}

/** Pod/lap/station counts derived from the compiled works, for the context line. */
export type SessionTotals = {
  readonly podCount: number
  readonly roundCount: number
  readonly stationsByPod: ReadonlyMap<number, number>
}

/** Distinct pods, the highest round number, and per-pod station counts. */
export const sessionTotals = (works: readonly WorkContext[]): SessionTotals => {
  const stationsByPod = new Map<number, number>()
  let roundCount = 0
  for (const work of works) {
    roundCount = Math.max(roundCount, work.round)
    stationsByPod.set(
      work.podIndex,
      Math.max(stationsByPod.get(work.podIndex) ?? 0, work.stationInPod),
    )
  }
  return { podCount: stationsByPod.size, roundCount, stationsByPod }
}

/** `Pod x/y · Lap k/n · Station s/m`, the legacy live-session context strip. */
export const contextLine = (ctx: WorkContext, totals: SessionTotals): string => {
  const stations = totals.stationsByPod.get(ctx.podIndex) ?? ctx.stationInPod
  return `Pod ${ctx.podIndex + 1}/${totals.podCount} · Lap ${ctx.round}/${totals.roundCount} · Station ${ctx.stationInPod}/${stations}`
}

/** The segment the timer currently sits in, or `undefined` when idle/done. */
export const currentSegment = (state: SessionState): Segment | undefined => {
  const { timer, compiled } = state
  if (timer._tag !== 'running' && timer._tag !== 'paused') return undefined
  return compiled.segments[timer.segmentIndex]
}

/**
 * The work in focus: a work segment's own context, or a rest segment's
 * upcoming work. `undefined` while getting ready or done.
 */
export const currentWorkContext = (state: SessionState): WorkContext | undefined => {
  const segment = currentSegment(state)
  if (segment === undefined || segment._tag === 'ready') return undefined
  return segment._tag === 'work' ? segment.work : segment.nextWork
}

/** Get ready / Work / Rest / Done — the phase heading. */
export const phaseLabel = (state: SessionState): string => {
  const { timer, compiled } = state
  if (timer._tag === 'done') return 'Done'
  if (timer._tag === 'idle') return 'Get ready'
  const segment = compiled.segments[timer.segmentIndex]
  if (segment._tag === 'ready') return 'Get ready'
  return segment._tag === 'work' ? 'Work' : 'Rest'
}

/** The station name of the next work after the current position, if any. */
export const nextWorkStationName = (state: SessionState): string | undefined => {
  const { timer, compiled } = state
  if (timer._tag !== 'running' && timer._tag !== 'paused') return undefined
  const { segments } = compiled
  for (let index = timer.segmentIndex + 1; index < segments.length; index++) {
    const segment = segments[index]
    if (segment._tag === 'work') return segment.work.station.name
  }
  return undefined
}

/** Milliseconds to display: the live countdown while running, the frozen remainder while paused. */
export const displayMillis = (state: SessionState, liveRemaining: number | null): number => {
  const { timer } = state
  switch (timer._tag) {
    case 'running': {
      return liveRemaining ?? 0
    }
    case 'paused': {
      return timer.remainingMillis
    }
    case 'done':
    case 'idle': {
      return 0
    }
  }
}

/** One cell's state relative to the work in focus. */
export type CellState = 'done' | 'active' | 'upcoming'

/** Whether a given work is finished, running now, or still ahead. */
export const cellState = (workIndex: number, currentWorkIndex: number | undefined): CellState => {
  if (currentWorkIndex === undefined) return 'upcoming'
  if (workIndex < currentWorkIndex) return 'done'
  return workIndex === currentWorkIndex ? 'active' : 'upcoming'
}

/** A stable cue key per running segment (so a resume never re-fires its beep) and for done. */
export const cueKey = (state: SessionState): string | null => {
  const { timer } = state
  if (timer._tag === 'running') return `seg-${timer.segmentIndex}`
  if (timer._tag === 'done') return 'done'
  return null
}
