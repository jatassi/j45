import { muscleGroupLabel } from '@j45/domain'

import { FacetGroup } from '@/components/facet-group'
import { Field, FieldLabel } from '@/components/ui/field'

import { facetSummary, type FacetSummaryCases } from './facet-summary'
import { isEmphasisDisabled, MUSCLE_GROUPS, type FormModel } from './model'

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
 * What the line reads while the field is disabled.
 *
 * The note goes in the summary slot, and it does not get a slot of its own. A
 * second element would make the field taller under a cardio focus, and the
 * fields below it would then move every time the focus changed. Hiding the
 * field was rejected for the same reason. One line either way, so the field
 * keeps its height, and the note lands where the user already reads the state
 * of this field.
 *
 * The note stays about as long as the longest summary case, so that the line
 * wraps the same way in both states.
 */
const EMPHASIS_DISABLED_NOTE = 'Not used — Emphasis applies to strength picks'

/**
 * The Emphasis field: one chip for each muscle group.
 *
 * A user selects as many groups as they want, and a strength exercise
 * qualifies when it carries at least one of them. No selected chip means no
 * emphasis, so the field needs no `None` item to say it.
 *
 * Under a cardio focus the field is disabled: the chips stop taking input and
 * the line states why. The field keeps its place and its selection, so a
 * change of focus moves nothing and loses nothing. `data-disabled` is the
 * kit's own mark, and it dims the label with the chips.
 *
 * The field carries a test id of its own, so that a test can address the field
 * as a whole and not only its chips.
 */
export function EmphasisField({ form }: { readonly form: FormModel }) {
  const disabled = isEmphasisDisabled(form.c.focus)
  return (
    <Field data-testid="generate-emphasis" data-disabled={disabled ? 'true' : undefined}>
      <FieldLabel>Emphasis</FieldLabel>
      <FacetGroup
        values={MUSCLE_GROUPS}
        selected={[...form.c.emphasis]}
        labels={muscleGroupLabel}
        testIdPrefix="generate-emphasis"
        onChange={(next) => form.setEmphasis(new Set(next))}
        disabled={disabled}
        summary={
          disabled
            ? EMPHASIS_DISABLED_NOTE
            : facetSummary(EMPHASIS_SUMMARY, form.c.emphasis.size, MUSCLE_GROUPS.length)
        }
      />
    </Field>
  )
}
