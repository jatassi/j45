import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'

import type { FormModel } from './model'
import { Stepper } from './stepper'

export function NoRepeatField({ form }: { readonly form: FormModel }) {
  const n = form.c.noRepeatSessions
  return (
    <Field>
      <FieldLabel>No-repeat sessions</FieldLabel>
      <Stepper
        value={n}
        decId="generate-no-repeat-dec"
        incId="generate-no-repeat-inc"
        valueId="generate-no-repeat"
        label="No-repeat sessions"
        decOff={n <= 0}
        onDec={() => form.setNoRepeat((v) => Math.max(0, v - 1))}
        onInc={() => form.setNoRepeat((v) => v + 1)}
      />
      <FieldDescription>
        Excludes station names from your last {n} completed session{n === 1 ? '' : 's'}.
      </FieldDescription>
    </Field>
  )
}
