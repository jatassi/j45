import { equipmentLabel, type Equipment } from '@j45/domain'

import { FacetGroup, type FacetBulkAction } from '@/components/facet-group'
import { Field, FieldLabel } from '@/components/ui/field'

import { facetSummary, type FacetSummaryCases } from './facet-summary'
import { EQUIPMENT, type FormModel } from './model'

/**
 * The words of the equipment summary line.
 *
 * An empty kit is a choice, and not an unset filter. The line therefore names
 * the choice: an empty allowed set means that only bodyweight exercises
 * qualify. That meaning does not change here, and the value that the form
 * sends to the server does not change. The line only states what an empty set
 * means.
 */
const EQUIPMENT_SUMMARY: FacetSummaryCases = {
  none: 'Bodyweight only',
  some: (selected, total) => `${selected} of ${total} selected`,
  all: 'All kit',
}

export function EquipmentField({ form }: { readonly form: FormModel }) {
  /**
   * One press sets the whole kit. A user who owns dumbbells only presses None
   * and then one chip, instead of fifteen presses.
   */
  const bulkActions: readonly FacetBulkAction[] = [
    {
      label: 'All',
      testId: 'generate-equipment-all',
      onSelect: () => form.setEquipment(new Set(EQUIPMENT)),
    },
    {
      label: 'None',
      testId: 'generate-equipment-none',
      onSelect: () => form.setEquipment(new Set<Equipment>()),
    },
  ]
  return (
    <Field>
      <FieldLabel>Equipment</FieldLabel>
      <FacetGroup
        values={EQUIPMENT}
        selected={[...form.c.equipment]}
        labels={equipmentLabel}
        testIdPrefix="generate-equipment"
        onChange={(next) => form.setEquipment(new Set(next))}
        bulkActions={bulkActions}
        summary={facetSummary(EQUIPMENT_SUMMARY, form.c.equipment.size, EQUIPMENT.length)}
      />
    </Field>
  )
}
