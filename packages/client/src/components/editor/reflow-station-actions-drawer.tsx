import type * as React from 'react'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import * as ReflowDraft from '@/lib/reflow-draft'

export type ReflowStationTarget = {
  readonly podIndex: number
  readonly stationIndex: number
}

type DrawerProps = {
  readonly target: ReflowStationTarget | null
  readonly pods: readonly ReflowDraft.RPod[]
  readonly setState: React.Dispatch<React.SetStateAction<ReflowDraft.ReflowDraft>>
  readonly onClose: () => void
}

/**
 * Structural actions for one reflow station: move to another pod, or delete.
 * Unlike the New/Edit `StationActionsDrawer`, there is no "add station" —
 * reflow drafts only regroup existing source stations.
 */
function StationActions({
  target,
  pods,
  setState,
  onClose,
}: DrawerProps & { target: ReflowStationTarget }) {
  const otherPods = pods
    .map((pod, index) => ({ pod, index }))
    .filter(({ index }) => index !== target.podIndex)
  const run = (transition: (s: ReflowDraft.ReflowDraft) => ReflowDraft.ReflowDraft) => {
    setState(transition)
    onClose()
  }
  return (
    <div className="flex flex-col gap-2 p-4 pt-2">
      {otherPods.map(({ pod, index }) => (
        <Button
          key={pod.id}
          type="button"
          variant="outline"
          data-testid={`reflow-move-to-pod-${index}`}
          onClick={() =>
            run((s) =>
              ReflowDraft.moveStationToPod(s, {
                podIndex: target.podIndex,
                stationIndex: target.stationIndex,
                targetPodIndex: index,
              }),
            )
          }
        >
          Move to {pod.name}
        </Button>
      ))}
      <Button
        type="button"
        variant="destructive"
        data-testid="reflow-remove-station"
        onClick={() =>
          run((s) => ReflowDraft.removeStation(s, target.podIndex, target.stationIndex))
        }
      >
        Delete station
      </Button>
    </div>
  )
}

/** Cross-pod move + delete sheet for one reflow station (no add-station). */
export function ReflowStationActionsDrawer({ target, pods, setState, onClose }: DrawerProps) {
  return (
    <Drawer
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DrawerContent data-testid="reflow-station-drawer">
        <DrawerHeader>
          <DrawerTitle>Station actions</DrawerTitle>
        </DrawerHeader>
        {target === null ? null : (
          <StationActions target={target} pods={pods} setState={setState} onClose={onClose} />
        )}
        <DrawerFooter className="flex-row justify-end">
          <DrawerClose
            render={
              <Button type="button" variant="ghost" data-testid="reflow-station-drawer-close" />
            }
          >
            Close
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
