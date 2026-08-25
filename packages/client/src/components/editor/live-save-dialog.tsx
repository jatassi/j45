import type { WorkoutSave } from '@/components/editor/use-workout-save'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { liveSaveWarning } from '@/lib/live-workout'

/**
 * The confirm the host reads before an edit goes into a workout that live
 * sessions run. It states how many sessions get the change, so the host
 * cannot change a plan under other people without knowing it.
 *
 * It opens only while a save waits on the host — with no live session the
 * save never waits here. Both editors that write through `useWorkoutSave`
 * mount it: the normal editor and launch mode.
 */
export function LiveSaveDialog({ save }: { readonly save: WorkoutSave }) {
  return (
    <AlertDialog open={save.promptOpen} onOpenChange={(open) => (open ? undefined : save.cancel())}>
      <AlertDialogContent data-testid="live-save-dialog" size="sm">
        <AlertDialogTitle>This workout is live</AlertDialogTitle>
        <AlertDialogDescription>{liveSaveWarning(save.promptCount)}</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="live-save-cancel" size="sm" onClick={save.cancel}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            type="button"
            size="sm"
            data-testid="live-save-confirm"
            onClick={save.confirm}
          >
            Save
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
