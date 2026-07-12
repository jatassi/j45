import * as React from 'react'

import { ChevronDown, ChevronUp, MoreHorizontal } from 'lucide-react'

import {
  ReflowStationActionsDrawer,
  type ReflowStationTarget,
} from '@/components/editor/reflow-station-actions-drawer'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import * as ReflowDraft from '@/lib/reflow-draft'

type SetState = React.Dispatch<React.SetStateAction<ReflowDraft.ReflowDraft>>

type SectionProps = {
  readonly state: ReflowDraft.ReflowDraft
  readonly setState: SetState
}

type StationRowProps = {
  readonly setState: SetState
  readonly at: ReflowStationTarget
  readonly station: ReflowDraft.RStation
  readonly onActions: (target: ReflowStationTarget) => void
}

function MoveButton(props: {
  readonly label: string
  readonly testid: string
  readonly onClick: () => void
  readonly children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={props.label}
      data-testid={props.testid}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  )
}

function StationRowButtons({
  setState,
  at,
  onActions,
}: {
  readonly setState: SetState
  readonly at: ReflowStationTarget
  readonly onActions: (target: ReflowStationTarget) => void
}) {
  const move = (direction: -1 | 1) =>
    setState((s) =>
      ReflowDraft.moveStation(s, {
        podIndex: at.podIndex,
        stationIndex: at.stationIndex,
        direction,
      }),
    )
  return (
    <>
      <MoveButton label="Move station up" testid="reflow-station-up" onClick={() => move(-1)}>
        <ChevronUp />
      </MoveButton>
      <MoveButton label="Move station down" testid="reflow-station-down" onClick={() => move(1)}>
        <ChevronDown />
      </MoveButton>
      <MoveButton
        label="Station actions"
        testid="reflow-station-actions"
        onClick={() => onActions(at)}
      >
        <MoreHorizontal />
      </MoveButton>
    </>
  )
}

/** One read-only station reference: name as text, reorder + actions drawer. */
function StationRow({ setState, at, station, onActions }: StationRowProps) {
  return (
    <div className="flex flex-col gap-1" data-testid="reflow-station">
      <div className="flex items-center gap-1">
        <span className="flex-1 text-sm" data-testid="reflow-station-name">
          {station.name}
        </span>
        <StationRowButtons setState={setState} at={at} onActions={onActions} />
      </div>
      {station.detail === undefined ? null : (
        <span className="text-xs text-muted-foreground" data-testid="reflow-station-detail">
          {station.detail}
        </span>
      )}
    </div>
  )
}

type PodCardProps = {
  readonly setState: SetState
  readonly podIndex: number
  readonly pod: ReflowDraft.RPod
  readonly onActions: (target: ReflowStationTarget) => void
}

function PodCard({ setState, podIndex, pod, onActions }: PodCardProps) {
  return (
    <Card size="sm" data-testid="reflow-pod-editor">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-1">
          <Input
            data-testid="reflow-pod-name-input"
            className="flex-1"
            placeholder="Pod name"
            value={pod.name}
            onChange={(event) =>
              setState((s) => ReflowDraft.renamePod(s, podIndex, event.target.value))
            }
          />
          <Button
            type="button"
            variant="destructive"
            size="icon-sm"
            aria-label="Remove pod"
            data-testid="reflow-remove-pod"
            onClick={() => setState((s) => ReflowDraft.removePod(s, podIndex))}
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
            onActions={onActions}
          />
        ))}
      </CardContent>
    </Card>
  )
}

/**
 * Reflow pods as cards: editable names, read-only stations, structural moves
 * through the actions drawer. No add-station — reflow never invents stations.
 */
export function ReflowPodsSection({ state, setState }: SectionProps) {
  const [target, setTarget] = React.useState<ReflowStationTarget | null>(null)
  return (
    <section className="flex w-full flex-col gap-3">
      {state.pods.map((pod, podIndex) => (
        <PodCard
          key={pod.id}
          setState={setState}
          podIndex={podIndex}
          pod={pod}
          onActions={setTarget}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="reflow-add-pod"
        onClick={() => setState((s) => ReflowDraft.addPod(s))}
      >
        Add pod
      </Button>
      <ReflowStationActionsDrawer
        target={target}
        pods={state.pods}
        setState={setState}
        onClose={() => setTarget(null)}
      />
    </section>
  )
}
