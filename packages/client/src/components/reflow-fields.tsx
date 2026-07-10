import type * as React from 'react'

import type { Reflow, Workout } from '@j45/domain'
import * as Either from 'effect/Either'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconButton, inputClass, RoundPair } from '@/components/workout-editor-fields'
import * as ReflowDraft from '@/lib/reflow-draft'

/**
 * Launch-mode (reflow) form pieces, split out of `workout-editor-screen.tsx`
 * so both files stay under the per-file line cap — the same split
 * `workout-editor-fields.tsx` is to the normal editor. These reuse that
 * file's shared primitives (`IconButton`, `RoundPair`, `inputClass`) but
 * restrict themselves to the spec-expressible operations: station
 * names/details are read-only (no name inputs, no add-station); pods
 * rename/add/remove; stations reorder, move across pods, or drop; laps/sets
 * flip; rounds edit (initially unset so source timing carries over). The
 * draft is the `Reflow` spec itself — see `reflow-draft.ts`.
 */

type ReflowSetState = React.Dispatch<React.SetStateAction<ReflowDraft.ReflowDraft>>

type ReflowMoveProps = {
  readonly setState: ReflowSetState
  readonly pods: readonly ReflowDraft.RPod[]
  readonly podIndex: number
  readonly stationIndex: number
}

/** The "move to pod" select — the cross-pod regroup control. Hidden when there is no other pod. */
function ReflowMoveToPod({ setState, pods, podIndex, stationIndex }: ReflowMoveProps) {
  const others = pods
    .map((pod, index) => ({ pod, index }))
    .filter(({ index }) => index !== podIndex)
  if (others.length === 0) return null
  return (
    <select
      data-testid="reflow-station-move-to-pod"
      className={inputClass}
      value=""
      onChange={(e) => {
        const targetPodIndex = Number.parseInt(e.target.value, 10)
        if (Number.isNaN(targetPodIndex)) return
        setState((s) => ReflowDraft.moveStationToPod(s, { podIndex, stationIndex, targetPodIndex }))
      }}
    >
      <option value="" disabled>
        Move to pod…
      </option>
      {others.map(({ pod, index }) => (
        <option key={pod.id} value={index}>
          {pod.name}
        </option>
      ))}
    </select>
  )
}

type ReflowStationProps = ReflowMoveProps & { readonly station: ReflowDraft.RStation }

/** One read-only station reference: its name (no input), reorder / drop / move-to-pod controls. */
function ReflowStationRow({ setState, pods, podIndex, stationIndex, station }: ReflowStationProps) {
  const move = (direction: -1 | 1) =>
    setState((s) => ReflowDraft.moveStation(s, { podIndex, stationIndex, direction }))
  return (
    <div className="flex flex-col gap-1" data-testid="reflow-station">
      <div className="flex items-center gap-1">
        <span className="flex-1 text-sm" data-testid="reflow-station-name">
          {station.name}
        </span>
        <IconButton
          testid="reflow-station-up"
          label="↑"
          variant="outline"
          onClick={() => move(-1)}
        />
        <IconButton
          testid="reflow-station-down"
          label="↓"
          variant="outline"
          onClick={() => move(1)}
        />
        <IconButton
          testid="reflow-remove-station"
          label="✕"
          variant="destructive"
          onClick={() => setState((s) => ReflowDraft.removeStation(s, podIndex, stationIndex))}
        />
      </div>
      <ReflowMoveToPod
        setState={setState}
        pods={pods}
        podIndex={podIndex}
        stationIndex={stationIndex}
      />
      {station.detail === undefined ? null : (
        <span className="text-xs text-muted-foreground" data-testid="reflow-station-detail">
          {station.detail}
        </span>
      )}
    </div>
  )
}

type ReflowPodProps = {
  readonly setState: ReflowSetState
  readonly pods: readonly ReflowDraft.RPod[]
  readonly podIndex: number
  readonly pod: ReflowDraft.RPod
}

/** One pod: an editable name, a remove control, and its read-only station rows (no add-station). */
function ReflowPodEditor({ setState, pods, podIndex, pod }: ReflowPodProps) {
  return (
    <Card size="sm" data-testid="reflow-pod-editor">
      <CardContent className="flex flex-col gap-2">
        <div className="flex gap-1">
          <input
            data-testid="reflow-pod-name-input"
            className={`${inputClass} flex-1`}
            placeholder="Pod name"
            value={pod.name}
            onChange={(e) => setState((s) => ReflowDraft.renamePod(s, podIndex, e.target.value))}
          />
          <IconButton
            testid="reflow-remove-pod"
            label="✕"
            variant="destructive"
            onClick={() => setState((s) => ReflowDraft.removePod(s, podIndex))}
          />
        </div>
        {pod.stations.map((station, i) => (
          <ReflowStationRow
            key={station.id}
            setState={setState}
            pods={pods}
            podIndex={podIndex}
            stationIndex={i}
            station={station}
          />
        ))}
      </CardContent>
    </Card>
  )
}

type ReflowSectionProps = {
  readonly state: ReflowDraft.ReflowDraft
  readonly setState: ReflowSetState
}

export function ReflowPodsSection({ state, setState }: ReflowSectionProps) {
  return (
    <section className="flex w-full flex-col gap-3">
      {state.pods.map((pod, i) => (
        <ReflowPodEditor
          key={pod.id}
          setState={setState}
          pods={state.pods}
          podIndex={i}
          pod={pod}
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
    </section>
  )
}

function ReflowRoundInputs({ state, setState }: ReflowSectionProps) {
  if (state.uniform) {
    return (
      <RoundPair
        testidPrefix="reflow-uniform"
        round={state.rounds[0]}
        onChange={(patch) => setState((s) => ReflowDraft.setRound(s, { index: 0, patch }))}
      />
    )
  }
  return (
    <div className="flex flex-col gap-1">
      {state.rounds.map((round, i) => (
        <RoundPair
          key={round.id}
          testidPrefix="reflow-round"
          round={round}
          onChange={(patch) => setState((s) => ReflowDraft.setRound(s, { index: i, patch }))}
        />
      ))}
    </div>
  )
}

export function ReflowFlowSection({ state, setState }: ReflowSectionProps) {
  return (
    <section className="flex w-full flex-col gap-2">
      <select
        data-testid="reflow-flow-type"
        className={inputClass}
        value={state.flowType}
        onChange={(e) =>
          setState((s) => ReflowDraft.setFlowType(s, e.target.value as 'laps' | 'sets'))
        }
      >
        <option value="laps">laps</option>
        <option value="sets">sets</option>
      </select>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid="reflow-uniform"
          checked={state.uniform}
          onChange={() => setState((s) => ReflowDraft.toggleUniform(s))}
        />
        Same work/rest every round
      </label>
      <input
        type="number"
        data-testid="reflow-round-count"
        className={inputClass}
        value={state.roundCountText}
        onChange={(e) => setState((s) => ReflowDraft.changeRoundCount(s, e.target.value))}
      />
      <ReflowRoundInputs state={state} setState={setState} />
    </section>
  )
}

type ReflowFooterProps = {
  readonly result: Either.Either<ReflowDraft.ReflowResult, string>
  readonly summary: string | null
  readonly onStart: (reflow: Reflow) => void
  readonly onSave: (workout: Workout) => void
  readonly onCancel: () => void
}

/** The chip / first error, plus Cancel and the two validity-gated exits (Save to plan / Start session). */
export function ReflowFooter({ result, summary, onStart, onSave, onCancel }: ReflowFooterProps) {
  const valid = Either.isRight(result)
  return (
    <footer className="flex w-full flex-col gap-2">
      {valid ? (
        <span data-testid="reflow-summary" className="text-sm text-muted-foreground">
          {summary}
        </span>
      ) : (
        <span data-testid="reflow-error" className="text-sm text-destructive">
          {result.left}
        </span>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="reflow-cancel"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="reflow-save"
          disabled={!valid}
          onClick={() => {
            if (Either.isRight(result)) onSave(result.right.workout)
          }}
        >
          Save to plan
        </Button>
        <Button
          type="button"
          size="sm"
          data-testid="reflow-start"
          disabled={!valid}
          onClick={() => {
            if (Either.isRight(result)) onStart(result.right.reflow)
          }}
        >
          Start session
        </Button>
      </div>
    </footer>
  )
}
