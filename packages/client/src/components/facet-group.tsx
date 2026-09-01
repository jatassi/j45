import * as React from 'react'

import { CheckIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FieldDescription } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

/**
 * An action that sets the whole facet with one press. `All` and `None` are the
 * two examples. The action gives its own test id, because it holds no facet
 * value to make one from.
 */
export type FacetBulkAction = {
  readonly label: string
  readonly testId: string
  readonly onSelect: () => void
}

/**
 * The style of a selected chip. The chip fills with a tint of the primary
 * colour. Its border takes the same colour.
 *
 * The fill keeps the `aria-pressed:` prefix. The kit sets `aria-pressed:bg-muted`
 * on the same element. A class without the prefix has lower specificity, and it
 * does not replace the kit class. With the prefix, tailwind-merge removes the
 * kit class. The hover fill keeps the prefix for the same reason.
 *
 * The style changes no property that has an effect on width. A bolder label
 * would make the chip wider, and a press would then move the other chips.
 */
const CHIP_SELECTED = 'border-primary aria-pressed:bg-primary/20 hover:bg-primary/30'

/**
 * The style of an unselected chip. The chip becomes dim.
 *
 * The tint alone is not sufficient. A row of tinted chips can still read as
 * empty. The dim state is what marks a chip as off.
 *
 * The opacity has no prefix. The kit sets `disabled:opacity-50`, which has
 * higher specificity. A disabled chip thus keeps the disabled opacity.
 */
const CHIP_UNSELECTED = 'opacity-70 hover:opacity-100'

/**
 * The chips. A selected chip shows the tint and a check mark. An unselected chip
 * is dim and shows no check mark.
 *
 * A user who cannot see the difference in colour reads the state from the check
 * mark. The mark thus renders only for a selected chip.
 *
 * `aria-pressed` stays the state contract for the tests and for assistive
 * technology. The mark is decoration, and it stays out of the accessibility
 * tree.
 *
 * An unselected chip keeps an empty box in the place of the mark. The two states
 * thus have the same width. A press on one chip does not move the others. The
 * equipment row holds 16 chips and it wraps, so a change of width there can move
 * a chip away from the finger of the user.
 */
function FacetChips<A extends string>(props: {
  readonly values: readonly A[]
  readonly selected: readonly A[]
  readonly labels: Record<A, string>
  readonly testIdPrefix: string
  readonly onChange: (next: A[]) => void
}) {
  const selectedValues = new Set<A>(props.selected)
  return (
    <ToggleGroup
      multiple
      variant="outline"
      size="sm"
      className="w-full max-w-full flex-wrap"
      value={props.selected}
      onValueChange={(next) => props.onChange(next as A[])}
    >
      {props.values.map((value) => {
        const isSelected = selectedValues.has(value)
        const testId = `${props.testIdPrefix}-${value}`
        return (
          <ToggleGroupItem
            key={value}
            value={value}
            data-testid={testId}
            className={isSelected ? CHIP_SELECTED : CHIP_UNSELECTED}
          >
            {/* The kit reduces the chip padding when a child carries
                `data-icon=inline-start`. Both states carry it, so both states
                get the same padding. The kit also sets the size of the icon. */}
            {isSelected ? (
              <CheckIcon aria-hidden data-icon="inline-start" data-testid={`${testId}-check`} />
            ) : (
              <span aria-hidden className="size-4" data-icon="inline-start" />
            )}
            {props.labels[value]}
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}

function FacetBulkRow({ actions }: { readonly actions: readonly FacetBulkAction[] }) {
  return (
    <div className="flex flex-row flex-wrap gap-2">
      {actions.map((action) => (
        <Button
          key={action.testId}
          type="button"
          variant="outline"
          size="sm"
          data-testid={action.testId}
          onClick={action.onSelect}
        >
          {action.label}
        </Button>
      ))}
    </div>
  )
}

/**
 * Multi-select toggle-group used by filter chips and form tag fields.
 *
 * Every chip group in the app renders through this one control. The chip states
 * above thus reach all six of them: the generate equipment field, the three
 * exercise-library filter groups, and the two exercise-form tag fields.
 *
 * The chips are the full control until a caller asks for more. `bulkActions`
 * puts a row of whole-facet actions above the chips. `summary` puts a line
 * below the chips that states the selection. If the caller supplies neither,
 * the control shows the toggle group and nothing else. A call site that wants
 * only chips thus keeps the markup and the layout that it has today.
 */
export function FacetGroup<A extends string>(props: {
  readonly values: readonly A[]
  readonly selected: readonly A[]
  readonly labels: Record<A, string>
  readonly testIdPrefix: string
  readonly onChange: (next: A[]) => void
  readonly bulkActions?: readonly FacetBulkAction[]
  readonly summary?: React.ReactNode
}) {
  if (props.values.length === 0) {
    return null
  }
  const bulkActions = props.bulkActions ?? []
  // A caller that shows the line only sometimes writes `summary={on ? x : null}`.
  // Null thus means "not supplied", the same as undefined.
  const hasSummary = props.summary !== undefined && props.summary !== null
  const chips = (
    <FacetChips
      values={props.values}
      selected={props.selected}
      labels={props.labels}
      testIdPrefix={props.testIdPrefix}
      onChange={props.onChange}
    />
  )
  if (bulkActions.length === 0 && !hasSummary) {
    return chips
  }
  return (
    <div className="flex w-full max-w-full flex-col gap-2">
      {bulkActions.length > 0 ? <FacetBulkRow actions={bulkActions} /> : null}
      {chips}
      {hasSummary ? (
        <FieldDescription data-testid={`${props.testIdPrefix}-summary`}>
          {props.summary}
        </FieldDescription>
      ) : null}
    </div>
  )
}
