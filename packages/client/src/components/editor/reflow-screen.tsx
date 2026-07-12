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

import { ReflowFlowSection } from '@/components/editor/reflow-flow-section'
import { ReflowPodsSection } from '@/components/editor/reflow-pods-section'
import { PushHeader } from '@/components/shell/push-header'
import { Button } from '@/components/ui/button'
import * as ReflowDraft from '@/lib/reflow-draft'
import { ServerRpcClient } from '@/lib/rpc-client'
import { listWorkoutsAtom } from '@/lib/workouts'

/**
 * Launch-mode (reflow) screen rebuilt on the editor kit. Spec-shaped draft
 * lives here; pods/flow sections and the station-actions drawer sit alongside
 * the New/Edit kit under `components/editor/`.
 */

const updateWorkoutAtom = ServerRpcClient.mutation('UpdateWorkout')
const startSessionAtom = ServerRpcClient.mutation('StartSession')

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

/** Sticky `N works · MM:SS` chip; hidden while the reflow computation is a Left. */
function SummaryChip({ summary }: { readonly summary: string | null }) {
  if (summary === null) {
    return null
  }
  return (
    <div className="sticky top-[calc(env(safe-area-inset-top)+3rem)] z-10 border-b border-border/40 bg-background/80 px-6 py-2 backdrop-blur-md">
      <span data-testid="reflow-summary" className="text-sm text-muted-foreground">
        {summary}
      </span>
    </div>
  )
}

/** Header Start action, gated on a successful `computeReflow`. */
function StartAction(props: {
  readonly result: Either.Either<ReflowDraft.ReflowResult, string>
  readonly onStart: (reflow: Reflow) => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      data-testid="reflow-start"
      disabled={!Either.isRight(props.result)}
      onClick={() => {
        if (Either.isRight(props.result)) {
          props.onStart(props.result.right.reflow)
        }
      }}
    >
      Start
    </Button>
  )
}

/**
 * The launch-mode form. Holds the spec-shaped draft and computes one memoized
 * `applyReflow` + `compile` result per draft state — the chip, Start, and
 * Save all read from it, so they can never diverge; an invalid draft yields a
 * `Left` that disables both exits.
 */
function ReflowForm({ libraryWorkout }: { readonly libraryWorkout: LibraryWorkout }) {
  const { id, workout } = libraryWorkout
  const [state, setState] = React.useState(() => ReflowDraft.initReflowDraft(workout))
  const result = React.useMemo(() => ReflowDraft.computeReflow(workout, state), [workout, state])
  const summary = Either.isRight(result) ? ReflowDraft.reflowSummary(result.right) : null
  const onStart = useReflowStart(id)
  const onSave = useReflowSave(id)
  return (
    <div className="flex min-h-svh flex-col" data-testid="reflow-editor-screen">
      <PushHeader title="Launch setup" action={<StartAction result={result} onStart={onStart} />} />
      <SummaryChip summary={summary} />
      <div className="mx-auto flex w-full max-w-sm flex-col gap-6 p-6">
        <ReflowPodsSection state={state} setState={setState} />
        <ReflowFlowSection state={state} setState={setState} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="reflow-save"
          disabled={!Either.isRight(result)}
          onClick={() => {
            if (Either.isRight(result)) {
              onSave(result.right.workout)
            }
          }}
        >
          Save to plan
        </Button>
      </div>
    </div>
  )
}

/** `/workouts/$workoutId/reflow` — loads the workout via `GetWorkout` and mounts launch mode on it. */
export function ReflowWorkoutScreen() {
  const { workoutId } = useParams({ strict: false }) as { workoutId: string }
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
