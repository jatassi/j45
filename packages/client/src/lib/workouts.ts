import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * The caller's full workout list (`ListWorkouts`), hoisted to module scope
 * like every other rpc atom in this codebase (`rpc-client.ts`'s
 * `ServerRpcClient` itself, `account-screen.tsx`'s passkey atoms) — a
 * stable atom identity across re-renders. Lives here, outside any component
 * file, so both `library-screen.tsx` (which reads it) and
 * `workout-detail-screen.tsx` (whose rename/duplicate/delete mutations
 * refresh it on success) import the exact same atom without either
 * component file exporting a non-component value — this project's
 * `react/only-export-components` Fast Refresh guard (`.oxlintrc.json`)
 * disallows exactly that.
 */
export const listWorkoutsAtom = ServerRpcClient.query('ListWorkouts', undefined)

/**
 * `totalDurationMillis` (from the domain `compile`) as `MM:SS`, rounding up
 * to the next whole second so a workout never displays shorter than it
 * actually runs. Shared by `library-screen.tsx`'s cards and
 * `workout-detail-screen.tsx`'s header, for the same reason
 * `listWorkoutsAtom` above lives here rather than in either component file.
 */
export function formatDuration(totalDurationMillis: number): string {
  const totalSeconds = Math.ceil(totalDurationMillis / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
