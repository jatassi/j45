import * as React from 'react'

import { Result, useAtom, useAtomRefresh, useAtomValue } from '@effect-atom/atom-react'
import { WorkoutId, type LibraryWorkout, type Workout } from '@j45/domain'
import { useNavigate, useParams } from '@tanstack/react-router'
import * as Schema from 'effect/Schema'

import {
  EditorFooter,
  FlowSection,
  MetaSection,
  PodsSection,
} from '@/components/workout-editor-fields'
import { ServerRpcClient } from '@/lib/rpc-client'
import { decodeDraft, summarizeDraft } from '@/lib/workout-draft'
import * as Editor from '@/lib/workout-editor-state'
import { listWorkoutsAtom } from '@/lib/workouts'

/**
 * The two whole-document mutations, hoisted to module scope like every other
 * rpc atom in this codebase — a stable atom identity across re-renders.
 */
const createWorkoutAtom = ServerRpcClient.mutation('CreateWorkout')
const updateWorkoutAtom = ServerRpcClient.mutation('UpdateWorkout')

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
