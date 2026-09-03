import * as React from 'react'

import {
  Equipment,
  equipmentLabel,
  Exercise,
  Modality,
  modalityLabel,
  MuscleGroup,
  muscleGroupLabel,
} from '@j45/domain'

import { FacetGroup } from '@/components/facet-group'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Field, FieldGroup, FieldLabel, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const MODALITIES = Modality.literals
const MUSCLE_GROUPS = MuscleGroup.literals
const EQUIPMENT = Equipment.literals

type Draft = {
  readonly name: string
  readonly detail: string
  readonly modality: Modality
  readonly muscleGroups: readonly MuscleGroup[]
  readonly equipment: readonly Equipment[]
}

const emptyDraft: Draft = {
  name: '',
  detail: '',
  modality: 'strength',
  muscleGroups: [],
  equipment: [],
}

function draftFrom(exercise: Exercise | undefined): Draft {
  if (exercise === undefined) {
    return emptyDraft
  }
  return {
    name: exercise.name,
    detail: exercise.detail ?? '',
    modality: exercise.modality,
    muscleGroups: [...exercise.muscleGroups],
    equipment: [...exercise.equipment],
  }
}

function draftToExercise(draft: Draft): Exercise | undefined {
  const name = draft.name.trim()
  if (name.length === 0 || draft.muscleGroups.length === 0) {
    return undefined
  }
  const [first, ...rest] = draft.muscleGroups
  const detail = draft.detail.trim()
  return new Exercise({
    name,
    ...(detail.length > 0 ? { detail } : {}),
    modality: draft.modality,
    muscleGroups: [first, ...rest],
    equipment: [...draft.equipment],
  })
}

function FormSelect<A extends string>(props: {
  readonly label: string
  readonly value: A
  readonly options: readonly A[]
  readonly labels: Record<A, string>
  readonly testId: string
  readonly onChange: (value: A) => void
}) {
  return (
    <Field>
      <FieldLabel>{props.label}</FieldLabel>
      <Select
        value={props.value}
        onValueChange={(value) => {
          if (value !== null) {
            props.onChange(value)
          }
        }}
        items={props.labels}
      >
        <SelectTrigger className="w-full" data-testid={props.testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {props.options.map((option) => (
            <SelectItem key={option} value={option}>
              {props.labels[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function TextFields(props: {
  readonly draft: Draft
  readonly patch: (next: Partial<Draft>) => void
}) {
  const { draft, patch } = props
  return (
    <>
      <Field>
        <FieldLabel htmlFor="exercise-form-name">Name</FieldLabel>
        <Input
          id="exercise-form-name"
          data-testid="exercise-form-name"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="exercise-form-detail">Detail</FieldLabel>
        <Input
          id="exercise-form-detail"
          data-testid="exercise-form-detail"
          value={draft.detail}
          onChange={(e) => patch({ detail: e.target.value })}
        />
      </Field>
    </>
  )
}

function TagFields(props: {
  readonly draft: Draft
  readonly patch: (next: Partial<Draft>) => void
}) {
  const { draft, patch } = props
  return (
    <>
      <Field>
        <FieldLabel>Muscle groups</FieldLabel>
        <FacetGroup
          values={MUSCLE_GROUPS}
          selected={draft.muscleGroups}
          labels={muscleGroupLabel}
          testIdPrefix="exercise-form-muscle"
          onChange={(muscleGroups) => patch({ muscleGroups })}
        />
      </Field>
      <Field>
        <FieldLabel>Equipment (none = bodyweight)</FieldLabel>
        <FacetGroup
          values={EQUIPMENT}
          selected={draft.equipment}
          labels={equipmentLabel}
          testIdPrefix="exercise-form-equipment"
          onChange={(equipment) => patch({ equipment })}
        />
      </Field>
    </>
  )
}

function ExerciseForm(props: {
  readonly draft: Draft
  readonly patch: (next: Partial<Draft>) => void
}) {
  const { draft, patch } = props
  return (
    <FieldSet className="gap-3 overflow-y-auto px-4">
      <FieldGroup className="gap-3">
        <TextFields draft={draft} patch={patch} />
        <FormSelect
          label="Modality"
          value={draft.modality}
          options={MODALITIES}
          labels={modalityLabel}
          testId="exercise-form-modality"
          onChange={(modality) => patch({ modality })}
        />
        <TagFields draft={draft} patch={patch} />
      </FieldGroup>
    </FieldSet>
  )
}

function DrawerActions(props: {
  readonly built: Exercise | undefined
  readonly submitting: boolean
  readonly onSubmit: (exercise: Exercise) => void
}) {
  return (
    <DrawerFooter className="flex-row justify-end gap-2">
      <DrawerClose
        render={<Button type="button" variant="outline" size="sm" />}
        data-testid="exercise-form-cancel"
      >
        Cancel
      </DrawerClose>
      <Button
        type="button"
        size="sm"
        data-testid="exercise-form-submit"
        disabled={props.built === undefined || props.submitting}
        onClick={() => {
          if (props.built !== undefined) {
            props.onSubmit(props.built)
          }
        }}
      >
        Save
      </Button>
    </DrawerFooter>
  )
}

/** Create/edit bottom sheet built from field/input/select/toggle-group. */
export function ExerciseDrawer(props: {
  readonly open: boolean
  readonly title: string
  readonly exercise: Exercise | undefined
  readonly submitting: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (exercise: Exercise) => void
}) {
  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(props.exercise))
  const built = draftToExercise(draft)
  React.useEffect(() => {
    if (props.open) {
      setDraft(draftFrom(props.exercise))
    }
  }, [props.open, props.exercise])
  return (
    <Drawer open={props.open} onOpenChange={props.onOpenChange}>
      <DrawerContent data-testid="exercise-drawer">
        <DrawerHeader>
          <DrawerTitle>{props.title}</DrawerTitle>
          <DrawerDescription>
            {props.exercise === undefined
              ? 'Add an exercise to your catalog.'
              : 'Update name, tags, and equipment.'}
          </DrawerDescription>
        </DrawerHeader>
        <ExerciseForm draft={draft} patch={(next) => setDraft((prev) => ({ ...prev, ...next }))} />
        <DrawerActions built={built} submitting={props.submitting} onSubmit={props.onSubmit} />
      </DrawerContent>
    </Drawer>
  )
}

/** Delete confirmation alert-dialog. */
export function DeleteAlert(props: {
  readonly open: boolean
  readonly name: string
  readonly submitting: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onConfirm: () => void
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent data-testid="delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete exercise?</AlertDialogTitle>
          <AlertDialogDescription>
            Delete <span className="font-medium text-foreground">{props.name}</span>? This cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="cancel-delete-button" size="sm">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            size="sm"
            data-testid="confirm-delete-button"
            disabled={props.submitting}
            onClick={props.onConfirm}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
