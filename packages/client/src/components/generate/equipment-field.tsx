import { equipmentLabel } from '@j45/domain'

import { FacetGroup } from '@/components/facet-group'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'

import { EQUIPMENT, type FormModel } from './model'

export function EquipmentField({ form }: { readonly form: FormModel }) {
  return (
    <Field>
      <FieldLabel>Equipment</FieldLabel>
      <FacetGroup
        values={EQUIPMENT}
        selected={[...form.c.equipment]}
        labels={equipmentLabel}
        testIdPrefix="generate-equipment"
        onChange={(next) => form.setEquipment(new Set(next))}
      />
      <FieldDescription>Empty selection = bodyweight-only.</FieldDescription>
    </Field>
  )
}
