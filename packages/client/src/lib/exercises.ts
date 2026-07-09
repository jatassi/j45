import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * The caller's whole exercise catalog (`ListExercises`), hoisted to module
 * scope like every other rpc atom in this codebase (`workouts.ts`'s
 * `listWorkoutsAtom`, `account-screen.tsx`'s passkey atoms) — a stable atom
 * identity across re-renders. It lives here, outside the component file, so
 * `exercise-library-screen.tsx` can both read it (`useAtomValue`) and, after
 * a create/update/delete mutation, refresh it (`useAtomRefresh`) without the
 * component file exporting a non-component value — this project's
 * `react/only-export-components` Fast-Refresh guard (`.oxlintrc.json`)
 * disallows exactly that.
 */
export const listExercisesAtom = ServerRpcClient.query('ListExercises', undefined)

/**
 * The create/update/delete mutation atoms, hoisted here for the same reason
 * as `listExercisesAtom` above (and mirroring `account-screen.tsx`'s
 * `deletePasskeyAtom`): a stable identity `useAtom(..., { mode: 'promise' })`
 * keys off, driven from `exercise-library-screen.tsx`'s dialogs. Each
 * resolves its promise on success; the screen then refreshes
 * `listExercisesAtom` so the list reflects the mutation.
 */
export const createExerciseAtom = ServerRpcClient.mutation('CreateExercise')
export const updateExerciseAtom = ServerRpcClient.mutation('UpdateExercise')
export const deleteExerciseAtom = ServerRpcClient.mutation('DeleteExercise')
