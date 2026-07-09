import type * as React from 'react'

import type { Workout } from '@j45/domain'
import * as Either from 'effect/Either'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { DraftRound } from '@/lib/workout-draft'
import * as Editor from '@/lib/workout-editor-state'

/**
 * The editor's presentational form pieces, split out of
 * `workout-editor-screen.tsx` so both files stay under the per-file line cap.
 * Every section is driven by the `workout-editor-state` transitions — none
 * holds draft logic of its own; the screen owns the single `useState`.
 */

type SetState = React.Dispatch<React.SetStateAction<Editor.EditorState>>
type SectionProps = { readonly state: Editor.EditorState; readonly setState: SetState }

const inputClass = 'rounded-md border border-input bg-input/30 px-2.5 py-1.5 text-sm'

type IconButtonProps = {
  readonly testid: string
  readonly label: string
  readonly variant: 'outline' | 'destructive'
  readonly onClick: () => void
}

function IconButton({ testid, label, variant, onClick }: IconButtonProps) {
  return (
    <Button type="button" size="sm" variant={variant} data-testid={testid} onClick={onClick}>
      {label}
    </Button>
  )
}

export function MetaSection({ state, setState }: SectionProps) {
  return (
    <section className="flex w-full flex-col gap-2">
      <input
        data-testid="editor-name"
        className={inputClass}
        placeholder="Workout name"
        value={state.name}
        onChange={(e) => setState((s) => Editor.setName(s, e.target.value))}
      />
      <select
        data-testid="editor-focus"
        className={inputClass}
        value={state.focus}
        onChange={(e) => setState((s) => Editor.setFocus(s, e.target.value))}
      >
        <option value="cardio">cardio</option>
        <option value="strength">strength</option>
        <option value="hybrid">hybrid</option>
      </select>
      <input
        data-testid="editor-note"
        className={inputClass}
        placeholder="Note (optional)"
        value={state.note}
        onChange={(e) => setState((s) => Editor.setNote(s, e.target.value))}
      />
    </section>
  )
}

type StationRowProps = {
  readonly setState: SetState
  readonly podIndex: number
  readonly stationIndex: number
  readonly station: Editor.EStation
}

function StationEditor({ setState, podIndex, stationIndex, station }: StationRowProps) {
  const patch = (p: Partial<Omit<Editor.EStation, 'id'>>) =>
    setState((s) => Editor.setStationField(s, { podIndex, stationIndex, patch: p }))
  const move = (direction: -1 | 1) =>
    setState((s) => Editor.moveStation(s, { podIndex, stationIndex, direction }))
  return (
    <div className="flex flex-col gap-1" data-testid="station-editor">
      <div className="flex gap-1">
        <input
          data-testid="station-name-input"
          className={`${inputClass} flex-1`}
          placeholder="Station"
          value={station.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
        <IconButton testid="station-up" label="↑" variant="outline" onClick={() => move(-1)} />
        <IconButton testid="station-down" label="↓" variant="outline" onClick={() => move(1)} />
        <IconButton
          testid="remove-station"
          label="✕"
          variant="destructive"
          onClick={() => setState((s) => Editor.removeStation(s, podIndex, stationIndex))}
        />
      </div>
      <input
        data-testid="station-detail-input"
        className={inputClass}
        placeholder="Detail (optional)"
        value={station.detail ?? ''}
        onChange={(e) => patch({ detail: e.target.value === '' ? undefined : e.target.value })}
      />
    </div>
  )
}

type PodEditorProps = {
  readonly setState: SetState
  readonly podIndex: number
  readonly pod: Editor.EPod
}

function PodEditor({ setState, podIndex, pod }: PodEditorProps) {
  return (
    <Card size="sm" data-testid="pod-editor">
      <CardContent className="flex flex-col gap-2">
        <div className="flex gap-1">
          <input
            data-testid="pod-name-input"
            className={`${inputClass} flex-1`}
            placeholder="Pod name"
            value={pod.name}
            onChange={(e) => setState((s) => Editor.renamePod(s, podIndex, e.target.value))}
          />
          <IconButton
            testid="remove-pod"
            label="✕"
            variant="destructive"
            onClick={() => setState((s) => Editor.removePod(s, podIndex))}
          />
        </div>
        {pod.stations.map((station, i) => (
          <StationEditor
            key={station.id}
            setState={setState}
            podIndex={podIndex}
            stationIndex={i}
            station={station}
          />
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="add-station"
          onClick={() => setState((s) => Editor.addStation(s, podIndex))}
        >
          Add station
        </Button>
      </CardContent>
    </Card>
  )
}

export function PodsSection({ state, setState }: SectionProps) {
  return (
    <section className="flex w-full flex-col gap-3">
      {state.pods.map((pod, i) => (
        <PodEditor key={pod.id} setState={setState} podIndex={i} pod={pod} />
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
    </section>
  )
}

type RoundPairProps = {
  readonly testidPrefix: string
  readonly round: DraftRound
  readonly onChange: (patch: Partial<DraftRound>) => void
}

function RoundPair({ testidPrefix, round, onChange }: RoundPairProps) {
  return (
    <div className="flex gap-1">
      <input
        type="number"
        data-testid={`${testidPrefix}-work`}
        className={`${inputClass} flex-1`}
        placeholder="Work s"
        value={round.workSeconds}
        onChange={(e) => onChange({ workSeconds: e.target.value })}
      />
      <input
        type="number"
        data-testid={`${testidPrefix}-rest`}
        className={`${inputClass} flex-1`}
        placeholder="Rest s"
        value={round.restSeconds}
        onChange={(e) => onChange({ restSeconds: e.target.value })}
      />
    </div>
  )
}

function RoundInputs({ state, setState }: SectionProps) {
  if (state.uniform) {
    return (
      <RoundPair
        testidPrefix="editor-uniform"
        round={state.rounds[0]}
        onChange={(patch) => setState((s) => Editor.setRound(s, { index: 0, patch }))}
      />
    )
  }
  return (
    <div className="flex flex-col gap-1">
      {state.rounds.map((round, i) => (
        <RoundPair
          key={round.id}
          testidPrefix="round"
          round={round}
          onChange={(patch) => setState((s) => Editor.setRound(s, { index: i, patch }))}
        />
      ))}
    </div>
  )
}

export function FlowSection({ state, setState }: SectionProps) {
  return (
    <section className="flex w-full flex-col gap-2">
      <select
        data-testid="editor-flow-type"
        className={inputClass}
        value={state.flowType}
        onChange={(e) => setState((s) => Editor.setFlowType(s, e.target.value as 'laps' | 'sets'))}
      >
        <option value="laps">laps</option>
        <option value="sets">sets</option>
      </select>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid="editor-uniform"
          checked={state.uniform}
          onChange={() => setState((s) => Editor.toggleUniform(s))}
        />
        Same work/rest every round
      </label>
      <input
        type="number"
        data-testid="editor-round-count"
        className={inputClass}
        value={state.roundCountText}
        onChange={(e) => setState((s) => Editor.changeRoundCount(s, e.target.value))}
      />
      <RoundInputs state={state} setState={setState} />
    </section>
  )
}

type FooterProps = {
  readonly decoded: Either.Either<Workout, string>
  readonly summary: string | null
  readonly onSave: (workout: Workout) => void
  readonly onCancel: () => void
}

/** The summary chip / first schema error, plus Cancel and (validity-gated) Save. */
export function EditorFooter({ decoded, summary, onSave, onCancel }: FooterProps) {
  const valid = Either.isRight(decoded)
  return (
    <footer className="flex w-full items-center justify-between gap-2">
      {valid ? (
        <span data-testid="editor-summary" className="text-sm text-muted-foreground">
          {summary}
        </span>
      ) : (
        <span data-testid="editor-error" className="text-sm text-destructive">
          {decoded.left}
        </span>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="editor-cancel"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          data-testid="editor-save"
          disabled={!valid}
          onClick={() => {
            if (Either.isRight(decoded)) {
              onSave(decoded.right)
            }
          }}
        >
          Save
        </Button>
      </div>
    </footer>
  )
}
