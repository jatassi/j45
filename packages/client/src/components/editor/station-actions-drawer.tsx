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
import * as Editor from '@/lib/workout-editor-state'

export type StationTarget = { readonly podIndex: number; readonly stationIndex: number }

type DrawerProps = {
  readonly target: StationTarget | null
  readonly pods: readonly Editor.EPod[]
  readonly setState: React.Dispatch<React.SetStateAction<Editor.EditorState>>
  readonly onClose: () => void
}

/** The three structural actions, each mutating the draft then closing the sheet. */
function StationActions({
  target,
  pods,
  setState,
  onClose,
}: DrawerProps & { target: StationTarget }) {
  const otherPods = pods
    .map((pod, index) => ({ pod, index }))
    .filter(({ index }) => index !== target.podIndex)
  const run = (transition: (s: Editor.EditorState) => Editor.EditorState) => {
    setState(transition)
    onClose()
  }
  return (
    <div className="flex flex-col gap-2 p-4 pt-2">
      <Button
        type="button"
        variant="outline"
        data-testid="editor-add-station"
        onClick={() => run((s) => Editor.addStation(s, target.podIndex))}
      >
        Add station to this pod
      </Button>
      {otherPods.map(({ pod, index }) => (
        <Button
          key={pod.id}
          type="button"
          variant="outline"
          data-testid={`editor-move-to-pod-${index}`}
          onClick={() =>
            run((s) => Editor.moveStationToPod(s, { ...target, targetPodIndex: index }))
          }
        >
          Move to {pod.name}
        </Button>
      ))}
      <Button
        type="button"
        variant="destructive"
        data-testid="remove-station"
        onClick={() => run((s) => Editor.removeStation(s, target.podIndex, target.stationIndex))}
      >
        Delete station
      </Button>
    </div>
  )
}

/**
 * The structural-actions sheet for one station: add another station to its
 * pod, move it to a different pod, or delete it — the kit replacement for the
 * old inline `<select>` move control. Cross-pod move offers one button per
 * other pod; a single-pod draft shows none.
 */
export function StationActionsDrawer({ target, pods, setState, onClose }: DrawerProps) {
  return (
    <Drawer
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DrawerContent data-testid="editor-station-drawer">
        <DrawerHeader>
          <DrawerTitle>Station actions</DrawerTitle>
        </DrawerHeader>
        {target === null ? null : (
          <StationActions target={target} pods={pods} setState={setState} onClose={onClose} />
        )}
        <DrawerFooter className="flex-row justify-end">
          <DrawerClose
            render={
              <Button type="button" variant="ghost" data-testid="editor-station-drawer-close" />
            }
          >
            Close
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
