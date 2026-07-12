import { focusLabel, type Focus } from '@j45/domain'

import { Field, FieldLabel } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

import { FOCI, isFocus, type FormModel } from './model'

const focusHue: Record<Focus, string> = {
  cardio: 'aria-pressed:bg-hue-cardio/15 aria-pressed:text-hue-cardio',
  strength: 'aria-pressed:bg-hue-strength/15 aria-pressed:text-hue-strength',
  hybrid: 'aria-pressed:bg-hue-hybrid/15 aria-pressed:text-hue-hybrid',
}

export function FocusField({ form }: { readonly form: FormModel }) {
  return (
    <Field>
      <FieldLabel>Focus</FieldLabel>
      <ToggleGroup
        data-testid="generate-focus"
        variant="outline"
        size="sm"
        className="w-full max-w-full flex-wrap"
        value={[form.c.focus]}
        onValueChange={(next) => {
          const v = next.find(isFocus)
          if (v !== undefined) form.setFocus(v)
        }}
      >
        {FOCI.map((value) => (
          <ToggleGroupItem
            key={value}
            value={value}
            data-testid={`generate-focus-${value}`}
            className={focusHue[value]}
          >
            {focusLabel[value]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  )
}
