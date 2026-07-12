import { MuscleGroup, muscleGroupLabel } from '@j45/domain'

import { Field, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type { FormModel } from './model'

const MUSCLE_GROUPS = MuscleGroup.literals
const NONE = 'none' as const
const EMPHASIS_ITEMS: Record<string, string> = { [NONE]: 'None', ...muscleGroupLabel }

export function EmphasisField({ form }: { readonly form: FormModel }) {
  return (
    <Field>
      <FieldLabel>Emphasis</FieldLabel>
      <Select
        value={form.c.emphasis ?? NONE}
        onValueChange={(next) =>
          form.setEmphasis(next === null || next === NONE ? undefined : next)
        }
        items={EMPHASIS_ITEMS}
      >
        <SelectTrigger className="w-full" data-testid="generate-emphasis">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>None</SelectItem>
          {MUSCLE_GROUPS.map((g) => (
            <SelectItem key={g} value={g}>
              {muscleGroupLabel[g]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
