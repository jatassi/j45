import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function Stepper(p: {
  readonly value: number
  readonly decId: string
  readonly incId: string
  readonly valueId: string
  readonly label: string
  readonly decOff: boolean
  readonly incOff?: boolean
  readonly onDec: () => void
  readonly onInc: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid={p.decId}
        disabled={p.decOff}
        onClick={p.onDec}
      >
        −
      </Button>
      <Input
        data-testid={p.valueId}
        type="text"
        inputMode="numeric"
        readOnly
        className="w-16 text-center"
        value={String(p.value)}
        aria-label={p.label}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid={p.incId}
        disabled={p.incOff === true}
        onClick={p.onInc}
      >
        +
      </Button>
    </div>
  )
}
