import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'

import { clampMin, MAX_MINUTES, MIN_MINUTES, STEP, type FormModel } from './model'
import { Stepper } from './stepper'

export function DurationField({ form }: { readonly form: FormModel }) {
  const m = form.c.targetMinutes
  return (
    <Field>
      <FieldLabel>Duration (minutes)</FieldLabel>
      <Stepper
        value={m}
        decId="generate-target-minutes-dec"
        incId="generate-target-minutes-inc"
        valueId="generate-target-minutes"
        label="Target minutes"
        decOff={m <= MIN_MINUTES}
        incOff={m >= MAX_MINUTES}
        onDec={() => form.setMinutes((v) => clampMin(v - STEP))}
        onInc={() => form.setMinutes((v) => clampMin(v + STEP))}
      />
      <FieldDescription>
        {MIN_MINUTES}–{MAX_MINUTES} minutes in {STEP}-minute steps.
      </FieldDescription>
    </Field>
  )
}
