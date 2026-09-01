import * as React from 'react'

import { Result, useAtom, useAtomRefresh, useAtomValue } from '@effect-atom/atom-react'
import {
  Equipment,
  equipmentLabel,
  intensityLabel,
  Modality,
  modalityLabel,
  MuscleGroup,
  muscleGroupLabel,
  type Exercise,
  type ExerciseId,
  type LibraryExercise,
} from '@j45/domain'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'

import { DeleteAlert, ExerciseDrawer } from '@/components/exercise-catalog-overlays'
import { FacetGroup } from '@/components/facet-group'
import { LibrarySegments } from '@/components/library-segments'
import { QueryBoundary } from '@/components/query-boundary'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  createExerciseAtom,
  deleteExerciseAtom,
  listExercisesAtom,
  updateExerciseAtom,
} from '@/lib/exercises'

const MODALITIES = Modality.literals
const MUSCLE_GROUPS = MuscleGroup.literals
const EQUIPMENT = Equipment.literals

type Filters = {
  readonly muscleGroups: ReadonlySet<MuscleGroup>
  readonly equipment: ReadonlySet<Equipment>
  readonly modalities: ReadonlySet<Modality>
}

const emptyFilters: Filters = {
  muscleGroups: new Set(),
  equipment: new Set(),
  modalities: new Set(),
}

type DrawerState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly id: ExerciseId }

function matchesFilters(exercise: Exercise, filters: Filters): boolean {
  const muscleOk =
    filters.muscleGroups.size === 0 ||
    exercise.muscleGroups.some((g) => filters.muscleGroups.has(g))
  const equipmentOk =
    filters.equipment.size === 0 || exercise.equipment.some((eq) => filters.equipment.has(eq))
  const modalityOk = filters.modalities.size === 0 || filters.modalities.has(exercise.modality)
  return muscleOk && equipmentOk && modalityOk
}

function FilterBar(props: {
  readonly exercises: readonly LibraryExercise[]
  readonly filters: Filters
  readonly setFilters: React.Dispatch<React.SetStateAction<Filters>>
}) {
  const { exercises, filters, setFilters } = props
  const mods = new Set(exercises.map((e) => e.exercise.modality))
  const muscles = new Set(exercises.flatMap((e) => e.exercise.muscleGroups))
  const equip = new Set(exercises.flatMap((e) => e.exercise.equipment))
  return (
    <div className="flex w-full flex-col gap-2" data-testid="filter-bar">
      <FacetGroup
        values={MODALITIES.filter((m) => mods.has(m))}
        selected={[...filters.modalities]}
        labels={modalityLabel}
        testIdPrefix="filter-modality"
        onChange={(next) => setFilters((p) => ({ ...p, modalities: new Set(next) }))}
      />
      <FacetGroup
        values={MUSCLE_GROUPS.filter((g) => muscles.has(g))}
        selected={[...filters.muscleGroups]}
        labels={muscleGroupLabel}
        testIdPrefix="filter-muscle"
        onChange={(next) => setFilters((p) => ({ ...p, muscleGroups: new Set(next) }))}
      />
      <FacetGroup
        values={EQUIPMENT.filter((eq) => equip.has(eq))}
        selected={[...filters.equipment]}
        labels={equipmentLabel}
        testIdPrefix="filter-equipment"
        onChange={(next) => setFilters((p) => ({ ...p, equipment: new Set(next) }))}
      />
    </div>
  )
}

function RowTags({ exercise }: { readonly exercise: Exercise }) {
  const equip =
    exercise.equipment.length === 0
      ? (['Bodyweight'] as const)
      : exercise.equipment.map((eq) => equipmentLabel[eq])
  return (
    <div className="flex flex-wrap gap-1">
      <Badge variant={exercise.modality}>{modalityLabel[exercise.modality]}</Badge>
      <Badge variant="secondary">{intensityLabel[exercise.intensity]}</Badge>
      {exercise.muscleGroups.map((g) => (
        <Badge key={g} variant="outline">
          {muscleGroupLabel[g]}
        </Badge>
      ))}
      {equip.map((tag) => (
        <Badge key={tag} variant="outline">
          {tag}
        </Badge>
      ))}
    </div>
  )
}

function ExerciseRow(props: {
  readonly entry: LibraryExercise
  readonly onEdit: () => void
  readonly onDelete: () => void
}) {
  const { entry, onEdit, onDelete } = props
  const { exercise } = entry
  return (
    <li
      className="flex flex-col gap-2 rounded-lg border border-border p-3"
      data-testid={`exercise-row-${entry.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium" data-testid={`exercise-name-${entry.id}`}>
            {exercise.name}
          </span>
          {exercise.detail === undefined ? null : (
            <span className="text-xs text-muted-foreground">{exercise.detail}</span>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid={`edit-exercise-${entry.id}`}
            onClick={onEdit}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid={`delete-exercise-${entry.id}`}
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
      </div>
      <RowTags exercise={exercise} />
    </li>
  )
}

function useExerciseMutations() {
  const refresh = useAtomRefresh(listExercisesAtom)
  const [, create] = useAtom(createExerciseAtom, { mode: 'promise' })
  const [, update] = useAtom(updateExerciseAtom, { mode: 'promise' })
  const [, remove] = useAtom(deleteExerciseAtom, { mode: 'promise' })
  const [busy, setBusy] = React.useState(false)
  const run = (promise: Promise<unknown>, after: () => void, failMessage: string) => {
    setBusy(true)
    void promise
      .then(() => {
        after()
        refresh()
      })
      .catch(() => {
        toast.error('Command failed', { description: failMessage })
      })
      .finally(() => {
        setBusy(false)
      })
  }
  return {
    busy,
    create: (exercise: Exercise, after: () => void) =>
      run(create({ payload: { exercise } }), after, 'Could not create the exercise.'),
    update: (id: ExerciseId, exercise: Exercise, after: () => void) =>
      run(update({ payload: { id, exercise } }), after, 'Could not update the exercise.'),
    remove: (id: ExerciseId, after: () => void) =>
      run(remove({ payload: { id } }), after, 'Could not delete the exercise.'),
  }
}

function Catalog(props: {
  readonly exercises: readonly LibraryExercise[]
  readonly onCreate: () => void
  readonly onEdit: (id: ExerciseId) => void
  readonly onDelete: (id: ExerciseId) => void
}) {
  const [filters, setFilters] = React.useState<Filters>(emptyFilters)
  const visible = props.exercises.filter((e) => matchesFilters(e.exercise, filters))
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          data-testid="create-exercise-button"
          onClick={props.onCreate}
        >
          New exercise
        </Button>
      </div>
      <FilterBar exercises={props.exercises} filters={filters} setFilters={setFilters} />
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="exercise-empty">
          No exercises match.
        </p>
      ) : (
        <ul className="flex w-full flex-col gap-2" data-testid="exercise-list">
          {visible.map((entry) => (
            <ExerciseRow
              key={entry.id}
              entry={entry}
              onEdit={() => props.onEdit(entry.id)}
              onDelete={() => props.onDelete(entry.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ScreenOverlays(props: {
  readonly exercises: readonly LibraryExercise[]
  readonly drawer: DrawerState
  readonly pendingDelete: ExerciseId | undefined
  readonly mutations: ReturnType<typeof useExerciseMutations>
  readonly onCloseDrawer: () => void
  readonly onCloseDelete: () => void
}) {
  const drawer = props.drawer
  const editing =
    drawer.kind === 'edit' ? props.exercises.find((e) => e.id === drawer.id) : undefined
  const deleting = props.exercises.find((e) => e.id === props.pendingDelete)
  return (
    <>
      <ExerciseDrawer
        open={drawer.kind === 'create' || editing !== undefined}
        title={editing === undefined ? 'New exercise' : 'Edit exercise'}
        exercise={editing?.exercise}
        submitting={props.mutations.busy}
        onOpenChange={(open) => {
          if (!open) {
            props.onCloseDrawer()
          }
        }}
        onSubmit={(exercise) =>
          editing === undefined
            ? props.mutations.create(exercise, props.onCloseDrawer)
            : props.mutations.update(editing.id, exercise, props.onCloseDrawer)
        }
      />
      <DeleteAlert
        open={deleting !== undefined}
        name={deleting?.exercise.name ?? ''}
        submitting={props.mutations.busy}
        onOpenChange={(open) => {
          if (!open) {
            props.onCloseDelete()
          }
        }}
        onConfirm={() => {
          if (deleting !== undefined) {
            props.mutations.remove(deleting.id, props.onCloseDelete)
          }
        }}
      />
    </>
  )
}

function EmptyCreate({ onCreate }: { readonly onCreate: () => void }) {
  return (
    <Button type="button" size="sm" data-testid="create-exercise-button" onClick={onCreate}>
      New exercise
    </Button>
  )
}

function ScreenHeader() {
  return (
    <header className="flex w-full max-w-md flex-col gap-3">
      <Link
        to="/library"
        data-testid="library-nav-link"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        ← Your library
      </Link>
      <LibrarySegments />
    </header>
  )
}

/** `/library/exercises` — filterable catalog; create/edit drawer; delete alert-dialog. */
export function ExerciseLibraryScreen() {
  const result = useAtomValue(listExercisesAtom)
  const refresh = useAtomRefresh(listExercisesAtom)
  const mutations = useExerciseMutations()
  const [drawer, setDrawer] = React.useState<DrawerState>({ kind: 'closed' })
  const [pendingDelete, setPendingDelete] = React.useState<ExerciseId | undefined>(undefined)
  const exercises = Result.isSuccess(result) ? result.value : []
  const openCreate = () => setDrawer({ kind: 'create' })

  return (
    <div
      className="flex min-h-svh flex-col items-center gap-6 p-6"
      data-testid="exercise-library-screen"
    >
      <ScreenHeader />
      <div className="w-full max-w-md">
        <QueryBoundary
          result={result}
          isEmpty={(list) => list.length === 0}
          emptyTitle="No exercises yet"
          emptyDescription="Create your first exercise to get started."
          emptyAction={<EmptyCreate onCreate={openCreate} />}
          errorTitle="Failed to load your exercises"
          onRetry={refresh}
        >
          {(value) => (
            <Catalog
              exercises={value}
              onCreate={openCreate}
              onEdit={(id) => setDrawer({ kind: 'edit', id })}
              onDelete={setPendingDelete}
            />
          )}
        </QueryBoundary>
      </div>
      <ScreenOverlays
        exercises={exercises}
        drawer={drawer}
        pendingDelete={pendingDelete}
        mutations={mutations}
        onCloseDrawer={() => setDrawer({ kind: 'closed' })}
        onCloseDelete={() => setPendingDelete(undefined)}
      />
    </div>
  )
}
