import * as React from 'react'

import { Result, useAtom, useAtomRefresh, useAtomValue } from '@effect-atom/atom-react'
import {
  WorkoutId,
  type LibraryWorkout,
  type Reflow,
  type SessionSummary,
  type Workout,
} from '@j45/domain'
import { useNavigate, useParams } from '@tanstack/react-router'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'

import { ReflowFlowSection, ReflowFooter, ReflowPodsSection } from '@/components/reflow-fields'
import {
  EditorFooter,
  FlowSection,
  MetaSection,
  PodsSection,
} from '@/components/workout-editor-fields'
import * as ReflowDraft from '@/lib/reflow-draft'
import { ServerRpcClient } from '@/lib/rpc-client'
import { decodeDraft, summarizeDraft } from '@/lib/workout-draft'
import * as Editor from '@/lib/workout-editor-state'
import { listWorkoutsAtom } from '@/lib/workouts'

/**
 * The whole-document mutations plus `StartSession`, hoisted to module scope
 * like every other rpc atom in this codebase — a stable atom identity across
 * re-renders.
 */
const createWorkoutAtom = ServerRpcClient.mutation('CreateWorkout')
const updateWorkoutAtom = ServerRpcClient.mutation('UpdateWorkout')
const startSessionAtom = ServerRpcClient.mutation('StartSession')

type EditorFormProps = {
  readonly heading: string
  readonly initial: Editor.EditorState
  readonly onSave: (workout: Workout) => void
  readonly onCancel: () => void
}

/**
 * The stateful authoring surface. Holds the draft as plain state and decodes
 * it once per render — the same `decodeDraft` powers Save (gated on success)
 * and the live summary chip; a non-decoding draft surfaces its first schema
 * error and disables Save.
 */
function WorkoutEditorForm({ heading, initial, onSave, onCancel }: EditorFormProps) {
  const [state, setState] = React.useState(initial)
  const draft = Editor.effectiveDraft(state)
  const decoded = decodeDraft(draft)
  const summary = summarizeDraft(draft)
  return (
    <div
      className="flex min-h-svh flex-col items-center gap-6 p-6"
      data-testid="workout-editor-screen"
    >
      <div className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-lg font-medium">{heading}</h1>
        <MetaSection state={state} setState={setState} />
        <PodsSection state={state} setState={setState} />
        <FlowSection state={state} setState={setState} />
        <EditorFooter decoded={decoded} summary={summary} onSave={onSave} onCancel={onCancel} />
      </div>
    </div>
  )
}

/** `/workouts/new` — a blank draft; Save creates a caller-owned workout and opens its detail. */
export function NewWorkoutScreen() {
  const navigate = useNavigate()
  const refreshList = useAtomRefresh(listWorkoutsAtom)
  const [, create] = useAtom(createWorkoutAtom, { mode: 'promise' })
  const onSave = (workout: Workout) => {
    void create({ payload: { workout } })
      .then((created: LibraryWorkout) => {
        refreshList()
        return navigate({ to: '/workouts/$workoutId', params: { workoutId: created.id } })
      })
      .catch(() => undefined)
  }
  return (
    <WorkoutEditorForm
      heading="New workout"
      initial={Editor.blankState()}
      onSave={onSave}
      onCancel={() => void navigate({ to: '/' })}
    />
  )
}

type EditFormProps = { readonly libraryWorkout: LibraryWorkout }

/** Drives `UpdateWorkout`, then refreshes the list + this workout's `GetWorkout` atom and reopens its detail. */
function EditWorkoutForm({ libraryWorkout }: EditFormProps) {
  const { id, workout } = libraryWorkout
  const navigate = useNavigate()
  const refreshList = useAtomRefresh(listWorkoutsAtom)
  const refreshWorkout = useAtomRefresh(ServerRpcClient.query('GetWorkout', { id }))
  const [, update] = useAtom(updateWorkoutAtom, { mode: 'promise' })
  const goDetail = () => void navigate({ to: '/workouts/$workoutId', params: { workoutId: id } })
  const onSave = (next: Workout) => {
    void update({ payload: { id, workout: next } })
      .then(() => {
        refreshList()
        refreshWorkout()
        goDetail()
      })
      .catch(() => undefined)
  }
  return (
    <WorkoutEditorForm
      heading="Edit workout"
      initial={Editor.workoutToState(workout)}
      onSave={onSave}
      onCancel={goDetail}
    />
  )
}

/** `/workouts/$workoutId/edit` — loads the workout via `GetWorkout` and mounts the editor on it. */
export function EditWorkoutScreen() {
  const { workoutId } = useParams({ from: '/workouts/$workoutId/edit' }) as { workoutId: string }
  const id = Schema.decodeSync(WorkoutId)(workoutId)
  const result = useAtomValue(ServerRpcClient.query('GetWorkout', { id }))
  return Result.match(result, {
    onInitial: () => <p className="p-6 text-sm text-muted-foreground">Loading workout…</p>,
    onFailure: () => (
      <p className="p-6 text-sm text-muted-foreground" data-testid="editor-load-error">
        This workout couldn&apos;t be found.
      </p>
    ),
    onSuccess: ({ value }) => <EditWorkoutForm libraryWorkout={value} />,
  })
}

// ── Launch mode (reflow) ─────────────────────────────────────────────────
//
// The restricted, spec-shaped editor — its form pieces live in
// `reflow-fields.tsx` (the reflow analogue of `workout-editor-fields.tsx`);
// this file owns the screen, the draft state, and the two exits.

/** Drives `StartSession({ workoutId, reflow })`, then navigates to the new `/session/<id>`. */
function useReflowStart(workoutId: WorkoutId) {
  const navigate = useNavigate()
  const [, start] = useAtom(startSessionAtom, { mode: 'promise' })
  return (reflow: Reflow) =>
    void start({ payload: { workoutId, reflow } })
      .then((summary: SessionSummary) => navigate({ to: `/session/${summary.id}` }))
      .catch(() => undefined)
}

/** Applies the reflow client-side via the existing `UpdateWorkout`, then reopens the refreshed detail. */
function useReflowSave(id: WorkoutId) {
  const navigate = useNavigate()
  const refreshList = useAtomRefresh(listWorkoutsAtom)
  const refreshWorkout = useAtomRefresh(ServerRpcClient.query('GetWorkout', { id }))
  const [, update] = useAtom(updateWorkoutAtom, { mode: 'promise' })
  return (workout: Workout) =>
    void update({ payload: { id, workout } })
      .then(() => {
        refreshList()
        refreshWorkout()
        return navigate({ to: '/workouts/$workoutId', params: { workoutId: id } })
      })
      .catch(() => undefined)
}

/**
 * The launch-mode form. Holds the spec-shaped draft and computes one memoized
 * `applyReflow` + `compile` result per draft state — the chip, Start, and
 * Save all read from it, so they can never diverge; an invalid draft yields a
 * `Left` that disables both exits.
 */
function ReflowForm({ libraryWorkout }: { readonly libraryWorkout: LibraryWorkout }) {
  const { id, workout } = libraryWorkout
  const navigate = useNavigate()
  const [state, setState] = React.useState(() => ReflowDraft.initReflowDraft(workout))
  const result = React.useMemo(() => ReflowDraft.computeReflow(workout, state), [workout, state])
  const summary = Either.isRight(result) ? ReflowDraft.reflowSummary(result.right) : null
  const onStart = useReflowStart(id)
  const onSave = useReflowSave(id)
  return (
    <div
      className="flex min-h-svh flex-col items-center gap-6 p-6"
      data-testid="reflow-editor-screen"
    >
      <div className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-lg font-medium">Start with reflow</h1>
        <ReflowPodsSection state={state} setState={setState} />
        <ReflowFlowSection state={state} setState={setState} />
        <ReflowFooter
          result={result}
          summary={summary}
          onStart={onStart}
          onSave={onSave}
          onCancel={() => void navigate({ to: '/workouts/$workoutId', params: { workoutId: id } })}
        />
      </div>
    </div>
  )
}

/** `/workouts/$workoutId/reflow` — loads the workout via `GetWorkout` and mounts launch mode on it. */
export function ReflowWorkoutScreen() {
  const { workoutId } = useParams({ from: '/workouts/$workoutId/reflow' }) as { workoutId: string }
  const id = Schema.decodeSync(WorkoutId)(workoutId)
  const result = useAtomValue(ServerRpcClient.query('GetWorkout', { id }))
  return Result.match(result, {
    onInitial: () => <p className="p-6 text-sm text-muted-foreground">Loading workout…</p>,
    onFailure: () => (
      <p className="p-6 text-sm text-muted-foreground" data-testid="reflow-load-error">
        This workout couldn&apos;t be found.
      </p>
    ),
    onSuccess: ({ value }) => <ReflowForm libraryWorkout={value} />,
  })
}
