import * as React from 'react'

import type { Workout } from '@j45/domain'
import { useRouter, type RouterHistory } from '@tanstack/react-router'
import * as Either from 'effect/Either'

import { FlowSection } from '@/components/editor/flow-section'
import { MetaSection } from '@/components/editor/meta-section'
import { PodsSection } from '@/components/editor/pods-section'
import { PushHeader } from '@/components/shell/push-header'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { decodeDraftDetailed, summarizeDraft, type DraftFieldError } from '@/lib/workout-draft'
import * as Editor from '@/lib/workout-editor-state'

const NO_ERRORS: readonly DraftFieldError[] = []

type EditorFormProps = {
  readonly heading: string
  readonly initial: Editor.EditorState
  readonly onSave: (workout: Workout) => void
  /** Fallback exit when the in-app history stack is empty (the back target). */
  readonly onExitFallback: () => void
}

/** The sticky `works · MM:SS` chip; hidden while the draft fails to decode. */
function SummaryChip({ summary }: { readonly summary: string | null }) {
  if (summary === null) {
    return null
  }
  return (
    <div className="sticky top-[calc(env(safe-area-inset-top)+3rem)] z-10 border-b border-border/40 bg-background/80 px-6 py-2 backdrop-blur-md">
      <span data-testid="editor-summary" className="text-sm text-muted-foreground">
        {summary}
      </span>
    </div>
  )
}

/** Confirms discarding an edited draft before the back navigation runs. */
function DiscardDialog(props: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onDiscard: () => void
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent size="sm" data-testid="editor-discard-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Discard changes?</AlertDialogTitle>
          <AlertDialogDescription>
            Your edits to this workout haven&apos;t been saved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="editor-discard-cancel">Keep editing</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            data-testid="editor-discard-confirm"
            onClick={props.onDiscard}
          >
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The header Save action, gated on a clean `Workout` decode. */
function SaveAction(props: {
  readonly decoded: Either.Either<Workout, readonly DraftFieldError[]>
  readonly onSave: (workout: Workout) => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      data-testid="editor-save"
      disabled={!Either.isRight(props.decoded)}
      onClick={() => {
        if (Either.isRight(props.decoded)) {
          props.onSave(props.decoded.right)
        }
      }}
    >
      Save
    </Button>
  )
}

/**
 * The stateful authoring surface rebuilt on the kit. Holds the draft as plain
 * state and decodes it once per render: `decodeDraftDetailed` powers both the
 * header Save gate and the per-field error slots, while `summarizeDraft` feeds
 * the sticky chip. A draft that differs from its mount-time initial is dirty —
 * backing out then raises a discard confirm; a pristine draft backs out
 * straight to the previous screen.
 */
export function WorkoutEditorForm({ heading, initial, onSave, onExitFallback }: EditorFormProps) {
  const router = useRouter()
  const [state, setState] = React.useState(initial)
  // Anchor "dirty" to the mount-time draft — the `initial` prop is recomputed
  // per render by some callers, so compare against the first captured value.
  const mountState = React.useRef(state).current
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const draft = Editor.effectiveDraft(state)
  const decoded = decodeDraftDetailed(draft)
  const errors = Either.isLeft(decoded) ? decoded.left : NO_ERRORS

  const exit = () => {
    const history = router.history as RouterHistory
    if (history.canGoBack()) {
      history.back()
    } else {
      onExitFallback()
    }
  }

  return (
    <div className="flex min-h-svh flex-col" data-testid="workout-editor-screen">
      <PushHeader
        title={heading}
        onBack={() => (state === mountState ? exit() : setConfirmOpen(true))}
        action={<SaveAction decoded={decoded} onSave={onSave} />}
      />
      <SummaryChip summary={summarizeDraft(draft)} />
      <div className="mx-auto flex w-full max-w-sm flex-col gap-6 p-6">
        <MetaSection state={state} setState={setState} errors={errors} />
        <PodsSection state={state} setState={setState} errors={errors} />
        <FlowSection state={state} setState={setState} errors={errors} />
      </div>
      <DiscardDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onDiscard={() => {
          setConfirmOpen(false)
          exit()
        }}
      />
    </div>
  )
}
