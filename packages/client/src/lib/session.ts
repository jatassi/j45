import { Atom } from '@effect-atom/atom-react'
import { SessionNotFound } from '@j45/domain'
import type {
  CompiledWorkout,
  FlowType,
  Segment,
  SessionEnd,
  SessionId,
  SessionState,
  WorkContext,
} from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'

import type { PlayerPhase } from '@/components/player/phase'
import type { HomeNotice } from '@/lib/home-notice'
import { RECONNECT_GRACE, reconnectDelay, type FeedClient } from '@/lib/reconnect'
import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * The connection-level view of a watched session. `WatchSession` is a
 * streaming rpc, so its declared error (`SessionNotFound`) and transport
 * failures both arrive as *stream* failures — this feed folds all three
 * outcomes the screen must distinguish into one value the atom can hold:
 *
 * - `live` — the latest server snapshot.
 * - `reconnecting` — a transport failure is being retried with backoff, and
 *   `state` is the **Stale snapshot** the screen keeps running from. It is
 *   `null` only when the break came before the first snapshot ever arrived,
 *   where there is no workout on screen to protect.
 * - `ended` — the session is over; the screen navigates home. `notice` is
 *   what home then tells the participant.
 *
 * The stale snapshot is carried here, not held by a component, so that no
 * second copy of session state can disagree with the feed.
 *
 * This stays a sum type. A product of `state` plus a connection flag was
 * considered and rejected: `ended` does not fit the product, so it still
 * needs a sum on top of it.
 */
export type SessionFeed =
  | { readonly _tag: 'live'; readonly state: SessionState }
  | { readonly _tag: 'reconnecting'; readonly state: SessionState | null }
  | { readonly _tag: 'ended'; readonly notice: HomeNotice }

const endedFeed: SessionFeed = { _tag: 'ended', notice: 'session-ended' }

/**
 * What one watch remembers across its own failures: the last snapshot it
 * produced, and where the connection stands.
 *
 * `up` is a connection delivering snapshots. `breaking` is a failure still
 * inside its grace, which nothing on screen knows about yet. `announced` is a
 * break the participant has been told about, which keeps a deeper retry from
 * saying the same thing a second time.
 */
type FeedMemory = {
  readonly snapshot: SessionState | null
  readonly link: 'up' | 'breaking' | 'announced'
}

/** One watch's fixed parts — the client, the session, and its memory. */
type Watch = {
  readonly client: FeedClient
  readonly id: SessionId
  readonly memory: Ref.Ref<FeedMemory>
}

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
 * The break's own announcement: after the grace, and only if the break is
 * still going, the stale snapshot as a `reconnecting` value. A break that
 * healed inside the grace says nothing at all, so nothing on screen changes
 * for it — not the chip, and not the controls the chip stands down.
 *
 * `Ref.modify` reads and marks in one step, so the retry that keeps failing
 * underneath announces the same break only once.
 */
const announce = (memory: Ref.Ref<FeedMemory>): Stream.Stream<SessionFeed> =>
  Stream.unwrap(
    Effect.sleep(RECONNECT_GRACE).pipe(
      Effect.zipRight(
        Ref.modify(memory, (held): [SessionFeed | null, FeedMemory] =>
          held.link === 'breaking'
            ? [
                { _tag: 'reconnecting', state: held.snapshot },
                { snapshot: held.snapshot, link: 'announced' },
              ]
            : [null, held],
        ),
      ),
      Effect.map((feed): Stream.Stream<SessionFeed> =>
        feed === null ? Stream.empty : Stream.make(feed),
      ),
    ),
  )

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
 * more to say.
 *
 * Every other failure is a break in the connection. The announcement and the
 * retry run together, not one after the other: the retry has to be able to
 * heal the break inside the grace, and a `concat` would leave nothing running
 * to heal it. The fresh snapshot is an ordinary `live` value, so the heal
 * needs no case of its own — it fires the cue for the segment it lands on and
 * raises the plan-change notice if the plan moved while the participant was
 * away.
 */
const watchFeed = (watch: Watch, attempt: number): Stream.Stream<SessionFeed> =>
  watch.client('WatchSession', { id: watch.id }).pipe(
    Stream.tap((state: SessionState) =>
      Ref.set(watch.memory, { snapshot: state, link: 'up' as const }),
    ),
    Stream.map(toFeed),
    // The fallback ending, for a stream that stops without a last snapshot
    // of its own: the participant left, or the server went away. `takeUntil`
    // keeps it out of the way whenever the session did say why it ended.
    Stream.concat(Stream.make(endedFeed)),
    Stream.takeUntil((feed) => feed._tag === 'ended'),
    Stream.catchAll((error) =>
      error instanceof SessionNotFound
        ? Stream.make(endedBy(error.endedAs))
        : Stream.execute(
            Ref.update(watch.memory, (held) =>
              held.link === 'up' ? { snapshot: held.snapshot, link: 'breaking' as const } : held,
            ),
          ).pipe(
            Stream.concat(
              Stream.merge(
                announce(watch.memory),
                Stream.fromEffect(Effect.sleep(reconnectDelay(attempt))).pipe(
                  Stream.flatMap(() => watchFeed(watch, attempt + 1)),
                ),
                // The retry decides when this feed is over; a pending
                // announcement never holds it open past the ending.
                { haltStrategy: 'right' },
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
    Stream.unwrap(
      Effect.map(
        Effect.all([ServerRpcClient, Ref.make<FeedMemory>({ snapshot: null, link: 'up' })]),
        ([client, memory]) => watchFeed({ client, id, memory }, 0),
      ),
    ),
  ),
)

/** Drives `SendSessionCommand`; any participant may pause/resume/skip/prev. */
export const sendSessionCommandAtom = ServerRpcClient.mutation('SendSessionCommand')

/**
 * Drives `LeaveSession` — the only exit from a session. Leaving records the
 * caller's progress (if the session progressed) and removes them; when the last
 * participant leaves the session ends.
 *
 * The screen goes home whether this rpc succeeds or not: a participant with no
 * connection must still be able to leave. The server observes the departure
 * when their watch stream drops.
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
 * arc hue: `ready | work | rest | done`, read from the current segment (both
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
 * Full duration of the segment the timer sits in, for the Progress arc's
 * depletion fraction. `0` when idle/done (no segment in focus), which the arc
 * draws as empty.
 */
export const currentSegmentDurationMillis = (state: SessionState): number =>
  currentSegment(state)?.durationMillis ?? 0

/**
 * The remaining fraction (0..1) of the current segment for the Progress arc's
 * depletion — `remainingMillis` over the segment's full duration, clamped. `0`
 * when there is no segment in focus (idle/done), an empty arc.
 */
export const arcFraction = (state: SessionState, remainingMillis: number): number => {
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
 * The room the **Progress strip** has, the sizes of the marks it draws in it,
 * and the gaps between them. One object, shared by the derivation and the
 * renderer, so a floor the derivation divides against is the very number the
 * screen draws with.
 *
 * The strip spends width on gaps before it spends any on dots: a gap between
 * two pods, a gap between two runs of one pod, and a gap between two dots of
 * one run. A budget that ignored them would report a dot as clearing the
 * floor that the screen draws under it, and the floor is the whole point.
 *
 * It is a parameter, not a measurement. The derivation stays pure, so it
 * cannot read the element's real width, and a rule that waited on the dom
 * would push its own branch behind the screen where no test can reach it.
 */
export type StripBudget = {
  /** The strip's width: the inner span of the **Progress arc**. */
  readonly stripWidthPx: number
  /** The largest a dot ever gets, in either layout. */
  readonly dotCapPx: number
  /** The smallest dot the open layout accepts before it falls to focus. */
  readonly openFloorPx: number
  /** The smallest dot the focus layout accepts before the pod draws cells. */
  readonly focusFloorPx: number
  /** The gap between two dots of one run. */
  readonly dotGapPx: number
  /** The gap between two runs of one pod. */
  readonly runGapPx: number
  /** The gap between two pods. */
  readonly podGapPx: number
  /** A closed pod's pill, fixed: the pill counts pods, not works. */
  readonly pillWidthPx: number
  /** The hairline track under an open pod's dots. */
  readonly trackPx: number
  /** Between the dots and the track, so the strip states its own height. */
  readonly trackGapPx: number
}

/**
 * The default budget. The width is the strip's own, not the screen's: the
 * strip is drawn to the inner span of the **Progress arc** — `min(92vw,
 * 420px)` less one stroke on each side — so on a 320px phone it measures
 * about 264px.
 */
export const STRIP_BUDGET: StripBudget = {
  stripWidthPx: 264,
  dotCapPx: 8,
  openFloorPx: 6,
  focusFloorPx: 4,
  dotGapPx: 2,
  runGapPx: 6,
  podGapPx: 10,
  pillWidthPx: 20,
  trackPx: 2,
  trackGapPx: 4,
}

/**
 * How one pod draws itself.
 *
 * `dots` shows every work of the pod as a dot on a hairline track. `cells`
 * is the last honest rendering before plain: the pod's runs collapse to one
 * cell each on a single bar, because its dots would fall under the focus
 * floor. `pill` is a closed pod: the bar with its dots given up, carrying the
 * pod's own state and nothing about the works inside it.
 */
export type StripPodMode = 'dots' | 'cells' | 'pill'

/**
 * One pod of the strip.
 *
 * `runs` always holds the pod's works grouped into runs, whatever the mode: a
 * run is a lap on `laps` and a station on `sets`. A renderer that draws cells
 * or a pill reads their states through `runState`, so it states no rule of
 * its own.
 */
export type StripPod = {
  readonly key: string
  readonly state: CellState
  readonly mode: StripPodMode
  /** One entry per run, each holding one state per work, in run order. */
  readonly runs: readonly (readonly CellState[])[]
}

/**
 * The whole strip: the layout chosen for this plan, the size its dots are
 * drawn at, and one entry per pod.
 *
 * The layout is stated, never inferred by the renderer. It is chosen once per
 * compiled plan and holds for the whole session, so nothing under the strip
 * shifts as the session moves.
 */
export type ProgressStrip = {
  readonly layout: 'open' | 'focus'
  readonly dotSizePx: number
  readonly pods: readonly StripPod[]
}

/**
 * One run's own reading, for the renderer that draws it as a cell: now if it
 * holds the current work, done if every work in it is done, ahead otherwise.
 *
 * It lives here with the rest of the strip's rules, so the renderer states no
 * rule of its own.
 */
export const runState = (run: readonly CellState[]): CellState => {
  if (run.includes('active')) return 'active'
  return run.length > 0 && run.every((state) => state === 'done') ? 'done' : 'upcoming'
}

/** One pod's works, already grouped into the runs the strip draws. */
type PodRuns = {
  readonly podIndex: number
  readonly runs: readonly (readonly WorkContext[])[]
}

/**
 * The plan's works, grouped pod by pod and run by run.
 *
 * The flow is the compiler's stated one, never read back from the order of
 * the works. A pod of one station, and a flow of one round, both give the
 * same order under either flow, so an inference would pick a grouping at
 * random and report nothing wrong.
 *
 * On `laps` a run is one round of the pod, and it holds the pod's stations.
 * On `sets` a run is one station of the pod, and it holds that station's
 * rounds. Either way the leaf is the work, which is the dot.
 */
const groupWorks = (works: readonly WorkContext[], flowType: FlowType): readonly PodRuns[] => {
  const runKey = (work: WorkContext) => (flowType === 'laps' ? work.round : work.stationInPod)
  const inRun = (work: WorkContext) => (flowType === 'laps' ? work.stationInPod : work.round)
  const byPod = new Map<number, WorkContext[]>()
  for (const work of works) {
    const held = byPod.get(work.podIndex)
    if (held === undefined) byPod.set(work.podIndex, [work])
    else held.push(work)
  }
  const podIndexes = [...byPod.keys()].toSorted((left, right) => left - right)
  return podIndexes.map((podIndex) => {
    const byRun = new Map<number, WorkContext[]>()
    for (const work of byPod.get(podIndex) ?? []) {
      const key = runKey(work)
      const held = byRun.get(key)
      if (held === undefined) byRun.set(key, [work])
      else held.push(work)
    }
    const runKeys = [...byRun.keys()].toSorted((left, right) => left - right)
    return {
      podIndex,
      runs: runKeys.map((key) =>
        (byRun.get(key) ?? []).toSorted((left, right) => inRun(left) - inRun(right)),
      ),
    }
  })
}

/**
 * The gaps between the dots inside every run of one pod, from the run
 * lengths alone. A run of works and a run of states have the same shape here,
 * so the derivation and the renderer share the one sum.
 */
const runDotGapsPx = (runs: readonly { readonly length: number }[], budget: StripBudget): number =>
  runs.reduce((sum, run) => sum + budget.dotGapPx * Math.max(run.length - 1, 0), 0)

/** The gaps between the dots inside every run of one pod. */
const dotGapsPx = (pod: PodRuns, budget: StripBudget): number => runDotGapsPx(pod.runs, budget)

/**
 * How wide a pod of dots is drawn: its own dots, the gaps between them, and
 * the gaps between its runs.
 *
 * The renderer states this width in pixels rather than taking a `flex` share,
 * for two reasons. Pods with different station counts must read as different
 * widths, and a width the browser can interpolate is what lets the open pod's
 * move at a pod boundary ease instead of jump.
 *
 * It lives here, with the budget it spends and beside the sums the layout
 * choice divides against, so the width the screen draws cannot drift from the
 * width the derivation assumed.
 */
export const podDotsWidthPx = (
  pod: StripPod,
  dotSizePx: number,
  budget: StripBudget = STRIP_BUDGET,
): number => {
  const dots = pod.runs.reduce((sum, run) => sum + run.length, 0)
  return (
    dots * dotSizePx +
    runDotGapsPx(pod.runs, budget) +
    budget.runGapPx * Math.max(pod.runs.length - 1, 0)
  )
}

/** How many works one pod holds. */
const podWorkCount = (pod: PodRuns): number => pod.runs.reduce((sum, run) => sum + run.length, 0)

/**
 * The dot the open layout would draw: the strip less every gap it spends,
 * shared by every work of the plan. The strip spends width on gaps before it
 * spends any on dots, so a rule blind to them would report a dot as clearing
 * the floor that the screen then draws under it.
 */
const openDotPx = (pods: readonly PodRuns[], works: number, budget: StripBudget): number => {
  const gapsPx =
    budget.podGapPx * Math.max(pods.length - 1, 0) +
    pods.reduce(
      (sum, pod) =>
        sum + budget.runGapPx * Math.max(pod.runs.length - 1, 0) + dotGapsPx(pod, budget),
      0,
    )
  return (budget.stripWidthPx - gapsPx) / works
}

/**
 * The dot the focus layout would draw for the pod that is open. Every other
 * pod is a pill of a fixed width, so the open pod keeps whatever the pills
 * and their gaps leave.
 */
const focusDotPx = (pods: readonly PodRuns[], open: PodRuns, budget: StripBudget): number => {
  const availPx =
    budget.stripWidthPx -
    Math.max(pods.length - 1, 0) * (budget.pillWidthPx + budget.podGapPx) -
    budget.runGapPx * Math.max(open.runs.length - 1, 0) -
    dotGapsPx(open, budget)
  const works = podWorkCount(open)
  return works > 0 ? availPx / works : 0
}

/** A size the screen can draw: never past the cap, never under nothing. */
const drawableDotPx = (dotPx: number, budget: StripBudget): number =>
  Number.isFinite(dotPx) ? Math.max(0, Math.min(dotPx, budget.dotCapPx)) : 0

/**
 * Which pod the focus layout opens: the one that holds the current work.
 * With no work in focus it is the first pod, and with the ordinal past the
 * plan it is the last one — a strip that stops on the plan's end reads the
 * same as the plan's end.
 */
const openPodIndex = (
  pods: readonly PodRuns[],
  works: readonly WorkContext[],
  currentWorkIndex: number | undefined,
): number => {
  if (currentWorkIndex === undefined || currentWorkIndex < 0) return 0
  if (currentWorkIndex >= works.length) return pods.length - 1
  const podIndex = works[currentWorkIndex].podIndex
  return Math.max(
    0,
    pods.findIndex((pod) => pod.podIndex === podIndex),
  )
}

/**
 * The progress strip for one compiled plan and one work ordinal.
 *
 * This is the only place the strip's rules live. It is pure, so every branch
 * is provable without a screen, and the renderer draws what it is given and
 * decides nothing.
 *
 * `currentWorkIndex` is `undefined` while the session gets ready, and at any
 * other time with no work in focus. Everything then reads ahead, so the strip
 * never claims a station that nobody started.
 *
 * An ordinal at or past the plan's end is the session that is done. Every
 * mark then reads done, and the focus layout opens the last pod. The two
 * ends of a session must not draw the same picture: a strip that read ahead
 * at the finish would say the workout never ran.
 */
export const progressStrip = (
  compiled: CompiledWorkout,
  currentWorkIndex: number | undefined,
  budget: StripBudget = STRIP_BUDGET,
): ProgressStrip => {
  const works = sessionWorks(compiled.segments)
  const pods = groupWorks(works, compiled.flowType)
  if (pods.length === 0 || works.length === 0) {
    return { layout: 'open', dotSizePx: 0, pods: [] }
  }

  // An ordinal at or past the plan's end is the finish, and it reads every
  // mark done. `cellState` already does that for any ordinal above a work's
  // own, so the ordinal is kept rather than dropped.
  //
  // Anything else that names no work of this plan reads as no focus at all,
  // so nothing on the strip claims a station that nobody started. A stale
  // index survives an applied plan change, and it must not paint one.
  const focusIndex =
    currentWorkIndex !== undefined && currentWorkIndex >= 0 ? currentWorkIndex : undefined

  // The layout reads the plan and the budget only, never the current work, so
  // it holds for the whole session and nothing shifts under the participant.
  const openPx = openDotPx(pods, works.length, budget)
  const open = openPx >= budget.openFloorPx
  const opened = pods[openPodIndex(pods, works, currentWorkIndex)]
  const focusPx = focusDotPx(pods, opened, budget)
  const openedMode: StripPodMode = focusPx >= budget.focusFloorPx ? 'dots' : 'cells'
  // Open draws every pod. Focus draws the open pod, and gives every other pod
  // up to a pill.
  const modeOf = (pod: PodRuns): StripPodMode => {
    if (open) return 'dots'
    return pod.podIndex === opened.podIndex ? openedMode : 'pill'
  }

  return {
    layout: open ? 'open' : 'focus',
    dotSizePx: drawableDotPx(open ? openPx : focusPx, budget),
    pods: pods.map((pod) => {
      const runs = pod.runs.map((run) => run.map((work) => cellState(work.workIndex, focusIndex)))
      // A pod's works are one unbroken span under either flow, so the pod
      // reads as the span does: clamp the focus into the span, and the reading
      // of the clamp is the reading of the pod.
      const ordinals = pod.runs.flat().map((work) => work.workIndex)
      const first = Math.min(...ordinals)
      const last = Math.max(...ordinals)
      return {
        key: `pod-${pod.podIndex}`,
        state: cellState(Math.max(first, Math.min(last, focusIndex ?? first)), focusIndex),
        mode: modeOf(pod),
        runs,
      }
    }),
  }
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
