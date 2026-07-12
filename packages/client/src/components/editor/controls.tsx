import { flowTypeLabel, type FlowType } from '@j45/domain'
import { Minus, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

/**
 * Shared kit form controls for the workout editor, sized for reflow reuse:
 * the laps/sets toggle-group, the uniform switch-style field, and a numeric
 * stepper (used for the round count and each work/rest pair). Every control
 * is fully controlled — it reads a value and reports changes, holding no
 * draft state of its own so the screen owns the single `useState`.
 */

const FLOW_TYPES: readonly FlowType[] = ['laps', 'sets']
const isFlowType = (value: string): value is FlowType => value === 'laps' || value === 'sets'

/** Laps | Sets as a single-select `toggle-group`, labelled via `flowTypeLabel`. */
export function FlowTypeToggle(props: {
  readonly testid: string
  readonly value: FlowType
  readonly onChange: (type: FlowType) => void
}) {
  return (
    <ToggleGroup
      data-testid={props.testid}
      variant="outline"
      size="sm"
      className="w-full"
      value={[props.value]}
      onValueChange={(next) => {
        const chosen = next.find(isFlowType)
        if (chosen !== undefined) {
          props.onChange(chosen)
        }
      }}
    >
      {FLOW_TYPES.map((type) => (
        <ToggleGroupItem
          key={type}
          value={type}
          className="flex-1"
          data-testid={`${props.testid}-${type}`}
        >
          {flowTypeLabel[type]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** The uniform work/rest toggle as a kit switch-style field. */
export function UniformField(props: {
  readonly testid: string
  readonly checked: boolean
  readonly onToggle: () => void
}) {
  return (
    <Field orientation="horizontal" className="gap-2">
      <Checkbox
        id={props.testid}
        data-testid={props.testid}
        checked={props.checked}
        onCheckedChange={() => props.onToggle()}
      />
      <FieldLabel htmlFor={props.testid}>Same work/rest every round</FieldLabel>
    </Field>
  )
}

/** A numeric input flanked by decrement/increment buttons; clamps at `min`. */
export function Stepper(props: {
  readonly testid: string
  readonly value: string
  readonly min: number
  readonly onChange: (value: string) => void
}) {
  const step = (delta: number) => {
    const parsed = Number.parseInt(props.value, 10)
    const base = Number.isNaN(parsed) ? props.min : parsed
    props.onChange(String(Math.max(props.min, base + delta)))
  }
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="Decrease"
        data-testid={`${props.testid}-dec`}
        onClick={() => step(-1)}
      >
        <Minus />
      </Button>
      <Input
        type="number"
        inputMode="numeric"
        className="w-16 text-center"
        data-testid={props.testid}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="Increase"
        data-testid={`${props.testid}-inc`}
        onClick={() => step(1)}
      >
        <Plus />
      </Button>
    </div>
  )
}

/** A labelled work-seconds / rest-seconds stepper pair for one round. */
export function WorkRestPair(props: {
  readonly testidPrefix: string
  readonly workSeconds: string
  readonly restSeconds: string
  readonly onChange: (patch: { workSeconds?: string; restSeconds?: string }) => void
}) {
  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Work (s)</span>
        <Stepper
          testid={`${props.testidPrefix}-work`}
          min={0}
          value={props.workSeconds}
          onChange={(value) => props.onChange({ workSeconds: value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Rest (s)</span>
        <Stepper
          testid={`${props.testidPrefix}-rest`}
          min={0}
          value={props.restSeconds}
          onChange={(value) => props.onChange({ restSeconds: value })}
        />
      </div>
    </div>
  )
}
