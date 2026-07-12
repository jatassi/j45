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

import { ChipRow, DeleteConfirm, ExerciseDialog } from '@/components/exercise-dialogs'
import { Button } from '@/components/ui/button'
import {
  createExerciseAtom,
  deleteExerciseAtom,
  listExercisesAtom,
  updateExerciseAtom,
} from '@/lib/exercises'

/** The tag vocabularies the filter chips draw from, kept in the domain's own order. */
const MODALITIES = Modality.literals
const MUSCLE_GROUPS = MuscleGroup.literals
const EQUIPMENT = Equipment.literals

/**
 * The three filter facets, each a set of currently-selected chip values. A
 * facet with an empty set imposes no constraint; a non-empty one keeps an
 * exercise whose field intersects it (OR within a facet). The facets combine
 * with AND across each other.
 */
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

/** Toggle membership of `value` in `set`, returning a fresh set (immutably). */
function toggle<A>(set: ReadonlySet<A>, value: A): ReadonlySet<A> {
  const next = new Set(set)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  return next
}

/** Whether `exercise` survives every active facet (AND across facets, OR within one). */
function matchesFilters(exercise: Exercise, filters: Filters): boolean {
  const muscleOk =
    filters.muscleGroups.size === 0 ||
    exercise.muscleGroups.some((group) => filters.muscleGroups.has(group))
  const equipmentOk =
    filters.equipment.size === 0 || exercise.equipment.some((eq) => filters.equipment.has(eq))
  const modalityOk = filters.modalities.size === 0 || filters.modalities.has(exercise.modality)
  return muscleOk && equipmentOk && modalityOk
}

/**
 * The tag labels shown as badges on a row. Empty equipment is a client-side
 * "bodyweight" pseudo-tag (not a domain literal) with hardcoded human text.
 * Everything else comes from the domain label maps.
 */
function tagsOf(exercise: Exercise): readonly string[] {
  const equipment =
    exercise.equipment.length === 0
      ? (['Bodyweight'] as const)
      : exercise.equipment.map((eq) => equipmentLabel[eq])
  return [
    modalityLabel[exercise.modality],
    intensityLabel[exercise.intensity],
    ...exercise.muscleGroups.map((group) => muscleGroupLabel[group]),
    ...equipment,
  ]
}

/** The state driving which dialog is open, and (for edit) over which entry. */
type DialogState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly id: ExerciseId }

type FilterBarProps = {
  readonly exercises: readonly LibraryExercise[]
  readonly filters: Filters
  readonly setFilters: React.Dispatch<React.SetStateAction<Filters>>
}

/**
 * The chip rows across the top. Only facet values present in the current
 * catalog get a chip, so a chip never offers a filter that would empty the
 * list on its own.
 */
function FilterBar({ exercises, filters, setFilters }: FilterBarProps) {
  const modalities = new Set(exercises.map((e) => e.exercise.modality))
  const muscles = new Set(exercises.flatMap((e) => e.exercise.muscleGroups))
  const equipment = new Set(exercises.flatMap((e) => e.exercise.equipment))

  return (
    <div className="flex w-full flex-col gap-2" data-testid="filter-bar">
      <ChipRow
        values={MODALITIES.filter((m) => modalities.has(m))}
        selected={filters.modalities}
        testIdPrefix="filter-modality"
        labels={modalityLabel}
        onToggle={(m) =>
          setFilters((prev) => ({ ...prev, modalities: toggle(prev.modalities, m) }))
        }
      />
      <ChipRow
        values={MUSCLE_GROUPS.filter((g) => muscles.has(g))}
        selected={filters.muscleGroups}
        testIdPrefix="filter-muscle"
        labels={muscleGroupLabel}
        onToggle={(g) =>
          setFilters((prev) => ({ ...prev, muscleGroups: toggle(prev.muscleGroups, g) }))
        }
      />
      <ChipRow
        values={EQUIPMENT.filter((eq) => equipment.has(eq))}
        selected={filters.equipment}
        testIdPrefix="filter-equipment"
        labels={equipmentLabel}
        onToggle={(eq) =>
          setFilters((prev) => ({ ...prev, equipment: toggle(prev.equipment, eq) }))
        }
      />
    </div>
  )
}

type RowProps = {
  readonly entry: LibraryExercise
  readonly onEdit: () => void
  readonly onDelete: () => void
}

/** One catalog row: name (+ optional detail), tag badges, and edit/delete actions. */
function ExerciseRow({ entry, onEdit, onDelete }: RowProps) {
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
      <div className="flex flex-wrap gap-1">
        {tagsOf(exercise).map((tag) => (
          <span
            key={tag}
            className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {tag}
          </span>
        ))}
      </div>
    </li>
  )
}

type ListProps = {
  readonly visible: readonly LibraryExercise[]
  readonly onEdit: (id: ExerciseId) => void
  readonly onDelete: (id: ExerciseId) => void
}

/** The filtered catalog as a list, or an empty-state line when nothing matches. */
function ExerciseList({ visible, onEdit, onDelete }: ListProps) {
  if (visible.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="exercise-empty">
        No exercises match.
      </p>
    )
  }
  return (
    <ul className="flex w-full flex-col gap-2" data-testid="exercise-list">
      {visible.map((entry) => (
        <ExerciseRow
          key={entry.id}
          entry={entry}
          onEdit={() => onEdit(entry.id)}
          onDelete={() => onDelete(entry.id)}
        />
      ))}
    </ul>
  )
}

/**
 * The create/update/delete mutation atoms driven from the dialogs. Each
 * resolves its promise on success; `run` then fires the caller's `after`
 * (close the dialog) and refreshes `listExercisesAtom` so the list reflects
 * the change — the same refresh-on-success idiom as `workout-detail-screen`.
 */
function useExerciseMutations() {
  const refresh = useAtomRefresh(listExercisesAtom)
  const [createResult, create] = useAtom(createExerciseAtom, { mode: 'promise' })
  const [updateResult, update] = useAtom(updateExerciseAtom, { mode: 'promise' })
  const [deleteResult, remove] = useAtom(deleteExerciseAtom, { mode: 'promise' })

  const run = (promise: Promise<unknown>, after: () => void) => {
    void promise
      .then(() => {
        after()
        refresh()
      })
      .catch(() => {
        // Surfaced via each atom's own `Result`; the dialog simply stays open.
      })
  }

  return {
    creating: Result.isWaiting(createResult),
    updating: Result.isWaiting(updateResult),
    deleting: Result.isWaiting(deleteResult),
    create: (exercise: Exercise, after: () => void) =>
      run(create({ payload: { exercise } }), after),
    update: (id: ExerciseId, exercise: Exercise, after: () => void) =>
      run(update({ payload: { id, exercise } }), after),
    remove: (id: ExerciseId, after: () => void) => run(remove({ payload: { id } }), after),
  }
}

type CatalogDialogsProps = {
  readonly exercises: readonly LibraryExercise[]
  readonly dialog: DialogState
  readonly pendingDelete: ExerciseId | undefined
  readonly mutations: ReturnType<typeof useExerciseMutations>
  readonly onClose: () => void
  readonly onCancelDelete: () => void
}

/** The create/edit/delete dialogs, mounted over the list when one is open. */
function CatalogDialogs({
  exercises,
  dialog,
  pendingDelete,
  mutations,
  onClose,
  onCancelDelete,
}: CatalogDialogsProps) {
  const editing =
    dialog.kind === 'edit' ? exercises.find((entry) => entry.id === dialog.id) : undefined
  const deleting = exercises.find((entry) => entry.id === pendingDelete)

  return (
    <>
      {dialog.kind === 'create' || editing !== undefined ? (
        <ExerciseDialog
          title={editing === undefined ? 'New exercise' : 'Edit exercise'}
          exercise={editing?.exercise}
          submitting={editing === undefined ? mutations.creating : mutations.updating}
          onSubmit={(exercise) =>
            editing === undefined
              ? mutations.create(exercise, onClose)
              : mutations.update(editing.id, exercise, onClose)
          }
          onCancel={onClose}
        />
      ) : null}
      {deleting === undefined ? null : (
        <DeleteConfirm
          name={deleting.exercise.name}
          submitting={mutations.deleting}
          onConfirm={() => mutations.remove(deleting.id, onCancelDelete)}
          onCancel={onCancelDelete}
        />
      )}
    </>
  )
}

type CatalogProps = {
  readonly exercises: readonly LibraryExercise[]
}

/** The filterable catalog and its create/edit/delete surface, once the list has loaded. */
function Catalog({ exercises }: CatalogProps) {
  const mutations = useExerciseMutations()
  const [filters, setFilters] = React.useState<Filters>(emptyFilters)
  const [dialog, setDialog] = React.useState<DialogState>({ kind: 'closed' })
  const [pendingDelete, setPendingDelete] = React.useState<ExerciseId | undefined>(undefined)

  const visible = exercises.filter((entry) => matchesFilters(entry.exercise, filters))

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          data-testid="create-exercise-button"
          onClick={() => setDialog({ kind: 'create' })}
        >
          New exercise
        </Button>
      </div>
      <FilterBar exercises={exercises} filters={filters} setFilters={setFilters} />
      <ExerciseList
        visible={visible}
        onEdit={(id) => setDialog({ kind: 'edit', id })}
        onDelete={(id) => setPendingDelete(id)}
      />
      <CatalogDialogs
        exercises={exercises}
        dialog={dialog}
        pendingDelete={pendingDelete}
        mutations={mutations}
        onClose={() => setDialog({ kind: 'closed' })}
        onCancelDelete={() => setPendingDelete(undefined)}
      />
    </div>
  )
}

/**
 * The exercise library (`/exercises`): the caller's catalog from
 * `ListExercises` as a filterable, editable list. Header links back to the
 * library home; the catalog, its filter chips, and the create/edit/delete
 * dialogs live in `Catalog`, whose mutations refresh `listExercisesAtom` via
 * the shared `useAtomValue` + `Result.match` idiom.
 */
export function ExerciseLibraryScreen() {
  const exercises = useAtomValue(listExercisesAtom)

  return (
    <div
      className="flex min-h-svh flex-col items-center gap-6 p-6"
      data-testid="exercise-library-screen"
    >
      <header className="flex w-full max-w-md items-center justify-between">
        <Link
          to="/"
          data-testid="library-nav-link"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          ← Your library
        </Link>
        <h1 className="text-lg font-medium">Exercises</h1>
      </header>
      <div className="w-full max-w-md">
        {Result.match(exercises, {
          onInitial: () => <p className="text-sm text-muted-foreground">Loading your exercises…</p>,
          onFailure: (failure) => (
            <p className="text-sm text-destructive">
              Failed to load your exercises: {String(failure.cause)}
            </p>
          ),
          onSuccess: ({ value }) => <Catalog exercises={value} />,
        })}
      </div>
    </div>
  )
}
