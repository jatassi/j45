import * as React from 'react'

import { useAtom, useAtomRefresh } from '@effect-atom/atom-react'
import {
  type Equipment,
  type Focus,
  type LibraryWorkout,
  type MuscleGroup,
  type Workout,
} from '@j45/domain'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'

import { DurationField } from '@/components/generate/duration-field'
import { EmphasisField } from '@/components/generate/emphasis-field'
import { EquipmentField } from '@/components/generate/equipment-field'
import { FocusField } from '@/components/generate/focus-field'
import {
  EQUIPMENT,
  infeasibleReason,
  mintSeed,
  type Constraints,
  type FormModel,
  type Preview,
} from '@/components/generate/model'
import { NoRepeatField } from '@/components/generate/no-repeat-field'
import { PreviewCard } from '@/components/generate/preview-card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { setInitialDraft } from '@/lib/editor-draft'
import { ServerRpcClient } from '@/lib/rpc-client'
import { listWorkoutsAtom } from '@/lib/workouts'

const generateWorkoutAtom = ServerRpcClient.mutation('GenerateWorkout')
const createWorkoutAtom = ServerRpcClient.mutation('CreateWorkout')

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
    void generate({
      payload: {
        focus: c.focus,
        targetMinutes: c.targetMinutes,
        equipment: [...c.equipment],
        ...(c.emphasis === undefined ? {} : { emphasis: c.emphasis }),
        noRepeatSessions: c.noRepeatSessions,
        seed,
      },
    })
      .then((workout: Workout) => setPreview({ workout, seed }))
      .catch((error: unknown) => setError(infeasibleReason(error) ?? 'Generation failed'))
      .finally(() => setBusy(false))
  }
  const onSave = () => {
    if (preview === undefined) return
    setBusy(true)
    void create({ payload: { workout: preview.workout } })
      .then((created: LibraryWorkout) => {
        refreshList()
        return navigate({ to: '/workouts/$workoutId', params: { workoutId: created.id } })
      })
      .catch(() => toast.error('Command failed', { description: 'Could not save the workout.' }))
      .finally(() => setBusy(false))
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
  return {
    c: { focus, targetMinutes: minutes, equipment, emphasis, noRepeatSessions: noRepeat },
    setFocus,
    setMinutes,
    setEquipment,
    setEmphasis,
    setNoRepeat,
  }
}

function ConstraintForm({ form }: { readonly form: FormModel }) {
  return (
    <>
      <FocusField form={form} />
      <DurationField form={form} />
      <EquipmentField form={form} />
      <EmphasisField form={form} />
      <NoRepeatField form={form} />
    </>
  )
}

function GenerateForm(p: {
  readonly form: FormModel
  readonly error: string | undefined
  readonly busy: boolean
  readonly onGenerate: () => void
}) {
  return (
    <form
      className="flex w-full max-w-sm flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        p.onGenerate()
      }}
    >
      <ConstraintForm form={p.form} />
      {p.error === undefined ? null : (
        <Alert variant="destructive" data-testid="generate-error">
          <AlertTitle>Could not generate</AlertTitle>
          <AlertDescription>{p.error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" data-testid="generate-button" disabled={p.busy}>
        {p.busy ? <Spinner data-icon="inline-start" /> : null}
        Generate
      </Button>
    </form>
  )
}

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
      <GenerateForm
        form={form}
        error={error}
        busy={busy}
        onGenerate={() => runGenerate(form.c, mintSeed())}
      />
      {preview === undefined ? null : (
        <PreviewCard
          preview={preview}
          busy={busy}
          onRegenerate={() => runGenerate(form.c, mintSeed())}
          onSave={onSave}
          onEdit={onEdit}
        />
      )}
    </div>
  )
}
