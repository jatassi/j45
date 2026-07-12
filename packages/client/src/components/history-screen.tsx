import { Result, useAtomValue } from '@effect-atom/atom-react'
import type { SessionCompletion, User } from '@j45/domain'
import * as DateTime from 'effect/DateTime'

import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * The caller's session completion history (`ListHistory`), hoisted to module
 * scope for a stable atom identity — same pattern as `listWorkoutsAtom` and
 * `listActiveSessionsAtom`. Not exported: this file only exports components
 * (`react/only-export-components`).
 */
const listHistoryAtom = ServerRpcClient.query('ListHistory', undefined)

/** `endedAt` as a locale date/time string — simplest conversion, no shared helper. */
function formatEndedAt(endedAt: DateTime.Utc): string {
  return DateTime.toDate(endedAt).toLocaleString()
}

type HistoryRowProps = {
  readonly completion: SessionCompletion
  readonly callerId: User['id']
}

/** One history row: workout name, ended date, host ("you" when caller), participants. */
function HistoryRow({ completion, callerId }: HistoryRowProps) {
  const hostLabel = completion.host.userId === callerId ? 'you' : completion.host.displayName
  const participantNames = completion.participants
    .map((participant) => participant.displayName)
    .join(', ')

  return (
    <li data-testid={`history-row-${completion.id}`}>
      <div className="flex flex-col gap-1 rounded-md border p-3 text-sm">
        <span className="font-medium" data-testid={`history-name-${completion.id}`}>
          {completion.workoutName}
        </span>
        <span className="text-muted-foreground" data-testid={`history-date-${completion.id}`}>
          {formatEndedAt(completion.endedAt)}
        </span>
        <span data-testid={`history-host-${completion.id}`}>Host: {hostLabel}</span>
        <span
          className="text-muted-foreground"
          data-testid={`history-participants-${completion.id}`}
        >
          {participantNames}
        </span>
        {completion.progress ? (
          <span className="text-muted-foreground" data-testid={`history-progress-${completion.id}`}>
            {completion.progress.segmentsCompleted}/{completion.progress.totalSegments}
          </span>
        ) : null}
      </div>
    </li>
  )
}

type HistoryListProps = {
  readonly completions: readonly SessionCompletion[]
  readonly callerId: User['id']
}

/** Non-empty history list — one row per completion, in server order (newest-first). */
function HistoryList({ completions, callerId }: HistoryListProps) {
  return (
    <ul className="flex w-full flex-col gap-3" data-testid="history-list">
      {completions.map((completion) => (
        <HistoryRow key={completion.id} completion={completion} callerId={callerId} />
      ))}
    </ul>
  )
}

type HistoryScreenProps = {
  readonly user: User
}

/**
 * Session history (`/history`): the caller's `ListHistory` completions,
 * newest-first as the server returns them. Needs the authenticated `User`
 * from `RouterContext` so host display can render "you" when the caller hosted.
 */
export function HistoryScreen({ user }: HistoryScreenProps) {
  const history = useAtomValue(listHistoryAtom)

  return (
    <div className="flex min-h-svh flex-col items-center gap-6 p-6" data-testid="history-screen">
      <header className="w-full max-w-sm">
        <h1 className="text-lg font-medium">History</h1>
      </header>
      <div className="w-full max-w-sm">
        {Result.match(history, {
          onInitial: () => <p className="text-sm text-muted-foreground">Loading your history…</p>,
          onFailure: (failure) => (
            <p className="text-sm text-destructive">
              Failed to load your history: {String(failure.cause)}
            </p>
          ),
          onSuccess: ({ value }) =>
            value.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="history-empty">
                No completed sessions yet.
              </p>
            ) : (
              <HistoryList completions={value} callerId={user.id} />
            ),
        })}
      </div>
    </div>
  )
}
