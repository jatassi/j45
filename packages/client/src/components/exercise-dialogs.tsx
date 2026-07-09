import * as React from 'react'

import { Equipment, Exercise, Intensity, Modality, MuscleGroup } from '@j45/domain'

import { Button } from '@/components/ui/button'

/** The four closed tag vocabularies the chips and selects draw from. */
const MODALITIES = Modality.literals
const INTENSITIES = Intensity.literals
const MUSCLE_GROUPS = MuscleGroup.literals
const EQUIPMENT = Equipment.literals

const overlayClass = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
const panelClass =
  'flex w-full max-w-sm flex-col gap-3 rounded-xl border border-border bg-background p-4'
const fieldLabelClass = 'flex flex-col gap-1 text-xs text-muted-foreground'
const fieldControlClass =
  'rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground'

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

const chipClass = (active: boolean): string =>
  `rounded-full border px-2.5 py-1 text-xs ${
    active
      ? 'border-primary bg-primary text-primary-foreground'
      : 'border-border text-muted-foreground'
  }`

type ChipRowProps<A extends string> = {
  readonly values: readonly A[]
  readonly selected: ReadonlySet<A>
  readonly testIdPrefix: string
  readonly onToggle: (value: A) => void
}

/** A wrap of toggle-chips — the filter facets and the dialog's multi-selects share it. */
export function ChipRow<A extends string>({
  values,
  selected,
  testIdPrefix,
  onToggle,
}: ChipRowProps<A>) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <button
          key={value}
          type="button"
          data-testid={`${testIdPrefix}-${value}`}
          aria-pressed={selected.has(value)}
          onClick={() => {
            onToggle(value)
          }}
          className={chipClass(selected.has(value))}
        >
          {value}
        </button>
      ))}
    </div>
  )
}

/** The mutable draft the create/edit dialog binds its inputs to. */
type Draft = {
  readonly name: string
  readonly detail: string
  readonly modality: Modality
  readonly intensity: Intensity
  readonly muscleGroups: ReadonlySet<MuscleGroup>
  readonly equipment: ReadonlySet<Equipment>
}

const emptyDraft: Draft = {
  name: '',
  detail: '',
  modality: 'strength',
  intensity: 'moderate',
  muscleGroups: new Set(),
  equipment: new Set(),
}

/** Seeds a `Draft` from an existing exercise (edit), or blank (create). */
function draftFrom(exercise: Exercise | undefined): Draft {
  if (exercise === undefined) {
    return emptyDraft
  }
  return {
    name: exercise.name,
    detail: exercise.detail ?? '',
    modality: exercise.modality,
    intensity: exercise.intensity,
    muscleGroups: new Set(exercise.muscleGroups),
    equipment: new Set(exercise.equipment),
  }
}

/**
 * Builds the domain `Exercise` from a `Draft`, or `undefined` when the draft
 * is not yet submittable (blank name, or no muscle group — `muscleGroups` is
 * a `NonEmptyArray`, so the `Exercise` constructor would reject an empty one).
 */
function draftToExercise(draft: Draft): Exercise | undefined {
  const name = draft.name.trim()
  if (name.length === 0 || draft.muscleGroups.size === 0) {
    return undefined
  }
  const [first, ...rest] = [...draft.muscleGroups]
  const detail = draft.detail.trim()
  return new Exercise({
    name,
    ...(detail.length > 0 ? { detail } : {}),
    modality: draft.modality,
    intensity: draft.intensity,
    muscleGroups: [first, ...rest],
    equipment: [...draft.equipment],
  })
}

type SelectFieldProps<A extends string> = {
  readonly label: string
  readonly value: A
  readonly options: readonly A[]
  readonly testId: string
  readonly onChange: (value: A) => void
}

/** A labelled single-choice select, used for the dialog's modality and intensity. */
function SelectField<A extends string>({
  label,
  value,
  options,
  testId,
  onChange,
}: SelectFieldProps<A>) {
  return (
    <label className={fieldLabelClass}>
      {label}
      <select
        data-testid={testId}
        value={value}
        onChange={(event) => onChange(event.target.value as A)}
        className={fieldControlClass}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

type TextFieldProps = {
  readonly label: string
  readonly value: string
  readonly testId: string
  readonly onChange: (value: string) => void
}

/** A labelled text input, used for the dialog's name and detail. */
function TextField({ label, value, testId, onChange }: TextFieldProps) {
  return (
    <label className={fieldLabelClass}>
      {label}
      <input
        type="text"
        data-testid={testId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={fieldControlClass}
      />
    </label>
  )
}

type FieldsProps = {
  readonly draft: Draft
  readonly patch: (next: Partial<Draft>) => void
}

/** The dialog's form fields, split out of `ExerciseDialog` to keep it small. */
function ExerciseFields({ draft, patch }: FieldsProps) {
  return (
    <>
      <TextField
        label="Name"
        value={draft.name}
        testId="exercise-form-name"
        onChange={(name) => patch({ name })}
      />
      <TextField
        label="Detail"
        value={draft.detail}
        testId="exercise-form-detail"
        onChange={(detail) => patch({ detail })}
      />
      <SelectField
        label="Modality"
        value={draft.modality}
        options={MODALITIES}
        testId="exercise-form-modality"
        onChange={(modality) => patch({ modality })}
      />
      <SelectField
        label="Intensity"
        value={draft.intensity}
        options={INTENSITIES}
        testId="exercise-form-intensity"
        onChange={(intensity) => patch({ intensity })}
      />
      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs text-muted-foreground">Muscle groups</legend>
        <ChipRow
          values={MUSCLE_GROUPS}
          selected={draft.muscleGroups}
          testIdPrefix="exercise-form-muscle"
          onToggle={(group) => patch({ muscleGroups: toggle(draft.muscleGroups, group) })}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs text-muted-foreground">Equipment (none = bodyweight)</legend>
        <ChipRow
          values={EQUIPMENT}
          selected={draft.equipment}
          testIdPrefix="exercise-form-equipment"
          onToggle={(eq) => patch({ equipment: toggle(draft.equipment, eq) })}
        />
      </fieldset>
    </>
  )
}

type DialogProps = {
  readonly title: string
  readonly exercise: Exercise | undefined
  readonly submitting: boolean
  readonly onSubmit: (exercise: Exercise) => void
  readonly onCancel: () => void
}

/**
 * The shared create/edit dialog: name/detail text, modality/intensity
 * selects, and muscle-group/equipment multi-selects. `exercise` pre-fills it
 * (undefined for create, the listed exercise for edit). Submit stays disabled
 * until the draft yields a valid `Exercise` (non-blank name, ≥1 muscle group).
 */
export function ExerciseDialog({ title, exercise, submitting, onSubmit, onCancel }: DialogProps) {
  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(exercise))
  const built = draftToExercise(draft)
  const patch = (next: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...next }))

  return (
    <div className={overlayClass} data-testid="exercise-dialog">
      <div className={panelClass}>
        <h2 className="text-base font-medium">{title}</h2>
        <ExerciseFields draft={draft} patch={patch} />
        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="exercise-form-cancel"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="exercise-form-submit"
            disabled={built === undefined || submitting}
            onClick={() => {
              if (built !== undefined) {
                onSubmit(built)
              }
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}

type DeleteConfirmProps = {
  readonly name: string
  readonly submitting: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/** The delete confirmation dialog. */
export function DeleteConfirm({ name, submitting, onConfirm, onCancel }: DeleteConfirmProps) {
  return (
    <div className={overlayClass} data-testid="delete-dialog">
      <div className={`${panelClass} max-w-xs`}>
        <p className="text-sm">
          Delete <span className="font-medium">{name}</span>?
        </p>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="cancel-delete-button"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            data-testid="confirm-delete-button"
            disabled={submitting}
            onClick={onConfirm}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}
