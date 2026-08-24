import { useAtom, useAtomRefresh } from '@effect-atom/atom-react'
import { WorkoutConflict, type LibraryWorkout, type Workout } from '@j45/domain'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'

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

/**
 * The one `UpdateWorkout` path both the normal editor and launch mode save
 * through: write the body under the version the screen read, then refresh the
 * list + this workout's `GetWorkout` atom and reopen its detail.
 *
 * `updatedAt` is the optimistic-concurrency precondition, so a save built on
 * a stale read fails `WorkoutConflict` rather than discarding whoever wrote in
 * between. There is deliberately no merge: the conflict says so out loud and
 * re-fetches, which leaves each screen holding the winner's version. A
 * transport failure, by contrast, refreshes nothing — there is no new version
 * to adopt, and throwing away the user's draft over a dropped connection
 * would be a worse bug than the one this guards.
 */
export function useWorkoutSave(options: WorkoutSaveOptions): (workout: Workout) => void {
  const { id, updatedAt } = options.source
  const navigate = useNavigate()
  const refreshList = useAtomRefresh(listWorkoutsAtom)
  const refreshWorkout = useAtomRefresh(ServerRpcClient.query('GetWorkout', { id }))
  const [, update] = useAtom(updateWorkoutAtom, { mode: 'promise' })

  return (workout: Workout) =>
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
}
