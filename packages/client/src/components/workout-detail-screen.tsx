import * as React from 'react'

import { Dialog } from '@base-ui/react/dialog'
import { Result, useAtom, useAtomRefresh, useAtomValue } from '@effect-atom/atom-react'
import {
  compile,
  WorkoutId,
  WorkoutNotFound,
  type Flow,
  type LibraryWorkout,
  type Pod,
  type SessionSummary,
} from '@j45/domain'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import * as Cause from 'effect/Cause'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ServerRpcClient } from '@/lib/rpc-client'
import { formatDuration, listWorkoutsAtom } from '@/lib/workouts'

/**
 * The rename/duplicate/delete mutation atoms, hoisted to module scope like
 * `lib/workouts.ts`'s `listWorkoutsAtom` and `account-screen.tsx`'s
 * passkey atoms — a stable identity across re-renders.
 */
const renameWorkoutAtom = ServerRpcClient.mutation('RenameWorkout')
const duplicateWorkoutAtom = ServerRpcClient.mutation('DuplicateWorkout')
const deleteWorkoutAtom = ServerRpcClient.mutation('DeleteWorkout')
const startSessionAtom = ServerRpcClient.mutation('StartSession')

/** Popup styling shared by the rename and delete dialogs. */
const dialogPopupClassName =
  'fixed top-1/2 left-1/2 flex w-[calc(100%-2rem)] max-w-xs -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl bg-card p-4 text-card-foreground shadow-lg ring-1 ring-foreground/10'

/** The Edit action is a styled navigation `Link` (to the editor), not a mutation button like the others. */
const editLinkClass =
  'rounded-md border border-input bg-input/30 px-2.5 py-1.5 text-sm font-medium hover:bg-input/50'

/**
 * The flow's round structure as one line: `40″/20″ × 3` when every round
 * shares the same work/rest seconds (the common case — "uniform"), the
 * ladder listed round-by-round otherwise.
 */
function formatFlowSummary(flow: Flow): string {
  const [first, ...rest] = flow.rounds
  return rest.every(
    (round) => round.workSeconds === first.workSeconds && round.restSeconds === first.restSeconds,
  )
    ? `${first.workSeconds}″/${first.restSeconds}″ × ${flow.rounds.length}`
    : flow.rounds.map((round) => `${round.workSeconds}″/${round.restSeconds}″`).join(', ')
}

/** One pod: its name, and the stations (name + optional muted `detail`) it runs, in order. */
function PodCard({ pod }: { readonly pod: Pod }) {
  return (
    <Card size="sm" data-testid="pod">
      <CardHeader>
        <CardTitle data-testid="pod-name">{pod.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {pod.stations.map((station) => (
            <li key={station.name} className="flex flex-col text-sm" data-testid="station">
              <span data-testid="station-name">{station.name}</span>
              {station.detail === undefined ? null : (
                <span className="text-muted-foreground" data-testid="station-detail">
                  {station.detail}
                </span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

type RenameDialogProps = {
  readonly open: boolean
  readonly name: string
  readonly onNameChange: (name: string) => void
  readonly onCancel: () => void
  readonly onSubmit: (event: React.SubmitEvent<HTMLFormElement>) => void
}

/** The rename dialog: a single name field, pre-filled with the workout's current name. */
function RenameDialog({ open, name, onNameChange, onCancel, onSubmit }: RenameDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/50" />
        <Dialog.Popup data-testid="rename-dialog" className={dialogPopupClassName}>
          <Dialog.Title className="text-base font-medium">Rename workout</Dialog.Title>
          <form className="flex flex-col gap-3" onSubmit={onSubmit}>
            <input
              className="rounded-md border border-input bg-input/30 px-2.5 py-1.5 text-sm"
              data-testid="rename-input"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="rename-cancel"
                onClick={onCancel}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" data-testid="rename-confirm">
                Save
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

type DeleteDialogProps = {
  readonly open: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

/** The delete confirmation dialog: no undo, so it never fires on a single click. */
function DeleteDialog({ open, onCancel, onConfirm }: DeleteDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/50" />
        <Dialog.Popup data-testid="delete-dialog" className={dialogPopupClassName}>
          <Dialog.Title className="text-base font-medium">Delete workout</Dialog.Title>
          <Dialog.Description className="text-sm text-muted-foreground">
            This can&apos;t be undone.
          </Dialog.Description>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="delete-cancel"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              data-testid="delete-confirm"
              onClick={onConfirm}
            >
              Delete
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * Drives `RenameWorkout` from `RenameDialog`'s open/name/submit props,
 * pre-filling `name` with `currentName` each time the dialog opens. Calls
 * `onRenamed` (never the mutation's own payload) once the rpc settles, so
 * the caller decides what "renamed" means — here, refreshing both the list
 * and this workout's own `GetWorkout` atom.
 */
function useRenameDialog(id: WorkoutId, currentName: string, onRenamed: () => void) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState(currentName)
  const [, rename] = useAtom(renameWorkoutAtom, { mode: 'promise' })

  const openDialog = () => {
    setName(currentName)
    setOpen(true)
  }

  // A rejection surfaces via renameWorkoutAtom's own Result; the dialog simply stays open.
  const submit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    void rename({ payload: { id, name } })
      .then(() => {
        onRenamed()
        setOpen(false)
      })
      .catch(() => undefined)
  }

  return { open, name, setName, openDialog, close: () => setOpen(false), submit }
}

/** Drives `DeleteWorkout` from `DeleteDialog`'s open/confirm props; `onDeleted` fires once the rpc settles. */
function useDeleteDialog(id: WorkoutId, onDeleted: () => void) {
  const [open, setOpen] = React.useState(false)
  const [, remove] = useAtom(deleteWorkoutAtom, { mode: 'promise' })

  // A rejection surfaces via deleteWorkoutAtom's own Result; the confirm dialog simply stays open.
  const confirm = () => {
    void remove({ payload: { id } })
      .then(() => {
        setOpen(false)
        onDeleted()
      })
      .catch(() => undefined)
  }

  return { open, openDialog: () => setOpen(true), close: () => setOpen(false), confirm }
}

/** Drives `DuplicateWorkout` from a plain click; `onDuplicated` fires once the rpc settles. */
function useDuplicateWorkout(id: WorkoutId, onDuplicated: () => void) {
  const [, duplicate] = useAtom(duplicateWorkoutAtom, { mode: 'promise' })
  // A rejection surfaces via duplicateWorkoutAtom's own Result; nothing further to do here.
  return () =>
    void duplicate({ payload: { id } })
      .then(onDuplicated)
      .catch(() => undefined)
}

/** Drives `StartSession` and navigates to `/session/<id>` with the returned summary's id. */
function useStartSession(workoutId: WorkoutId) {
  const navigate = useNavigate()
  const [, start] = useAtom(startSessionAtom, { mode: 'promise' })
  return () =>
    void start({ payload: { workoutId } })
      .then((summary: SessionSummary) => navigate({ to: `/session/${summary.id}` }))
      .catch(() => undefined)
}

type ActionButtonsProps = {
  readonly onRename: () => void
  readonly onDuplicate: () => void
  readonly onDelete: () => void
}

/** Rename / duplicate / delete triggers — split out to keep `WorkoutActions` under `max-lines-per-function`. */
function ActionButtons({ onRename, onDuplicate, onDelete }: ActionButtonsProps) {
  const actions = [
    { testid: 'rename-button', label: 'Rename', variant: 'outline', onClick: onRename },
    { testid: 'duplicate-button', label: 'Duplicate', variant: 'outline', onClick: onDuplicate },
    { testid: 'delete-button', label: 'Delete', variant: 'destructive', onClick: onDelete },
  ] as const
  return (
    <div className="flex items-center gap-2">
      {actions.map(({ testid, label, variant, onClick }) => (
        <Button
          key={testid}
          type="button"
          variant={variant}
          size="sm"
          data-testid={testid}
          onClick={onClick}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}

type WorkoutActionsProps = {
  readonly id: WorkoutId
  readonly name: string
}

/**
 * Rename, duplicate, and delete — each drives its own mutation atom
 * (`ServerRpcClient.mutation`, via the hooks above) and, on success,
 * refreshes `listWorkoutsAtom` (module-scoped in `lib/workouts.ts`) so the
 * home list reflects the change without a reload. Rename also refreshes
 * this workout's own `GetWorkout` atom so the header updates in place;
 * duplicate and delete both navigate home afterwards — duplicate because
 * the copy belongs in the list, not on this (the original's) page, delete
 * because this page's workout no longer exists.
 */
function WorkoutActions({ id, name }: WorkoutActionsProps) {
  const navigate = useNavigate()
  const refreshList = useAtomRefresh(listWorkoutsAtom)
  const refreshWorkout = useAtomRefresh(ServerRpcClient.query('GetWorkout', { id }))
  const goHome = () => void navigate({ to: '/' })

  const renameDialog = useRenameDialog(id, name, () => {
    refreshList()
    refreshWorkout()
  })
  const handleDuplicate = useDuplicateWorkout(id, () => {
    refreshList()
    goHome()
  })
  const deleteDialog = useDeleteDialog(id, () => {
    refreshList()
    goHome()
  })

  return (
    <>
      <Link to={`/workouts/${id}/edit`} data-testid="edit-button" className={editLinkClass}>
        Edit
      </Link>
      <ActionButtons
        onRename={renameDialog.openDialog}
        onDuplicate={handleDuplicate}
        onDelete={deleteDialog.openDialog}
      />
      <RenameDialog
        open={renameDialog.open}
        name={renameDialog.name}
        onNameChange={renameDialog.setName}
        onCancel={renameDialog.close}
        onSubmit={renameDialog.submit}
      />
      <DeleteDialog
        open={deleteDialog.open}
        onCancel={deleteDialog.close}
        onConfirm={deleteDialog.confirm}
      />
    </>
  )
}

/** Start session, plus the Start-with-reflow entry into launch mode
 *  (`/workouts/<id>/reflow`) — run reflowed without editing the saved plan. */
function StartActions({ id, onStart }: { readonly id: WorkoutId; readonly onStart: () => void }) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <Button type="button" className="w-full" data-testid="start-session-button" onClick={onStart}>
        Start session
      </Button>
      <Link
        to={`/workouts/${id}/reflow`}
        data-testid="start-with-reflow-button"
        className={`${editLinkClass} text-center`}
      >
        Start with reflow
      </Link>
    </div>
  )
}

/** The fetched workout's flow summary, pods/stations, total duration, and actions. */
function WorkoutDetail({ libraryWorkout }: { readonly libraryWorkout: LibraryWorkout }) {
  const { id, workout } = libraryWorkout
  const { totalDurationMillis } = compile(workout)
  const onStartSession = useStartSession(id)

  return (
    <div
      className="flex min-h-svh flex-col items-center gap-6 p-6"
      data-testid="workout-detail-screen"
    >
      <header className="flex w-full max-w-sm flex-col gap-2">
        <Link
          to="/library"
          data-testid="library-nav-link"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          ← Your library
        </Link>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-medium" data-testid="workout-title">
            {workout.name}
          </h1>
          <WorkoutActions id={id} name={workout.name} />
        </div>
        <p className="text-sm text-muted-foreground" data-testid="workout-focus">
          {workout.focus}
        </p>
      </header>
      <div className="flex w-full max-w-sm items-center justify-between text-sm text-muted-foreground">
        <span data-testid="workout-flow-summary">{formatFlowSummary(workout.flow)}</span>
        <span data-testid="workout-duration">{formatDuration(totalDurationMillis)}</span>
      </div>
      <StartActions id={id} onStart={onStartSession} />
      <ul className="flex w-full max-w-sm flex-col gap-3">
        {workout.pods.map((pod) => (
          <li key={pod.name}>
            <PodCard pod={pod} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * A human-readable state for a failed `GetWorkout` — `WorkoutNotFound`
 * (foreign or deleted id) renders its own message; anything else (a
 * connectivity failure, say) renders a generic one. Either way the screen
 * never goes blank.
 */
function WorkoutFailure({ cause }: { readonly cause: Cause.Cause<unknown> }) {
  const error = Cause.failureOption(cause)
  const notFound = Option.isSome(error) && error.value instanceof WorkoutNotFound

  return notFound ? (
    <p className="p-6 text-sm text-muted-foreground" data-testid="workout-not-found">
      This workout couldn&apos;t be found.
    </p>
  ) : (
    <p className="p-6 text-sm text-destructive" data-testid="workout-load-error">
      Failed to load this workout: {String(cause)}
    </p>
  )
}

/**
 * `/workouts/$workoutId` (see `router.tsx`): fetches the workout by its
 * route param (`GetWorkout`) and renders its flow summary, pods/stations,
 * and total duration, or a human-readable state if it can't be found —
 * never a blank screen. `LibraryScreen`'s cards `Link` here.
 */
export function WorkoutDetailScreen() {
  const { workoutId: rawWorkoutId } = useParams({ strict: false }) as {
    workoutId: string
  }
  const workoutId = Schema.decodeSync(WorkoutId)(rawWorkoutId)
  const workoutResult = useAtomValue(ServerRpcClient.query('GetWorkout', { id: workoutId }))

  return Result.match(workoutResult, {
    onInitial: () => <p className="p-6 text-sm text-muted-foreground">Loading workout…</p>,
    onFailure: (failure) => <WorkoutFailure cause={failure.cause} />,
    onSuccess: ({ value }) => <WorkoutDetail libraryWorkout={value} />,
  })
}
