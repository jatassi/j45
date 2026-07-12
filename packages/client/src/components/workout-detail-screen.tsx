import * as React from 'react'

import { Result, useAtom, useAtomRefresh, useAtomValue } from '@effect-atom/atom-react'
import {
  compile,
  flowTypeLabel,
  WorkoutId,
  WorkoutNotFound,
  type Flow,
  type LibraryWorkout,
  type Pod,
  type Round,
  type SessionSummary,
} from '@j45/domain'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import * as Cause from 'effect/Cause'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { toast } from 'sonner'

import { FocusBadge } from '@/components/focus-badge'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ServerRpcClient } from '@/lib/rpc-client'
import { formatDuration, listWorkoutsAtom } from '@/lib/workouts'

const renameWorkoutAtom = ServerRpcClient.mutation('RenameWorkout')
const duplicateWorkoutAtom = ServerRpcClient.mutation('DuplicateWorkout')
const deleteWorkoutAtom = ServerRpcClient.mutation('DeleteWorkout')
const startSessionAtom = ServerRpcClient.mutation('StartSession')
const toastFailed = (d: string) => toast.error('Command failed', { description: d })
const outlineSm = buttonVariants({ variant: 'outline', size: 'sm' })
const reflowBtn = `${buttonVariants({ variant: 'outline', size: 'lg' })} min-h-12 flex-1`

function formatFlowTiming(flow: Flow): string {
  const [first, ...rest] = flow.rounds
  const uniform = rest.every(
    (r) => r.workSeconds === first.workSeconds && r.restSeconds === first.restSeconds,
  )
  return uniform
    ? `${first.workSeconds}″/${first.restSeconds}″ × ${flow.rounds.length}`
    : flow.rounds.map((r) => `${r.workSeconds}″/${r.restSeconds}″`).join(', ')
}

function PodCard({ pod, round }: { readonly pod: Pod; readonly round: Round }) {
  return (
    <Card size="sm" data-testid="pod">
      <CardHeader>
        <CardTitle data-testid="pod-name" className="font-bold tracking-tight">
          {pod.name}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {pod.stations.map((s) => (
            <li
              key={s.name}
              className="flex items-start justify-between gap-2 text-sm"
              data-testid="station"
            >
              <span className="flex min-w-0 flex-col">
                <span data-testid="station-name">{s.name}</span>
                {s.detail === undefined ? null : (
                  <span className="text-muted-foreground" data-testid="station-detail">
                    {s.detail}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Badge variant="work">{round.workSeconds}″</Badge>
                <Badge variant="rest">{round.restSeconds}″</Badge>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function RenameDialog(p: {
  open: boolean
  name: string
  onNameChange: (n: string) => void
  onCancel: () => void
  onSubmit: (e: React.SubmitEvent<HTMLFormElement>) => void
}) {
  return (
    <Dialog open={p.open} onOpenChange={(n) => (n ? undefined : p.onCancel())}>
      <DialogContent data-testid="rename-dialog" showCloseButton={false}>
        <DialogTitle>Rename workout</DialogTitle>
        <form className="flex flex-col gap-4" onSubmit={p.onSubmit}>
          <Field orientation="vertical">
            <FieldLabel htmlFor="rename-workout-name">Name</FieldLabel>
            <Input
              id="rename-workout-name"
              data-testid="rename-input"
              value={p.name}
              onChange={(e) => p.onNameChange(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="rename-cancel"
              onClick={p.onCancel}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" data-testid="rename-confirm">
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDialog(p: { open: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <AlertDialog open={p.open} onOpenChange={(n) => (n ? undefined : p.onCancel())}>
      <AlertDialogContent data-testid="delete-dialog" size="sm">
        <AlertDialogTitle>Delete workout</AlertDialogTitle>
        <AlertDialogDescription>This can&apos;t be undone.</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="delete-cancel" size="sm">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            size="sm"
            data-testid="delete-confirm"
            onClick={p.onConfirm}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function useWorkoutMutations(id: WorkoutId, name: string) {
  const navigate = useNavigate()
  const refreshList = useAtomRefresh(listWorkoutsAtom)
  const refreshWorkout = useAtomRefresh(ServerRpcClient.query('GetWorkout', { id }))
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [renameName, setRenameName] = React.useState(name)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [, rename] = useAtom(renameWorkoutAtom, { mode: 'promise' })
  const [, duplicate] = useAtom(duplicateWorkoutAtom, { mode: 'promise' })
  const [, remove] = useAtom(deleteWorkoutAtom, { mode: 'promise' })
  return {
    renameOpen,
    renameName,
    setRenameName,
    openRename: () => {
      setRenameName(name)
      setRenameOpen(true)
    },
    closeRename: () => setRenameOpen(false),
    submitRename: (e: React.SubmitEvent<HTMLFormElement>) => {
      e.preventDefault()
      void rename({ payload: { id, name: renameName } })
        .then(() => {
          refreshList()
          refreshWorkout()
          setRenameOpen(false)
        })
        .catch(() => toastFailed('Could not rename the workout.'))
    },
    deleteOpen,
    openDelete: () => setDeleteOpen(true),
    closeDelete: () => setDeleteOpen(false),
    confirmDelete: () => {
      void remove({ payload: { id } })
        .then(() => {
          setDeleteOpen(false)
          refreshList()
          void navigate({ to: '/library' })
        })
        .catch(() => toastFailed('Could not delete the workout.'))
    },
    onDuplicate: () =>
      void duplicate({ payload: { id } })
        .then(() => {
          refreshList()
          void navigate({ to: '/' })
        })
        .catch(() => toastFailed('Could not duplicate the workout.')),
  }
}

function WorkoutActions({ id, name }: { readonly id: WorkoutId; readonly name: string }) {
  const m = useWorkoutMutations(id, name)
  const btns = [
    ['rename-button', 'Rename', 'outline', m.openRename],
    ['duplicate-button', 'Duplicate', 'outline', m.onDuplicate],
    ['delete-button', 'Delete', 'destructive', m.openDelete],
  ] as const
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/workouts/${id}/edit`} data-testid="edit-button" className={outlineSm}>
          Edit
        </Link>
        {btns.map(([testid, label, variant, onClick]) => (
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
      <RenameDialog
        open={m.renameOpen}
        name={m.renameName}
        onNameChange={m.setRenameName}
        onCancel={m.closeRename}
        onSubmit={m.submitRename}
      />
      <DeleteDialog open={m.deleteOpen} onCancel={m.closeDelete} onConfirm={m.confirmDelete} />
    </>
  )
}

function TitleBlock({ workout }: { readonly workout: LibraryWorkout['workout'] }) {
  const { totalDurationMillis, workTotal } = compile(workout)
  const summary = `${flowTypeLabel[workout.flow.type]} · ${formatFlowTiming(workout.flow)}`
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-bold tracking-tight" data-testid="workout-title">
        {workout.name}
      </h1>
      <div className="flex flex-wrap items-center gap-2">
        <FocusBadge focus={workout.focus} data-testid="workout-focus" />
        <span className="text-sm text-muted-foreground" data-testid="workout-flow-summary">
          {summary}
        </span>
      </div>
      <p className="text-sm text-muted-foreground" data-testid="workout-works-summary">
        {workTotal} works ·{' '}
        <span data-testid="workout-duration">{formatDuration(totalDurationMillis)}</span>
      </p>
    </div>
  )
}

function StartRow({ id, onStart }: { readonly id: WorkoutId; readonly onStart: () => void }) {
  return (
    <div className="flex w-full max-w-sm items-stretch gap-2">
      <Button className="h-12 flex-1" data-testid="start-session-button" onClick={onStart}>
        Start
      </Button>
      <Link
        to={`/workouts/${id}/reflow`}
        data-testid="start-with-reflow-button"
        className={reflowBtn}
      >
        Start with reflow
      </Link>
    </div>
  )
}

function WorkoutDetail({ libraryWorkout }: { readonly libraryWorkout: LibraryWorkout }) {
  const { id, workout } = libraryWorkout
  const navigate = useNavigate()
  const [, start] = useAtom(startSessionAtom, { mode: 'promise' })
  const leadRound = workout.flow.rounds[0]
  const onStart = () =>
    void start({ payload: { workoutId: id } })
      .then((s: SessionSummary) => navigate({ to: `/session/${s.id}` }))
      .catch(() => toastFailed('Could not start the session.'))
  return (
    <div
      className="flex min-h-svh flex-col items-center gap-6 p-6"
      data-testid="workout-detail-screen"
    >
      <header className="flex w-full max-w-sm flex-col gap-3">
        <Link
          to="/library"
          data-testid="library-nav-link"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          ← Your library
        </Link>
        <TitleBlock workout={workout} />
        <WorkoutActions id={id} name={workout.name} />
      </header>
      <StartRow id={id} onStart={onStart} />
      <ul className="flex w-full max-w-sm flex-col gap-3">
        {workout.pods.map((pod) => (
          <li key={pod.name}>
            <PodCard pod={pod} round={leadRound} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function WorkoutFailure({ cause }: { readonly cause: Cause.Cause<unknown> }) {
  const error = Cause.failureOption(cause)
  const notFound = Option.isSome(error) && error.value instanceof WorkoutNotFound
  return (
    <div className="flex min-h-svh flex-col items-center p-6">
      <Alert
        variant={notFound ? 'default' : 'destructive'}
        className="w-full max-w-sm"
        data-testid={notFound ? 'workout-not-found' : 'workout-load-error'}
      >
        <AlertTitle>{notFound ? 'Workout not found' : 'Failed to load'}</AlertTitle>
        <AlertDescription>
          {notFound ? 'This workout could not be found.' : String(cause)}
        </AlertDescription>
        {notFound ? (
          <AlertAction>
            <Link to="/library" data-testid="workout-not-found-library-link" className={outlineSm}>
              Back to library
            </Link>
          </AlertAction>
        ) : null}
      </Alert>
    </div>
  )
}

export function WorkoutDetailScreen() {
  const { workoutId: raw } = useParams({ strict: false }) as { workoutId: string }
  const workoutId = Schema.decodeSync(WorkoutId)(raw)
  const result = useAtomValue(ServerRpcClient.query('GetWorkout', { id: workoutId }))
  return Result.match(result, {
    onInitial: () => <p className="p-6 text-sm text-muted-foreground">Loading workout…</p>,
    onFailure: (f) => <WorkoutFailure cause={f.cause} />,
    onSuccess: ({ value }) => <WorkoutDetail libraryWorkout={value} />,
  })
}
