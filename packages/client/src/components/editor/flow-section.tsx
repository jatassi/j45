import type * as React from 'react'

import { FlowTypeToggle, Stepper, UniformField, WorkRestPair } from '@/components/editor/controls'
import { errorAt, type FieldErrors } from '@/components/editor/field-errors'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import type { DraftRound } from '@/lib/workout-draft'
import * as Editor from '@/lib/workout-editor-state'

type SetState = React.Dispatch<React.SetStateAction<Editor.EditorState>>
type FlowProps = {
  readonly state: Editor.EditorState
  readonly setState: SetState
  readonly errors: FieldErrors
}

/** One work/rest row per round, or a single uniform pair. Errors pin per round. */
function RoundLadder({ state, setState, errors }: FlowProps) {
  if (state.uniform) {
    return (
      <WorkRestPair
        testidPrefix="editor-uniform"
        workSeconds={state.rounds[0].workSeconds}
        restSeconds={state.rounds[0].restSeconds}
        onChange={(patch) => setState((s) => Editor.setRound(s, { index: 0, patch }))}
      />
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {state.rounds.map((round, index) => (
        <LadderRow key={round.id} index={index} round={round} setState={setState} errors={errors} />
      ))}
    </div>
  )
}

function LadderRow({
  index,
  round,
  setState,
  errors,
}: {
  readonly index: number
  readonly round: Editor.ERound
  readonly setState: SetState
  readonly errors: FieldErrors
}) {
  const change = (patch: Partial<DraftRound>) =>
    setState((s) => Editor.setRound(s, { index, patch }))
  const workError = errorAt(errors, `flow.rounds.${index}.workSeconds`)
  const restError = errorAt(errors, `flow.rounds.${index}.restSeconds`)
  return (
    <div className="flex flex-col gap-1">
      <WorkRestPair
        testidPrefix="editor-round"
        workSeconds={round.workSeconds}
        restSeconds={round.restSeconds}
        onChange={change}
      />
      <FieldError data-testid="editor-round-error">{workError ?? restError}</FieldError>
    </div>
  )
}

/** Flow type toggle, uniform switch, round-count stepper, and the round ladder. */
export function FlowSection({ state, setState, errors }: FlowProps) {
  return (
    <section className="flex w-full flex-col gap-5">
      <Field>
        <FieldLabel>Flow</FieldLabel>
        <FlowTypeToggle
          testid="editor-flow"
          value={state.flowType}
          onChange={(type) => setState((s) => Editor.setFlowType(s, type))}
        />
      </Field>
      <UniformField
        testid="editor-uniform"
        checked={state.uniform}
        onToggle={() => setState((s) => Editor.toggleUniform(s))}
      />
      <Field orientation="horizontal">
        <FieldLabel>Rounds</FieldLabel>
        <Stepper
          testid="editor-round-count"
          min={1}
          value={state.roundCountText}
          onChange={(value) => setState((s) => Editor.changeRoundCount(s, value))}
        />
      </Field>
      <RoundLadder state={state} setState={setState} errors={errors} />
    </section>
  )
}
