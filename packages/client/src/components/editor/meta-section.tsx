import type * as React from 'react'

import { focusLabel, type Focus } from '@j45/domain'

import { errorAt, type FieldErrors } from '@/components/editor/field-errors'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import * as Editor from '@/lib/workout-editor-state'

type SetState = React.Dispatch<React.SetStateAction<Editor.EditorState>>
type MetaProps = {
  readonly state: Editor.EditorState
  readonly setState: SetState
  readonly errors: FieldErrors
}

const FOCI: readonly Focus[] = ['cardio', 'strength', 'hybrid']
const isFocus = (value: string): value is Focus =>
  value === 'cardio' || value === 'strength' || value === 'hybrid'

const focusHue: Record<Focus, string> = {
  cardio: 'aria-pressed:bg-hue-cardio/15 aria-pressed:text-hue-cardio',
  strength: 'aria-pressed:bg-hue-strength/15 aria-pressed:text-hue-strength',
  hybrid: 'aria-pressed:bg-hue-hybrid/15 aria-pressed:text-hue-hybrid',
}

/** Focus as a single-select `toggle-group` with sport-hue accents. */
function FocusToggle({
  value,
  onChange,
}: {
  readonly value: string
  readonly onChange: (focus: Focus) => void
}) {
  return (
    <ToggleGroup
      data-testid="editor-focus"
      variant="outline"
      size="sm"
      className="w-full max-w-full flex-wrap"
      value={[value]}
      onValueChange={(next) => {
        const chosen = next.find(isFocus)
        if (chosen !== undefined) {
          onChange(chosen)
        }
      }}
    >
      {FOCI.map((focus) => (
        <ToggleGroupItem
          key={focus}
          value={focus}
          data-testid={`editor-focus-${focus}`}
          className={focusHue[focus]}
        >
          {focusLabel[focus]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** Name (`field`+`input`), focus (`toggle-group`), and an optional note (`input`). */
export function MetaSection({ state, setState, errors }: MetaProps) {
  const nameError = errorAt(errors, 'name')
  return (
    <section className="flex w-full flex-col gap-5">
      <Field data-invalid={nameError !== undefined}>
        <FieldLabel htmlFor="editor-name">Name</FieldLabel>
        <Input
          id="editor-name"
          data-testid="editor-name"
          placeholder="Workout name"
          aria-invalid={nameError !== undefined}
          value={state.name}
          onChange={(event) => setState((s) => Editor.setName(s, event.target.value))}
        />
        <FieldError data-testid="editor-name-error">{nameError}</FieldError>
      </Field>
      <Field>
        <FieldLabel>Focus</FieldLabel>
        <FocusToggle
          value={state.focus}
          onChange={(focus) => setState((s) => Editor.setFocus(s, focus))}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="editor-note">Note</FieldLabel>
        <Input
          id="editor-note"
          data-testid="editor-note"
          placeholder="Note (optional)"
          value={state.note}
          onChange={(event) => setState((s) => Editor.setNote(s, event.target.value))}
        />
      </Field>
    </section>
  )
}
