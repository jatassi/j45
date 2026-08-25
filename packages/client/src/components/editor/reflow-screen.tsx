import * as React from 'react'

import { Result, useAtom, useAtomValue } from '@effect-atom/atom-react'
import {
  ReflowInvalid,
  ReflowRequest,
  WorkoutId,
  type LibraryWorkout,
  type Reflow,
  type SessionSummary,
} from '@j45/domain'
import { useNavigate, useParams } from '@tanstack/react-router'
import * as DateTime from 'effect/DateTime'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'
import { toast } from 'sonner'

import { LiveSaveDialog } from '@/components/editor/live-save-dialog'
import { ReflowFlowSection } from '@/components/editor/reflow-flow-section'
import { ReflowPodsSection } from '@/components/editor/reflow-pods-section'
import { useWorkoutSave } from '@/components/editor/use-workout-save'
import { PushHeader } from '@/components/shell/push-header'
import { Button } from '@/components/ui/button'
import { useLiquidGlass } from '@/glass/use-liquid-glass'
import * as ReflowDraft from '@/lib/reflow-draft'
import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * Launch-mode (reflow) screen rebuilt on the editor kit. Spec-shaped draft
 * lives here; pods/flow sections and the station-actions drawer sit alongside
 * the New/Edit kit under `components/editor/`.
 */

const startSessionAtom = ServerRpcClient.mutation('StartSession')

/**
 * Drives `StartSession({ workoutId, reflow })`, then navigates to the new
 * `/session/<id>`.
 *
 * The spec is positional indices into *this* copy of the plan's flattened
 * stations, so it travels as a `ReflowRequest` carrying the version it was
 * built from. If the plan moved on underneath, the server refuses rather
 * than launching a session over a valid-but-different set of stations, and
 * its `ReflowInvalid.reason` is what the launcher gets told.
 */
function useReflowStart(source: LibraryWorkout) {
  const navigate = useNavigate()
  const [, start] = useAtom(startSessionAtom, { mode: 'promise' })
  return (reflow: Reflow) =>
    void start({
      payload: {
        workoutId: source.id,
        reflow: new ReflowRequest({ spec: reflow, sourceUpdatedAt: source.updatedAt }),
      },
    })
      .then((summary: SessionSummary) => navigate({ to: `/session/${summary.id}` }))
      .catch((error: unknown) =>
        toast.error('Couldn’t start the session', {
          description:
            error instanceof ReflowInvalid ? error.reason : 'The session could not be started.',
        }),
      )
}

/** Sticky `N works · MM:SS` chip; hidden while the reflow computation is a Left. */
function SummaryChip({ summary }: { readonly summary: string | null }) {
  const surfaceRef = React.useRef<HTMLDivElement>(null)
  useLiquidGlass(surfaceRef)
  if (summary === null) {
    return null
  }
  return (
    <div className="sticky top-[calc(env(safe-area-inset-top)+3rem)] z-10">
      <div ref={surfaceRef} className="glass-surface rounded-none border-x-0 border-t-0 px-6 py-2">
        <span data-testid="reflow-summary" className="text-sm text-muted-foreground">
          {summary}
        </span>
      </div>
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
 *
 * The draft is seeded once, at mount, and its `sourceIndex`es only mean
 * anything against the workout it was seeded from — so this component must
 * never outlive that workout. `ReflowWorkoutScreen` keys it on `updatedAt`
 * to guarantee that: a re-fetched source remounts the form and re-seeds the
 * draft, rather than leaving old indices to resolve against a new plan (the
 * same silent wrong-stations failure the server's version precondition
 * refuses). Unlike the normal editor's draft — a whole workout body that
 * stands on its own — a reflow draft simply cannot survive its source
 * changing.
 */
function ReflowForm({ libraryWorkout }: { readonly libraryWorkout: LibraryWorkout }) {
  const { workout } = libraryWorkout
  const [state, setState] = React.useState(() => ReflowDraft.initReflowDraft(workout))
  const result = React.useMemo(() => ReflowDraft.computeReflow(workout, state), [workout, state])
  const summary = Either.isRight(result) ? ReflowDraft.reflowSummary(result.right) : null
  const onStart = useReflowStart(libraryWorkout)
  // On a conflict the shared hook re-fetches; `ReflowWorkoutScreen`'s key then
  // remounts this form, so the description below is a statement of fact.
  const save = useWorkoutSave({
    source: libraryWorkout,
    conflictDescription:
      'This workout changed on another device — the launch setup was rebuilt from the new version.',
  })
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
              save.save(result.right.workout)
            }
          }}
        >
          Save to plan
        </Button>
      </div>
      <LiveSaveDialog save={save} />
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
    // Keyed on the source version: see `ReflowForm`'s own doc — a re-fetched
    // source must re-seed the draft, never re-point it.
    onSuccess: ({ value }) => (
      <ReflowForm key={DateTime.toEpochMillis(value.updatedAt)} libraryWorkout={value} />
    ),
  })
}
