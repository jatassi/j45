import { Atom } from '@effect-atom/atom-react'
import { SessionNotFound } from '@j45/domain'
import type { Segment, SessionId, SessionState, WorkContext } from '@j45/domain'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Stream from 'effect/Stream'

import type { PlayerPhase } from '@/components/player/phase'
import type { HomeNotice } from '@/lib/home-notice'
import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * The connection-level view of a watched session. `WatchSession` is a
 * streaming rpc, so its declared error (`SessionNotFound`) and transport
 * failures both arrive as *stream* failures — this feed folds all three
 * outcomes the screen must distinguish into one value the atom can hold:
 *
 * - `live` — the latest server snapshot.
 * - `reconnecting` — a transport failure is being retried with backoff.
 * - `ended` — the session is over; the screen navigates home. `notice` is
 *   what home then tells the participant.
 */
export type SessionFeed =
  | { readonly _tag: 'live'; readonly state: SessionState }
  | { readonly _tag: 'reconnecting' }
  | { readonly _tag: 'ended'; readonly notice: HomeNotice }

const endedFeed: SessionFeed = { _tag: 'ended', notice: 'session-ended' }
const reconnectingFeed: SessionFeed = { _tag: 'reconnecting' }

/**
 * One snapshot as a feed value. A snapshot carrying `ended` is the last one
 * the server publishes, and it says why the session stopped — the one place
 * the two home notices are told apart.
 *
 * The two vocabularies stay separate on purpose. `SessionEnd` says what
 * happened to a session; `HomeNotice` names a message on a screen. Mapping
 * them here keeps a rename of either one out of the other's file.
 */
const toFeed = (state: SessionState): SessionFeed =>
  state.ended === null
    ? { _tag: 'live', state }
    : { _tag: 'ended', notice: state.ended === 'plan-deleted' ? 'plan-deleted' : 'session-ended' }

/** The flat rpc client `ServerRpcClient` resolves to. */
type WatchClient = Effect.Effect.Success<typeof ServerRpcClient>

/** Exponential reconnect backoff, capped at 8s so a long outage keeps retrying. */
const reconnectDelay = (attempt: number): Duration.Duration =>
  Duration.millis(Math.min(500 * 2 ** attempt, 8000))

/**
 * The retrying watch stream. Each server snapshot becomes a `live` feed,
 * except the last one a session publishes, which becomes `ended` and carries
 * why. A stream that stops without such a snapshot, and a `SessionNotFound`
 * failure, both become the plain `ended` (they mean "the session is over — go
 * home", with nothing more to say); every other failure emits
 * `reconnecting`, waits out the backoff, then resubscribes — the fresh
 * snapshot heals whatever drift the disconnect caused.
 */
const watchFeed = (
  client: WatchClient,
  id: SessionId,
  attempt: number,
): Stream.Stream<SessionFeed> =>
  client('WatchSession', { id }).pipe(
    Stream.map(toFeed),
    // The fallback ending, for a stream that stops without a last snapshot
    // of its own: the participant left, or the server went away. `takeUntil`
    // keeps it out of the way whenever the session did say why it ended.
    Stream.concat(Stream.make(endedFeed)),
    Stream.takeUntil((feed) => feed._tag === 'ended'),
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

/**
 * Get ready / Work / Rest / Done — the phase heading; `Paused` whenever the
 * timer is held (any participant's pause), since a paused workout is on hold
 * regardless of which segment it froze in.
 */
export const phaseLabel = (state: SessionState): string => {
  const { timer, compiled } = state
  if (timer._tag === 'paused') return 'Paused'
  if (timer._tag === 'done') return 'Done'
  if (timer._tag === 'idle') return 'Get ready'
  const segment = compiled.segments[timer.segmentIndex]
  if (segment._tag === 'ready') return 'Get ready'
  return segment._tag === 'work' ? 'Work' : 'Rest'
}

/**
 * The immersive player's phase for `data-phase`, the backdrop tint, and the
 * ring hue: `ready | work | rest | done`, read from the current segment (both
 * running and paused expose `segmentIndex`) so a pause keeps the segment's
 * identity while `phaseLabel` reads `Paused`.
 */
export const sessionPhase = (state: SessionState): PlayerPhase => {
  const { timer, compiled } = state
  if (timer._tag === 'done') return 'done'
  if (timer._tag === 'idle') return 'ready'
  const segment = compiled.segments[timer.segmentIndex]
  if (segment._tag === 'work') return 'work'
  if (segment._tag === 'rest') return 'rest'
  return 'ready'
}

/**
 * Full duration of the segment the timer sits in, for the progress ring's
 * depletion fraction. `0` when idle/done (no segment in focus), which the ring
 * reads as an empty arc.
 */
export const currentSegmentDurationMillis = (state: SessionState): number =>
  currentSegment(state)?.durationMillis ?? 0

/**
 * The remaining fraction (0..1) of the current segment for the progress ring's
 * depletion — `remainingMillis` over the segment's full duration, clamped. `0`
 * when there is no segment in focus (idle/done), an empty arc.
 */
export const ringFraction = (state: SessionState, remainingMillis: number): number => {
  const durationMillis = currentSegmentDurationMillis(state)
  if (durationMillis <= 0) return 0
  return Math.max(0, Math.min(1, remainingMillis / durationMillis))
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

/** Countdown urgency tier — colours the player digits via the `--timer-*` tokens. */
export type TimerUrgency = 'warn' | 'critical'

/**
 * Urgency for the displayed count: `warn` (orange) in the final 15s,
 * `critical` (deep red) in the final 5s, measured in the same ceilinged whole
 * seconds `formatDuration` displays. Never urgent when done or idle
 * (count 0) — a resting `0:00` is not an emergency.
 */
export const timerUrgency = (phase: PlayerPhase, count: number): TimerUrgency | undefined => {
  if (phase === 'done' || count <= 0) return undefined
  const seconds = Math.ceil(count / 1000)
  if (seconds <= 5) return 'critical'
  if (seconds <= 15) return 'warn'
  return undefined
}

/** One cell's state relative to the work in focus. */
export type CellState = 'done' | 'active' | 'upcoming'

/** Whether a given work is finished, running now, or still ahead. */
export const cellState = (workIndex: number, currentWorkIndex: number | undefined): CellState => {
  if (currentWorkIndex === undefined) return 'upcoming'
  if (workIndex < currentWorkIndex) return 'done'
  return workIndex === currentWorkIndex ? 'active' : 'upcoming'
}

/**
 * A stable cue key per running segment, so a resume never re-fires its beep,
 * plus one for done.
 *
 * The plan revision is part of the key. An applied plan change re-enters the
 * timer, and the segment it lands on can carry the index the participant
 * already had. Without the revision the client would read that as the same
 * segment and stay silent, which drops a boundary beep the participant
 * expects. The revision moves only when a change lands, so nothing else in
 * the player makes a new key.
 */
export const cueKey = (state: SessionState): string | null => {
  const { timer } = state
  if (timer._tag === 'running') return `rev-${state.planRevision}-seg-${timer.segmentIndex}`
  if (timer._tag === 'done') return 'done'
  return null
}
