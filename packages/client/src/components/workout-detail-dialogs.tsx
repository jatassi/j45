import type * as React from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { liveDeleteWarning } from '@/lib/live-workout'

/**
 * The two dialogs the workout detail screen puts over itself. They live here
 * rather than beside the screen so that file stays inside its line budget.
 */

/** Renames the workout. A rename is cosmetic, so nothing gates it. */
export function RenameDialog(p: {
  readonly open: boolean
  readonly name: string
  readonly onNameChange: (n: string) => void
  readonly onCancel: () => void
  readonly onSubmit: (e: React.SubmitEvent<HTMLFormElement>) => void
}) {
  return (
    <Dialog open={p.open} onOpenChange={(n) => (n ? undefined : p.onCancel())}>
      <DialogContent data-testid="rename-dialog" showCloseButton={false}>
        <DialogTitle>Rename workout</DialogTitle>
        <form className="flex flex-col gap-4" onSubmit={p.onSubmit}>
          <Field orientation="vertical">
            <FieldLabel htmlFor="rename-workout-name">Name</FieldLabel>
            <Input
              id="rename-workout-name"
              data-testid="rename-input"
              value={p.name}
              onChange={(e) => p.onNameChange(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="rename-cancel"
              onClick={p.onCancel}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" data-testid="rename-confirm">
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The delete confirm, in two strengths. With no live session it says only
 * that a delete is permanent. With live sessions it says how many run this
 * workout and that they stop immediately — the action ends other people's
 * workouts mid-rep, and there is no undo.
 */
export function DeleteDialog(p: {
  readonly open: boolean
  readonly liveCount: number
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const live = p.liveCount > 0
  return (
    <AlertDialog open={p.open} onOpenChange={(n) => (n ? undefined : p.onCancel())}>
      <AlertDialogContent data-testid="delete-dialog" size="sm">
        <AlertDialogTitle>
          {live ? 'Delete workout and stop live sessions' : 'Delete workout'}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {live ? liveDeleteWarning(p.liveCount) : "This can't be undone."}
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="delete-cancel" size="sm">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            size="sm"
            data-testid="delete-confirm"
            onClick={p.onConfirm}
          >
            {live ? 'Delete and stop' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
