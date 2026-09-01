import { muscleGroupLabel } from '@j45/domain'

import { FacetGroup } from '@/components/facet-group'
import { Field, FieldLabel } from '@/components/ui/field'

import { facetSummary, type FacetSummaryCases } from './facet-summary'
import { MUSCLE_GROUPS, type FormModel } from './model'

/**
 * The words of the Emphasis summary line.
 *
 * An absent Emphasis is an absence, and not a choice. The line therefore says
 * that the field applies no filter at all, and that every strength exercise
 * qualifies. An empty equipment kit means the opposite — bodyweight only — so
 * the two empty states of this form must never read alike.
 *
 * There is no `all` case. A full selection of the ten groups carries no
 * special meaning, because the rule is a union: it narrows nothing.
 */
const EMPHASIS_SUMMARY: FacetSummaryCases = {
  none: 'No emphasis — every strength exercise qualifies',
  some: (selected) =>
    `${selected} ${selected === 1 ? 'group narrows' : 'groups narrow'} the strength picks`,
}

/**
 * The Emphasis field: one chip for each muscle group.
 *
 * A user selects as many groups as they want, and a strength exercise
 * qualifies when it carries at least one of them. No selected chip means no
 * emphasis, so the field needs no `None` item to say it.
 *
 * The field carries a test id of its own, so that a test can address the field
 * as a whole and not only its chips.
 */
export function EmphasisField({ form }: { readonly form: FormModel }) {
  return (
    <Field data-testid="generate-emphasis">
      <FieldLabel>Emphasis</FieldLabel>
      <FacetGroup
        values={MUSCLE_GROUPS}
        selected={[...form.c.emphasis]}
        labels={muscleGroupLabel}
        testIdPrefix="generate-emphasis"
        onChange={(next) => form.setEmphasis(new Set(next))}
        summary={facetSummary(EMPHASIS_SUMMARY, form.c.emphasis.size, MUSCLE_GROUPS.length)}
      />
    </Field>
  )
}
