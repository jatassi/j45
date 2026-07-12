/** Multi-select chip row (shared by generate constraints; was exercise-dialogs). */
export function ChipRow<A extends string>(props: {
  readonly values: readonly A[]
  readonly selected: ReadonlySet<A>
  readonly testIdPrefix: string
  readonly labels: Record<A, string>
  readonly onToggle: (value: A) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {props.values.map((value) => {
        const active = props.selected.has(value)
        return (
          <button
            key={value}
            type="button"
            data-testid={`${props.testIdPrefix}-${value}`}
            aria-pressed={active}
            onClick={() => props.onToggle(value)}
            className={`rounded-full border px-2.5 py-1 text-xs ${
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground'
            }`}
          >
            {props.labels[value]}
          </button>
        )
      })}
    </div>
  )
}
