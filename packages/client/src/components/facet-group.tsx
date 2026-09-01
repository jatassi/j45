import * as React from 'react'

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

function FacetChips<A extends string>(props: {
  readonly values: readonly A[]
  readonly selected: readonly A[]
  readonly labels: Record<A, string>
  readonly testIdPrefix: string
  readonly onChange: (next: A[]) => void
}) {
  return (
    <ToggleGroup
      multiple
      variant="outline"
      size="sm"
      className="w-full max-w-full flex-wrap"
      value={props.selected}
      onValueChange={(next) => props.onChange(next as A[])}
    >
      {props.values.map((value) => (
        <ToggleGroupItem key={value} value={value} data-testid={`${props.testIdPrefix}-${value}`}>
          {props.labels[value]}
        </ToggleGroupItem>
      ))}
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
