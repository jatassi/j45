import * as React from 'react'

import { ChevronDown, ChevronUp, MoreHorizontal } from 'lucide-react'

import { errorAt, type FieldErrors } from '@/components/editor/field-errors'
import {
  StationActionsDrawer,
  type StationTarget,
} from '@/components/editor/station-actions-drawer'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import * as Editor from '@/lib/workout-editor-state'

type SetState = React.Dispatch<React.SetStateAction<Editor.EditorState>>
type PodsProps = {
  readonly state: Editor.EditorState
  readonly setState: SetState
  readonly errors: FieldErrors
}

type StationRowProps = {
  readonly setState: SetState
  readonly at: StationTarget
  readonly station: Editor.EStation
  readonly nameError: string | undefined
  readonly onActions: (target: StationTarget) => void
}

function StationRowButtons({
  setState,
  at,
  onActions,
}: {
  readonly setState: SetState
  readonly at: StationTarget
  readonly onActions: (target: StationTarget) => void
}) {
  const move = (direction: -1 | 1) => setState((s) => Editor.moveStation(s, { ...at, direction }))
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="Move station up"
        data-testid="station-up"
        onClick={() => move(-1)}
      >
        <ChevronUp />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="Move station down"
        data-testid="station-down"
        onClick={() => move(1)}
      >
        <ChevronDown />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="Station actions"
        data-testid="editor-station-actions"
        onClick={() => onActions(at)}
      >
        <MoreHorizontal />
      </Button>
    </>
  )
}

/**
 * Name (with the move/actions buttons) and its note. The note sits outside the
 * name's `Field` so the name's error stays next to the name, and so an invalid
 * name does not tint the note as well.
 */
function StationRow({ setState, at, station, nameError, onActions }: StationRowProps) {
  return (
    <div className="flex flex-col gap-2">
      <Field data-invalid={nameError !== undefined}>
        <div className="flex items-center gap-1">
          <Input
            data-testid="station-name-input"
            className="flex-1"
            placeholder="Station"
            aria-invalid={nameError !== undefined}
            value={station.name}
            onChange={(event) =>
              setState((s) =>
                Editor.setStationField(s, { ...at, patch: { name: event.target.value } }),
              )
            }
          />
          <StationRowButtons setState={setState} at={at} onActions={onActions} />
        </div>
        <FieldError data-testid="station-name-error">{nameError}</FieldError>
      </Field>
      <Input
        data-testid="station-detail-input"
        aria-label="Station note"
        placeholder="Note (optional)"
        value={station.detail ?? ''}
        onChange={(event) =>
          setState((s) =>
            Editor.setStationField(s, { ...at, patch: { detail: event.target.value } }),
          )
        }
      />
    </div>
  )
}

type PodCardProps = {
  readonly setState: SetState
  readonly errors: FieldErrors
  readonly podIndex: number
  readonly pod: Editor.EPod
  readonly onActions: (target: StationTarget) => void
}

function PodCard({ setState, errors, podIndex, pod, onActions }: PodCardProps) {
  return (
    <Card size="sm" data-testid="pod-editor">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-1">
          <Input
            data-testid="pod-name-input"
            className="flex-1"
            placeholder="Pod name"
            value={pod.name}
            onChange={(event) => setState((s) => Editor.renamePod(s, podIndex, event.target.value))}
          />
          <Button
            type="button"
            variant="destructive"
            size="icon-sm"
            aria-label="Remove pod"
            data-testid="remove-pod"
            onClick={() => setState((s) => Editor.removePod(s, podIndex))}
          >
            ✕
          </Button>
        </div>
        {pod.stations.map((station, stationIndex) => (
          <StationRow
            key={station.id}
            setState={setState}
            at={{ podIndex, stationIndex }}
            station={station}
            nameError={errorAt(errors, `pods.${podIndex}.stations.${stationIndex}.name`)}
            onActions={onActions}
          />
        ))}
      </CardContent>
    </Card>
  )
}

/** Pods as cards; stations as rows; structural moves through the actions drawer. */
export function PodsSection({ state, setState, errors }: PodsProps) {
  const [target, setTarget] = React.useState<StationTarget | null>(null)
  return (
    <section className="flex w-full flex-col gap-3">
      {state.pods.map((pod, podIndex) => (
        <PodCard
          key={pod.id}
          setState={setState}
          errors={errors}
          podIndex={podIndex}
          pod={pod}
          onActions={setTarget}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="add-pod"
        onClick={() => setState((s) => Editor.addPod(s))}
      >
        Add pod
      </Button>
      <StationActionsDrawer
        target={target}
        pods={state.pods}
        setState={setState}
        onClose={() => setTarget(null)}
      />
    </section>
  )
}
