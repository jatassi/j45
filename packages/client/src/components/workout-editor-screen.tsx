import * as React from 'react'

import { Result, useAtom, useAtomRefresh, useAtomValue } from '@effect-atom/atom-react'
import { WorkoutId, type LibraryWorkout, type Workout } from '@j45/domain'
import { useNavigate, useParams } from '@tanstack/react-router'
import * as Schema from 'effect/Schema'
import { toast } from 'sonner'

import { WorkoutEditorForm } from '@/components/editor/editor-form'
import { useWorkoutSave } from '@/components/editor/use-workout-save'
import { takeInitialDraft } from '@/lib/editor-draft'
import { ServerRpcClient } from '@/lib/rpc-client'
import * as Editor from '@/lib/workout-editor-state'
import { listWorkoutsAtom } from '@/lib/workouts'

// Launch-mode reflow lives in `editor/reflow-screen.tsx` (kit rebuild).
export { ReflowWorkoutScreen } from '@/components/editor/reflow-screen'

/**
 * `CreateWorkout`, hoisted to module scope like every other rpc atom in this
 * codebase — a stable atom identity across re-renders. `UpdateWorkout` lives
 * in `editor/use-workout-save.ts`, which both editors save through.
 */
const createWorkoutAtom = ServerRpcClient.mutation('CreateWorkout')

/**
 * `/workouts/new` — blank draft, or a one-shot pending draft from
 * `takeInitialDraft` when generation (or another producer) handed one off.
 * Save creates a caller-owned workout and opens its detail.
 */
export function NewWorkoutScreen() {
  const navigate = useNavigate()
  const refreshList = useAtomRefresh(listWorkoutsAtom)
  const [, create] = useAtom(createWorkoutAtom, { mode: 'promise' })
  // Consume the handoff once on mount; remounts after take see blankState.
  const initial = React.useMemo(() => {
    const draft = takeInitialDraft()
    return draft === undefined ? Editor.blankState() : Editor.workoutToState(draft)
  }, [])
  const onSave = (workout: Workout) => {
    void create({ payload: { workout } })
      .then((created: LibraryWorkout) => {
        refreshList()
        return navigate({ to: '/workouts/$workoutId', params: { workoutId: created.id } })
      })
      .catch(() => toast.error('Command failed', { description: 'Could not save the workout.' }))
  }
  return (
    <WorkoutEditorForm
      heading="New workout"
      initial={initial}
      onSave={onSave}
      onExitFallback={() => void navigate({ to: '/' })}
    />
  )
}

type EditFormProps = { readonly libraryWorkout: LibraryWorkout }

/**
 * Drives `UpdateWorkout` through `useWorkoutSave`, which carries the version
 * this editor loaded as the write's precondition.
 *
 * On a conflict the shared hook re-fetches, which leaves this editor holding
 * the winner's version with the user's own edits still in the draft —
 * `WorkoutEditorForm` seeds its state at mount, so a refreshed `initial`
 * never overwrites them. Saving again is then a deliberate second act, and it
 * carries the fresh version. (Launch mode is the opposite: see
 * `editor/reflow-screen.tsx`.)
 */
function EditWorkoutForm({ libraryWorkout }: EditFormProps) {
  const { id, workout } = libraryWorkout
  const navigate = useNavigate()
  const goDetail = () => void navigate({ to: '/workouts/$workoutId', params: { workoutId: id } })
  const onSave = useWorkoutSave({
    source: libraryWorkout,
    conflictDescription:
      'This workout changed on another device. Your edits are still here — save again to apply them on top.',
  })
  return (
    <WorkoutEditorForm
      heading="Edit"
      initial={Editor.workoutToState(workout)}
      onSave={onSave}
      onExitFallback={goDetail}
    />
  )
}

/** `/workouts/$workoutId/edit` — loads the workout via `GetWorkout` and mounts the editor on it. */
export function EditWorkoutScreen() {
  const { workoutId } = useParams({ strict: false }) as { workoutId: string }
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
