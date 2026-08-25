import * as React from 'react'

import { useAtom, useAtomRefresh } from '@effect-atom/atom-react'
import { WorkoutConflict, type LibraryWorkout, type Workout } from '@j45/domain'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'

import { useLiveSessionCount } from '@/lib/live-workout'
import { ServerRpcClient } from '@/lib/rpc-client'
import { listWorkoutsAtom } from '@/lib/workouts'

/** Hoisted to module scope like every other rpc atom here — a stable atom identity across re-renders. */
const updateWorkoutAtom = ServerRpcClient.mutation('UpdateWorkout')

type WorkoutSaveOptions = {
  /** The version this screen loaded — both the write's target and its precondition. */
  readonly source: LibraryWorkout
  /**
   * What to tell the user when someone else got there first. The two editors
   * differ here and only here: the normal editor keeps the user's draft (a
   * whole workout body stands on its own), while launch mode rebuilds it (a
   * reflow spec is indices into a plan that just changed).
   */
  readonly conflictDescription: string
}

/** What the screen needs to drive a save and its live-session prompt. */
export type WorkoutSave = {
  /** Save the body. Prompts first when live sessions run this workout. */
  readonly save: (workout: Workout) => void
  /** Whether a save is waiting on the host. */
  readonly promptOpen: boolean
  /**
   * How many live sessions the save reaches, as the prompt states it.
   *
   * It is read live, not frozen at the click: the lobby answer can arrive
   * after the prompt opens, and a prompt that keeps a stale zero would
   * understate what the host is about to do. But the live read can only
   * raise the count. The prompt keeps the count it opened with as a floor,
   * because its title says the workout is live. A session that ends while
   * the host reads the prompt must not turn that count into nobody.
   */
  readonly promptCount: number
  /** Write the waiting save. */
  readonly confirm: () => void
  /** Drop the waiting save. The draft stays where it is. */
  readonly cancel: () => void
}

/**
 * The one `UpdateWorkout` path both the normal editor and launch mode save
 * through: write the body under the version the screen read, then refresh the
 * list + this workout's `GetWorkout` atom and reopen its detail.
 *
 * A save into a workout that live sessions run stops at a prompt first. The
 * host is told how many sessions the edit reaches before it goes out to
 * them; a cancel writes nothing and keeps the draft. With no live session the
 * save goes straight through — the common case gets no extra step. The count
 * comes from the lobby list the client already holds.
 *
 * `updatedAt` is the optimistic-concurrency precondition, so a save built on
 * a stale read fails `WorkoutConflict` rather than discarding whoever wrote in
 * between. There is deliberately no merge: the conflict says so out loud and
 * re-fetches, which leaves each screen holding the winner's version. A
 * transport failure, by contrast, refreshes nothing — there is no new version
 * to adopt, and throwing away the user's draft over a dropped connection
 * would be a worse bug than the one this guards.
 */
export function useWorkoutSave(options: WorkoutSaveOptions): WorkoutSave {
  const { id, updatedAt } = options.source
  const navigate = useNavigate()
  const refreshList = useAtomRefresh(listWorkoutsAtom)
  const refreshWorkout = useAtomRefresh(ServerRpcClient.query('GetWorkout', { id }))
  const [, update] = useAtom(updateWorkoutAtom, { mode: 'promise' })
  const liveCount = useLiveSessionCount(id)
  /** The waiting save, with the count the prompt opened with as its floor. */
  const [pending, setPending] = React.useState<
    { readonly workout: Workout; readonly floor: number } | undefined
  >(undefined)

  const write = (workout: Workout) =>
    void update({ payload: { id, workout, updatedAt } })
      .then(() => {
        refreshList()
        refreshWorkout()
        return navigate({ to: '/workouts/$workoutId', params: { workoutId: id } })
      })
      .catch((error: unknown) => {
        if (error instanceof WorkoutConflict) {
          refreshList()
          refreshWorkout()
          toast.error('Saved somewhere else', { description: options.conflictDescription })
          return
        }
        toast.error('Command failed', { description: 'Could not save the workout.' })
      })

  return {
    save: (workout: Workout) =>
      liveCount > 0 ? setPending({ workout, floor: liveCount }) : write(workout),
    promptOpen: pending !== undefined,
    promptCount: pending === undefined ? liveCount : Math.max(pending.floor, liveCount),
    confirm: () => {
      if (pending === undefined) return
      setPending(undefined)
      write(pending.workout)
    },
    cancel: () => setPending(undefined),
  }
}
