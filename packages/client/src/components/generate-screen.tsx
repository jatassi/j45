import * as React from 'react'

import { useAtom, useAtomRefresh } from '@effect-atom/atom-react'
import {
  compile,
  Equipment,
  equipmentLabel,
  Focus,
  focusLabel,
  MuscleGroup,
  muscleGroupLabel,
  type LibraryWorkout,
  type Workout,
} from '@j45/domain'
import { Link, useNavigate } from '@tanstack/react-router'

import { ChipRow } from '@/components/exercise-dialogs'
import { Button } from '@/components/ui/button'
import { inputClass } from '@/components/workout-editor-fields'
import { setInitialDraft } from '@/lib/editor-draft'
import { ServerRpcClient } from '@/lib/rpc-client'
import { formatDuration, listWorkoutsAtom } from '@/lib/workouts'

const generateWorkoutAtom = ServerRpcClient.mutation('GenerateWorkout')
const createWorkoutAtom = ServerRpcClient.mutation('CreateWorkout')
const FOCI = Focus.literals
const EQUIPMENT = Equipment.literals
const MUSCLE_GROUPS = MuscleGroup.literals
const mintSeed = (): number => Math.floor(Math.random() * 2 ** 31)

/** Pull `.reason` out of a squashed `GenerationInfeasible`. */
const infeasibleReason = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined
  if (!('_tag' in error) || error._tag !== 'GenerationInfeasible') return undefined
  return 'reason' in error && typeof error.reason === 'string' ? error.reason : undefined
}

function toggle<A>(set: ReadonlySet<A>, value: A): ReadonlySet<A> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

type Preview = { readonly workout: Workout; readonly seed: number }
type Constraints = {
  readonly focus: Focus
  readonly targetMinutes: number
  readonly equipment: ReadonlySet<Equipment>
  readonly emphasis: MuscleGroup | undefined
  readonly noRepeatSessions: number
}
type FormModel = {
  readonly c: Constraints
  readonly setFocus: (f: Focus) => void
  readonly setMinutes: (n: number) => void
  readonly setEquipment: React.Dispatch<React.SetStateAction<ReadonlySet<Equipment>>>
  readonly setEmphasis: (e: MuscleGroup | undefined) => void
  readonly setNoRepeat: React.Dispatch<React.SetStateAction<number>>
}

const summaryOf = (w: Workout): string => {
  const { workTotal, totalDurationMillis } = compile(w)
  return `${workTotal} works · ${formatDuration(totalDurationMillis)}`
}

function FocusMinutes({ form }: { readonly form: FormModel }) {
  return (
    <>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Focus
        <select
          data-testid="generate-focus"
          className={inputClass}
          value={form.c.focus}
          onChange={(e) => {
            form.setFocus(e.target.value as Focus)
          }}
        >
          {FOCI.map((v) => (
            <option key={v} value={v}>
              {focusLabel[v]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Target minutes
        <input
          data-testid="generate-target-minutes"
          type="number"
          min={1}
          step={1}
          className={inputClass}
          value={form.c.targetMinutes}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10)
            if (Number.isFinite(n) && n > 0) form.setMinutes(n)
          }}
        />
      </label>
    </>
  )
}

function EquipmentEmphasis({ form }: { readonly form: FormModel }) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Equipment</span>
        <ChipRow
          values={EQUIPMENT}
          selected={form.c.equipment}
          testIdPrefix="generate-equipment"
          labels={equipmentLabel}
          onToggle={(eq) => {
            form.setEquipment((prev) => toggle(prev, eq))
          }}
        />
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Emphasis
        <select
          data-testid="generate-emphasis"
          className={inputClass}
          value={form.c.emphasis ?? ''}
          onChange={(e) => {
            form.setEmphasis(e.target.value === '' ? undefined : (e.target.value as MuscleGroup))
          }}
        >
          <option value="">None</option>
          {MUSCLE_GROUPS.map((v) => (
            <option key={v} value={v}>
              {muscleGroupLabel[v]}
            </option>
          ))}
        </select>
      </label>
    </>
  )
}

function NoRepeatStepper({ form }: { readonly form: FormModel }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">No-repeat sessions</span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="generate-no-repeat-dec"
          disabled={form.c.noRepeatSessions <= 0}
          onClick={() => {
            form.setNoRepeat((v) => Math.max(0, v - 1))
          }}
        >
          −
        </Button>
        <input
          data-testid="generate-no-repeat"
          type="number"
          min={0}
          step={1}
          readOnly
          className={`${inputClass} w-16 text-center`}
          value={form.c.noRepeatSessions}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="generate-no-repeat-inc"
          onClick={() => {
            form.setNoRepeat((v) => v + 1)
          }}
        >
          +
        </Button>
      </div>
    </div>
  )
}

type ActionBarProps = {
  readonly busy: boolean
  readonly hasPreview: boolean
  readonly onRegenerate: () => void
  readonly onSave: () => void
  readonly onEdit: () => void
}

function ActionBar({ busy, hasPreview, onRegenerate, onSave, onEdit }: ActionBarProps) {
  const extras = hasPreview
    ? ([
        { id: 'generate-regenerate', label: 'Regenerate', outline: true, onClick: onRegenerate },
        { id: 'generate-save', label: 'Save', outline: false, onClick: onSave },
        { id: 'generate-edit', label: 'Edit', outline: true, onClick: onEdit },
      ] as const)
    : []
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" size="sm" data-testid="generate-button" disabled={busy}>
        Generate
      </Button>
      {extras.map((b) => (
        <Button
          key={b.id}
          type="button"
          size="sm"
          variant={b.outline ? 'outline' : 'default'}
          data-testid={b.id}
          disabled={busy}
          onClick={b.onClick}
        >
          {b.label}
        </Button>
      ))}
    </div>
  )
}

function stationLabel(s: { readonly name: string; readonly detail?: string }): string {
  return s.detail !== undefined && s.detail.length > 0 ? `${s.name} — ${s.detail}` : s.name
}

function PreviewCard({ preview }: { readonly preview: Preview }) {
  return (
    <div
      className="flex w-full max-w-sm flex-col gap-3"
      data-testid="generate-preview"
      data-seed={preview.seed}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-medium" data-testid="generate-codename">
          {preview.workout.name}
        </h2>
        <span data-testid="generate-summary" className="text-sm text-muted-foreground">
          {summaryOf(preview.workout)}
        </span>
      </div>
      <ul className="flex w-full flex-col gap-3">
        {preview.workout.pods.map((pod) => (
          <li key={pod.name} className="rounded-md border border-border p-3">
            <h3 className="mb-1 text-sm font-medium">{pod.name}</h3>
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {pod.stations.map((s) => (
                <li key={s.name}>{stationLabel(s)}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}

function useGenerateActions() {
  const navigate = useNavigate()
  const refreshList = useAtomRefresh(listWorkoutsAtom)
  const [, generate] = useAtom(generateWorkoutAtom, { mode: 'promise' })
  const [, create] = useAtom(createWorkoutAtom, { mode: 'promise' })
  const [preview, setPreview] = React.useState<Preview | undefined>(undefined)
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [busy, setBusy] = React.useState(false)
  const runGenerate = (c: Constraints, seed: number) => {
    setBusy(true)
    setError(undefined)
    const payload = {
      focus: c.focus,
      targetMinutes: c.targetMinutes,
      equipment: [...c.equipment],
      ...(c.emphasis === undefined ? {} : { emphasis: c.emphasis }),
      noRepeatSessions: c.noRepeatSessions,
      seed,
    }
    void generate({ payload })
      .then((workout: Workout) => {
        setPreview({ workout, seed })
      })
      .catch((error: unknown) => {
        setError(infeasibleReason(error) ?? 'Generation failed')
      })
      .finally(() => {
        setBusy(false)
      })
  }
  const onSave = () => {
    if (preview === undefined) return
    setBusy(true)
    void create({ payload: { workout: preview.workout } })
      .then((created: LibraryWorkout) => {
        refreshList()
        return navigate({ to: '/workouts/$workoutId', params: { workoutId: created.id } })
      })
      .catch(() => undefined)
      .finally(() => {
        setBusy(false)
      })
  }
  const onEdit = () => {
    if (preview === undefined) return
    setInitialDraft(preview.workout)
    void navigate({ to: '/workouts/new' })
  }
  return { preview, error, busy, runGenerate, onSave, onEdit }
}

function useConstraints(): FormModel {
  const [focus, setFocus] = React.useState<Focus>('hybrid')
  const [minutes, setMinutes] = React.useState(30)
  const [equipment, setEquipment] = React.useState<ReadonlySet<Equipment>>(() => new Set(EQUIPMENT))
  const [emphasis, setEmphasis] = React.useState<MuscleGroup | undefined>(undefined)
  const [noRepeat, setNoRepeat] = React.useState(3)
  const c: Constraints = {
    focus,
    targetMinutes: minutes,
    equipment,
    emphasis,
    noRepeatSessions: noRepeat,
  }
  return { c, setFocus, setMinutes, setEquipment, setEmphasis, setNoRepeat }
}

/** `/generate` — form knobs + preview, Regenerate/Save/Edit, infeasible error. */
export function GenerateScreen() {
  const form = useConstraints()
  const { preview, error, busy, runGenerate, onSave, onEdit } = useGenerateActions()
  return (
    <div className="flex min-h-svh flex-col items-center gap-6 p-6" data-testid="generate-screen">
      <header className="flex w-full max-w-sm flex-col gap-2">
        <Link
          to="/library"
          data-testid="library-nav-link"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          ← Your library
        </Link>
        <h1 className="text-lg font-medium">Generate workout</h1>
      </header>
      <form
        className="flex w-full max-w-sm flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          runGenerate(form.c, mintSeed())
        }}
      >
        <FocusMinutes form={form} />
        <EquipmentEmphasis form={form} />
        <NoRepeatStepper form={form} />
        {error === undefined ? null : (
          <p role="alert" data-testid="generate-error" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <ActionBar
          busy={busy}
          hasPreview={preview !== undefined}
          onRegenerate={() => {
            runGenerate(form.c, mintSeed())
          }}
          onSave={onSave}
          onEdit={onEdit}
        />
      </form>
      {preview === undefined ? null : <PreviewCard preview={preview} />}
    </div>
  )
}
