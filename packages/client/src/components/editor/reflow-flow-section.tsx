import type * as React from 'react'

import { FlowTypeToggle, Stepper, UniformField, WorkRestPair } from '@/components/editor/controls'
import { Field, FieldLabel } from '@/components/ui/field'
import * as ReflowDraft from '@/lib/reflow-draft'

type SetState = React.Dispatch<React.SetStateAction<ReflowDraft.ReflowDraft>>

type FlowProps = {
  readonly state: ReflowDraft.ReflowDraft
  readonly setState: SetState
}

/** One work/rest row per round, or a single uniform pair — same kit controls as New/Edit. */
function RoundLadder({ state, setState }: FlowProps) {
  if (state.uniform) {
    return (
      <WorkRestPair
        testidPrefix="reflow-uniform"
        workSeconds={state.rounds[0].workSeconds}
        restSeconds={state.rounds[0].restSeconds}
        onChange={(patch) => setState((s) => ReflowDraft.setRound(s, { index: 0, patch }))}
      />
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {state.rounds.map((round, index) => (
        <WorkRestPair
          key={round.id}
          testidPrefix="reflow-round"
          workSeconds={round.workSeconds}
          restSeconds={round.restSeconds}
          onChange={(patch) => setState((s) => ReflowDraft.setRound(s, { index, patch }))}
        />
      ))}
    </div>
  )
}

/** Flow type toggle, uniform switch, round-count stepper, and the round ladder. */
export function ReflowFlowSection({ state, setState }: FlowProps) {
  return (
    <section className="flex w-full flex-col gap-5">
      <Field>
        <FieldLabel>Flow</FieldLabel>
        <FlowTypeToggle
          testid="reflow-flow"
          value={state.flowType}
          onChange={(type) => setState((s) => ReflowDraft.setFlowType(s, type))}
        />
      </Field>
      <UniformField
        testid="reflow-uniform"
        checked={state.uniform}
        onToggle={() => setState((s) => ReflowDraft.toggleUniform(s))}
      />
      <Field orientation="horizontal">
        <FieldLabel>Rounds</FieldLabel>
        <Stepper
          testid="reflow-round-count"
          min={1}
          value={state.roundCountText}
          onChange={(value) => setState((s) => ReflowDraft.changeRoundCount(s, value))}
        />
      </Field>
      <RoundLadder state={state} setState={setState} />
    </section>
  )
}
