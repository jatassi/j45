import type { Workout } from '@j45/domain'

import { FocusBadge } from '@/components/focus-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { summaryOf, type Preview } from './model'

function stationLabel(s: { readonly name: string; readonly detail?: string }): string {
  return s.detail !== undefined && s.detail.length > 0 ? `${s.name} — ${s.detail}` : s.name
}

function PreviewPods({ workout }: { readonly workout: Workout }) {
  return (
    <ul className="flex w-full flex-col gap-3">
      {workout.pods.map((pod) => (
        <li key={pod.name} className="rounded-md border border-border p-3">
          <h3 className="mb-1 text-sm font-medium">{pod.name}</h3>
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {pod.stations.map((s) => (
              <li key={s.name}>{stationLabel(s)}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

function PreviewActions(p: {
  readonly busy: boolean
  readonly onRegenerate: () => void
  readonly onSave: () => void
  readonly onEdit: () => void
}) {
  const actions = [
    {
      id: 'generate-regenerate',
      label: 'Regenerate',
      variant: 'secondary' as const,
      onClick: p.onRegenerate,
    },
    { id: 'generate-save', label: 'Save', variant: 'default' as const, onClick: p.onSave },
    { id: 'generate-edit', label: 'Edit', variant: 'outline' as const, onClick: p.onEdit },
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((b) => (
        <Button
          key={b.id}
          type="button"
          size="sm"
          variant={b.variant}
          data-testid={b.id}
          disabled={p.busy}
          onClick={b.onClick}
        >
          {b.label}
        </Button>
      ))}
    </div>
  )
}

export function PreviewCard(p: {
  readonly preview: Preview
  readonly busy: boolean
  readonly onRegenerate: () => void
  readonly onSave: () => void
  readonly onEdit: () => void
}) {
  const w = p.preview.workout
  return (
    <div
      className="flex w-full max-w-sm flex-col gap-3"
      data-testid="generate-preview"
      data-seed={p.preview.seed}
    >
      <div className="flex flex-col gap-2">
        <h2
          className="font-heading text-xl font-bold tracking-tight"
          data-testid="generate-codename"
        >
          {w.name}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <FocusBadge focus={w.focus} />
          <Badge variant="outline" data-testid="generate-summary">
            {summaryOf(w)}
          </Badge>
        </div>
      </div>
      <PreviewPods workout={w} />
      <PreviewActions
        busy={p.busy}
        onRegenerate={p.onRegenerate}
        onSave={p.onSave}
        onEdit={p.onEdit}
      />
    </div>
  )
}
