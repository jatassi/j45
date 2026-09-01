import { Atom } from '@effect-atom/atom-react'
import { SessionNotFound } from '@j45/domain'
import type {
  CompiledWorkout,
  Segment,
  SessionEnd,
  SessionId,
  SessionState,
  WorkContext,
} from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Stream from 'effect/Stream'

import type { PlayerPhase } from '@/components/player/phase'
import type { HomeNotice } from '@/lib/home-notice'
import { reconnectDelay, type FeedClient } from '@/lib/reconnect'
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
 * What home tells a participant about one ending. `null` is an ending the
 * server cannot name, and it reads as the ordinary one.
 *
 * The two vocabularies stay separate on purpose. `SessionEnd` says what
 * happened to a session; `HomeNotice` names a message on a screen. Mapping
 * them here keeps a rename of either one out of the other's file.
 */
const endedBy = (end: SessionEnd | null): SessionFeed => ({
  _tag: 'ended',
  notice: end === 'plan-deleted' ? 'plan-deleted' : 'session-ended',
})

/**
 * One snapshot as a feed value. A snapshot carrying `ended` is the last one
 * the server publishes, and it says why the session stopped.
 */
const toFeed = (state: SessionState): SessionFeed =>
  state.ended === null ? { _tag: 'live', state } : endedBy(state.ended)

/**
 * The retrying watch stream. Each server snapshot becomes a `live` feed,
 * except the last one a session publishes, which becomes `ended` and carries
 * why.
 *
 * A `SessionNotFound` failure is the other ending, and it carries a reason of
 * its own. A participant who loses the connection never receives the last
 * snapshot: the session is gone before they retry. The server remembers why
 * it went, and answers the failed watch with that reason. A deleted plan thus
 * reads the same to them as to everybody who stayed connected. An ending that
 * the server can no longer name reads as the ordinary one.
 *
 * A stream that stops without a last snapshot means that the participant
 * left, or that the server went away. That is the plain `ended`, with nothing
 * more to say. Every other failure emits `reconnecting`, waits out the
 * backoff, then resubscribes. The fresh snapshot heals the drift that the
 * disconnect caused.
 */
const watchFeed = (
  client: FeedClient,
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
        ? Stream.make(endedBy(error.endedAs))
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

/** Every work in run order — the flat list the Progress strip is derived from. */
export const sessionWorks = (segments: readonly Segment[]): readonly WorkContext[] =>
  segments.flatMap((segment) => (segment._tag === 'work' ? [segment.work] : []))

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

/**
 * One cell's state relative to the work in focus. The glossary names the
 * three states done, now and ahead; `active` is now and `upcoming` is ahead.
 * The progress strip reads the same three and adds no fourth: nothing on the
 * strip fills part-way.
 */
export type CellState = 'done' | 'active' | 'upcoming'

/** Whether a given work is finished, running now, or still ahead. */
export const cellState = (workIndex: number, currentWorkIndex: number | undefined): CellState => {
  if (currentWorkIndex === undefined) return 'upcoming'
  if (workIndex < currentWorkIndex) return 'done'
  return workIndex === currentWorkIndex ? 'active' : 'upcoming'
}

/**
 * The room the progress strip has, the smallest cell a participant can see in
 * it, and the gaps the renderer draws inside it. The cell collapse takes the
 * gaps out of the width first, shares what is left among the bars, and
 * compares the cell that follows against the minimum.
 *
 * The gaps belong here because the strip never gives all of its width to
 * cells. `progress-strip.tsx` draws a gap between two bars, a wider one
 * before a bar that opens a pod's run, and a gap between two cells of one
 * bar. A budget that ignored them would report a bar as keeping cells that
 * render under the floor, and the floor is the whole point of the rule. The
 * error grows with the number of bars, so it is worst on exactly the
 * hand-authored workout the rule exists to protect: `Pod.stations` and
 * `Flow.rounds` have no upper bound.
 *
 * It is a parameter, not a measurement. The derivation must stay pure, so it
 * cannot read the element's real width, and a rule that waited on the dom
 * would push its own branch behind the screen where no test can reach it.
 * Passing the budget in keeps the branch provable: a test names a narrow
 * budget and asserts the plain bar that follows.
 */
export type StripBudget = {
  readonly stripWidthPx: number
  readonly minCellWidthPx: number
  /** The gap between two bars. */
  readonly barGapPx: number
  /** What a bar that opens a pod's run adds on top of that gap. */
  readonly podRunGapPx: number
  /** The gap between two cells of one bar. */
  readonly cellGapPx: number
}

/**
 * The default budget: the strip's width on the narrowest supported phone
 * (320px, less the 20px of padding on each side that `session-screen.tsx`
 * gives the live screen), a cell of 4px, which is about the smallest mark
 * that reads from arm's length, and the three gaps the live strip draws.
 *
 * The gaps are the renderer's own measurements, and `progress-strip.tsx`
 * reads them from here instead of naming them again. One source keeps the two
 * in step: a gap that changes moves the collapse with it, and no comment has
 * to be obeyed for the floor to stay true.
 */
export const STRIP_BUDGET: StripBudget = {
  stripWidthPx: 280,
  minCellWidthPx: 4,
  barGapPx: 6,
  podRunGapPx: 8,
  cellGapPx: 1,
}

/**
 * One bar of the progress strip. A bar is a group of works — never a
 * **Segment**, which is one timed unit.
 *
 * `cells` holds one cell per station in the group, or nothing at all when the
 * bar gave its cells up to the budget. A bar with no cells renders plain: it
 * still says done, now or ahead, and it says nothing about the station.
 *
 * `startsPodRun` marks a bar that opens a new pod's run, so the renderer can
 * give it a wider leading gap.
 */
export type ProgressBar = {
  readonly key: string
  readonly state: CellState
  readonly cells: readonly CellState[]
  readonly startsPodRun: boolean
}

/** The whole strip: the bars, and one dot per round of the flow. */
export type ProgressStrip = {
  readonly bars: readonly ProgressBar[]
  readonly dots: readonly CellState[]
}

/** A bar under construction: which works it holds, and which stations. */
type StripGroup = {
  readonly key: string
  readonly podIndex: number
  /** The `stationInPod` ordinals of the group, in the order they run. */
  readonly stations: readonly number[]
  readonly firstWorkIndex: number
  readonly lastWorkIndex: number
}

/**
 * The key that collects works into one bar. A `laps` bar is a pod, and a
 * `sets` bar is one station of one pod.
 *
 * The flow comes from the compiled plan, never from the order of the works.
 * A pod of one station runs the same order under both flows, and so does a
 * flow of one round, so an inference would pick a grouping at random.
 */
const groupKey = (work: WorkContext, byPod: boolean): string =>
  byPod ? `pod-${work.podIndex}` : `pod-${work.podIndex}-station-${work.stationInPod}`

/**
 * The bars' contents, in run order. Works arrive in run order and every
 * group's works are contiguous, so the insertion order of the map is the
 * order the bars are drawn in.
 */
const stripGroups = (works: readonly WorkContext[], byPod: boolean): readonly StripGroup[] => {
  const byKey = new Map<string, WorkContext[]>()
  for (const work of works) {
    const key = groupKey(work, byPod)
    const existing = byKey.get(key)
    if (existing === undefined) byKey.set(key, [work])
    else existing.push(work)
  }
  return [...byKey.entries()].map(([key, groupWorks]) => {
    // A group holds at least the work that created it, so both ends exist.
    const first = groupWorks[0]
    const last = groupWorks.at(-1) ?? first
    return {
      key,
      podIndex: first.podIndex,
      stations: [...new Set(groupWorks.map((work) => work.stationInPod))],
      firstWorkIndex: first.workIndex,
      lastWorkIndex: last.workIndex,
    }
  })
}

/**
 * The state of a span of works — a whole bar's own reading.
 *
 * A span reads as the point in it nearest the work in focus: clamp the
 * current ordinal into the span, then ask `cellState` about that point.
 * Inside the span the clamp is the current work itself, which is now. Before
 * the span the clamp is the span's first work, which is ahead. After it the
 * clamp is the span's last work, which is done. With no work in focus
 * `cellState` reads ahead, which is the reading a session that is getting
 * ready wants.
 *
 * This is exact for both flows. Every round of a pod finishes before the next
 * pod starts on `laps`, and every round of a station finishes before the next
 * station starts on `sets`, so a bar's works are one unbroken span.
 */
const spanState = (group: StripGroup, ordinal: number | undefined): CellState =>
  cellState(Math.min(Math.max(ordinal ?? 0, group.firstWorkIndex), group.lastWorkIndex), ordinal)

/**
 * One bar's cells: one per station in the group.
 *
 * The bar that is now reads its cells against the current round — the cells
 * before the running station are done, the running station is now, and the
 * rest are ahead. They are never read cumulatively across the rounds: that
 * would turn every cell done in round 2, and the bar would say nothing for
 * the rest of the run. Every other bar gives all of its cells the bar's own
 * state.
 *
 * A `sets` bar is a group of one station, so it holds exactly one cell. No
 * branch makes that so — the rule does.
 */
const barCells = (
  group: StripGroup,
  state: CellState,
  stationInPod: number | undefined,
): CellState[] => {
  if (state !== 'active' || stationInPod === undefined) return group.stations.map(() => state)
  const running = group.stations.indexOf(stationInPod)
  return group.stations.map((_, cell) => cellState(cell, running === -1 ? undefined : running))
}

/**
 * The progress strip for one compiled plan and one work ordinal: the bars,
 * their cells, and the round dots, each holding done, now or ahead.
 *
 * This is the only place the strip's rules live. It is pure, so every branch
 * is provable without a screen, and the renderer draws what it is given and
 * decides nothing.
 *
 * `currentWorkIndex` is `undefined` while the session gets ready, and at any
 * other time with no work in focus. Everything then reads ahead, so the strip
 * never claims a station that nobody started. An ordinal outside the plan
 * reads the same way.
 */
export const progressStrip = (
  compiled: CompiledWorkout,
  currentWorkIndex: number | undefined,
  budget: StripBudget = STRIP_BUDGET,
): ProgressStrip => {
  const works = sessionWorks(compiled.segments)
  const focus = currentWorkIndex === undefined ? undefined : works[currentWorkIndex]
  const byPod = compiled.flowType === 'laps'
  const groups = stripGroups(works, byPod)

  // A pod boundary is worth a wider gap only where a bar is not already a
  // pod. On `laps` the bar boundary is the pod boundary, so nothing is
  // marked; on a one-pod `sets` workout no bar changes pod.
  //
  // The widths need this before the bars are built, not with them: the wider
  // gap is width no cell ever gets, so the share cannot be known until every
  // boundary is.
  const podRunStarts = groups.map(
    (group, index) => !byPod && index > 0 && group.podIndex !== groups[index - 1].podIndex,
  )

  // The width one bar is really drawn at. The renderer spends part of the
  // strip on the gap between each pair of bars and on the wider gap before
  // each pod run, and the bars share only what is left of it.
  //
  // A share falls to zero or below once the bars are numerous enough to spend
  // the whole strip on gaps. Every bar then renders plain, which is the only
  // honest reading of that shape.
  const gapsPx =
    budget.barGapPx * Math.max(groups.length - 1, 0) +
    budget.podRunGapPx * podRunStarts.filter(Boolean).length
  const sharePx = (budget.stripWidthPx - gapsPx) / groups.length

  const bars = groups.map((group, index): ProgressBar => {
    const state = spanState(group, focus?.workIndex)
    // One bar's width, less the gaps between its own cells, divided among its
    // stations. A pod authored with more stations than its share can divide
    // gives up its cells and renders plain: the strip then says less, and it
    // still says nothing false.
    const cellsPx = sharePx - budget.cellGapPx * (group.stations.length - 1)
    const plain = cellsPx / group.stations.length < budget.minCellWidthPx
    return {
      key: group.key,
      state,
      cells: plain ? [] : barCells(group, state, focus?.stationInPod),
      startsPodRun: podRunStarts[index],
    }
  })

  const roundTotal = works.reduce((total, work) => Math.max(total, work.round), 0)
  const dots = Array.from({ length: roundTotal }, (_, round) =>
    // The dots say which round of the bar that is now. On `laps` the round
    // restarts at each pod, so the dots restart with it.
    cellState(round, focus === undefined ? undefined : focus.round - 1),
  )

  return { bars, dots }
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
