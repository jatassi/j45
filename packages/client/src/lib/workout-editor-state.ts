/**
 * The editor's draft state and its pure transitions. Kept out of
 * `workout-editor-screen.tsx` so that screen stays presentation + wiring
 * (the plan's shape), alongside `workout-draft.ts`'s flow/uniform/decode
 * logic which this layer defers to for every round-structural change.
 *
 * The draft is `Workout.Encoded`-shaped (numeric fields as strings, what
 * inputs hold mid-edit) plus a stable per-element `id` so React keys never
 * fall back to the array index and in-place edits preserve input focus.
 */

import type { Workout } from '@j45/domain'

import {
  collapseUniform,
  expandUniform,
  setRoundCount,
  type DraftFlow,
  type DraftRound,
  type DraftWorkout,
} from '@/lib/workout-draft'

/** A monotonic key source; structural ops mint fresh ids, edits keep them. */
let idSeq = 0
const nextId = (): number => (idSeq += 1)

export type EStation = { readonly id: number; readonly name: string; readonly detail?: string }
export type EPod = {
  readonly id: number
  readonly name: string
  readonly stations: readonly EStation[]
}
export type ERound = {
  readonly id: number
  readonly workSeconds: string
  readonly restSeconds: string
}

/**
 * `rounds` holds the single uniform pair when `uniform`, the full ladder
 * otherwise; `roundCountText` is the authoritative round count while uniform
 * (the ladder is re-expanded from it on decode).
 */
export type EditorState = {
  readonly name: string
  readonly focus: string
  readonly note: string
  readonly pods: readonly EPod[]
  readonly flowType: 'laps' | 'sets'
  readonly rounds: readonly ERound[]
  readonly uniform: boolean
  readonly roundCountText: string
}

export const blankState = (): EditorState => ({
  name: '',
  focus: 'cardio',
  note: '',
  pods: [{ id: nextId(), name: 'Pod 1', stations: [{ id: nextId(), name: '' }] }],
  flowType: 'laps',
  rounds: [{ id: nextId(), workSeconds: '', restSeconds: '' }],
  uniform: true,
  roundCountText: '1',
})

/** Editor state from an existing workout, collapsing a uniform ladder to one pair. */
export const workoutToState = (workout: Workout): EditorState => {
  const rounds = workout.flow.rounds.map((r) => ({
    workSeconds: String(r.workSeconds),
    restSeconds: String(r.restSeconds),
  }))
  const [first, ...rest] = rounds
  const uniform = rest.every(
    (r) => r.workSeconds === first.workSeconds && r.restSeconds === first.restSeconds,
  )
  return {
    name: workout.name,
    focus: workout.focus,
    note: workout.note ?? '',
    pods: workout.pods.map((p) => ({
      id: nextId(),
      name: p.name,
      stations: p.stations.map((s) =>
        s.detail === undefined
          ? { id: nextId(), name: s.name }
          : { id: nextId(), name: s.name, detail: s.detail },
      ),
    })),
    flowType: workout.flow.type,
    rounds: (uniform ? [first] : rounds).map((r) => ({ id: nextId(), ...r })),
    uniform,
    roundCountText: String(rounds.length),
  }
}

const updateAt = <T>(arr: readonly T[], index: number, fn: (value: T) => T): readonly T[] =>
  arr.map((value, i) => (i === index ? fn(value) : value))

const toDraftFlow = (state: EditorState): DraftFlow => ({
  type: state.flowType,
  rounds: state.rounds.map(({ workSeconds, restSeconds }) => ({ workSeconds, restSeconds })),
})

/** Adopt a draft flow's rounds, minting fresh ids (the structural round ops). */
const withRounds = (state: EditorState, flow: DraftFlow): EditorState => ({
  ...state,
  flowType: flow.type,
  rounds: flow.rounds.map((r) => ({ id: nextId(), ...r })),
})

const setPods = (state: EditorState, pods: readonly EPod[]): EditorState => ({ ...state, pods })

export const setName = (state: EditorState, name: string): EditorState => ({ ...state, name })
export const setFocus = (state: EditorState, focus: string): EditorState => ({ ...state, focus })
export const setNote = (state: EditorState, note: string): EditorState => ({ ...state, note })

export const addPod = (state: EditorState): EditorState =>
  setPods(state, [
    ...state.pods,
    { id: nextId(), name: `Pod ${state.pods.length + 1}`, stations: [{ id: nextId(), name: '' }] },
  ])

export const removePod = (state: EditorState, index: number): EditorState =>
  setPods(
    state,
    state.pods.filter((_, i) => i !== index),
  )

export const renamePod = (state: EditorState, index: number, name: string): EditorState =>
  setPods(
    state,
    updateAt(state.pods, index, (p) => ({ ...p, name })),
  )

const podStations = (
  state: EditorState,
  podIndex: number,
  fn: (stations: readonly EStation[]) => readonly EStation[],
): EditorState =>
  setPods(
    state,
    updateAt(state.pods, podIndex, (p) => ({ ...p, stations: fn(p.stations) })),
  )

export const addStation = (state: EditorState, podIndex: number): EditorState =>
  podStations(state, podIndex, (st) => [...st, { id: nextId(), name: '' }])

export const removeStation = (
  state: EditorState,
  podIndex: number,
  stationIndex: number,
): EditorState => podStations(state, podIndex, (st) => st.filter((_, i) => i !== stationIndex))

export type StationEdit = {
  readonly podIndex: number
  readonly stationIndex: number
  readonly patch: Partial<Omit<EStation, 'id'>>
}

export const setStationField = (state: EditorState, args: StationEdit): EditorState =>
  podStations(state, args.podIndex, (st) =>
    updateAt(st, args.stationIndex, (s) => ({ ...s, ...args.patch })),
  )

export type StationMove = {
  readonly podIndex: number
  readonly stationIndex: number
  readonly direction: -1 | 1
}

export const moveStation = (state: EditorState, args: StationMove): EditorState =>
  podStations(state, args.podIndex, (st) => {
    const target = args.stationIndex + args.direction
    if (target < 0 || target >= st.length) {
      return st
    }
    const copy = [...st]
    const moved = copy[args.stationIndex]
    copy[args.stationIndex] = copy[target]
    copy[target] = moved
    return copy
  })

export const setFlowType = (state: EditorState, type: 'laps' | 'sets'): EditorState => ({
  ...state,
  flowType: type,
})

export const toggleUniform = (state: EditorState): EditorState => {
  const flow = toDraftFlow(state)
  if (state.uniform) {
    const count = Number.parseInt(state.roundCountText, 10) || 1
    return { ...withRounds(state, expandUniform(flow, count)), uniform: false }
  }
  return {
    ...withRounds(state, collapseUniform(flow)),
    uniform: true,
    roundCountText: String(state.rounds.length),
  }
}

export const changeRoundCount = (state: EditorState, text: string): EditorState => {
  if (state.uniform) {
    return { ...state, roundCountText: text }
  }
  const n = Number.parseInt(text, 10)
  if (Number.isNaN(n) || n < 1) {
    return { ...state, roundCountText: text }
  }
  return { ...withRounds(state, setRoundCount(toDraftFlow(state), n)), roundCountText: text }
}

export const setRound = (
  state: EditorState,
  args: { readonly index: number; readonly patch: Partial<DraftRound> },
): EditorState => ({
  ...state,
  rounds: updateAt(state.rounds, args.index, (r) => ({ ...r, ...args.patch })),
})

/** Editor state as `DraftWorkout` (ids stripped, uniform ladder re-expanded) for decode/summary/save. */
export const effectiveDraft = (state: EditorState): DraftWorkout => {
  const flow = toDraftFlow(state)
  return {
    name: state.name,
    focus: state.focus,
    note: state.note.trim() === '' ? undefined : state.note,
    pods: state.pods.map((p) => ({
      name: p.name,
      stations: p.stations.map((s) =>
        s.detail === undefined ? { name: s.name } : { name: s.name, detail: s.detail },
      ),
    })),
    flow: state.uniform ? expandUniform(flow, Number.parseInt(state.roundCountText, 10)) : flow,
  }
}
