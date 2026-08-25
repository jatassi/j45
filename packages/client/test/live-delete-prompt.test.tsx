// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  athletica,
  athleticaId,
  liveSessionOf,
  otherWorkoutId,
  renderApp,
  type Handlers,
} from './live-workout-harness'

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Everything the detail screen needs, plus whatever lobby the case is about. */
const detailHandlers = (rest: Handlers): Handlers => ({
  GetWorkout: () => Effect.succeed(athletica),
  ListWorkouts: () => Effect.succeed([athletica]),
  ...rest,
})

const openDelete = async (handlers: Handlers) => {
  renderApp(handlers, `/workouts/${athleticaId}`)
  fireEvent.click(await screen.findByTestId('delete-button'))
  return screen.findByTestId('delete-dialog')
}

describe('deleting a workout that live sessions run', () => {
  it('warns that the sessions stop, names how many, and writes nothing yet', async () => {
    let deletePayload: unknown
    const dialog = await openDelete(
      detailHandlers({
        ListActiveSessions: () =>
          Effect.succeed([
            liveSessionOf('session-abc', athleticaId),
            liveSessionOf('session-def', athleticaId),
            liveSessionOf('session-ghi', otherWorkoutId),
          ]),
        DeleteWorkout: (payload) => {
          deletePayload = payload
          return Effect.succeed(undefined)
        },
      }),
    )

    await waitFor(() => {
      expect(dialog.textContent).toContain('2 live sessions')
    })
    expect(dialog.textContent).toContain('stop immediately')
    expect(dialog.textContent).toContain('cannot undo')
    expect(deletePayload).toBeUndefined()

    fireEvent.click(screen.getByTestId('delete-confirm'))
    await screen.findByTestId('library-screen')
    expect(deletePayload).toEqual({ id: athleticaId })
  })

  it('leaves the workout and its sessions alone when the host cancels', async () => {
    let deleteCalls = 0
    const dialog = await openDelete(
      detailHandlers({
        ListActiveSessions: () => Effect.succeed([liveSessionOf('session-abc', athleticaId)]),
        DeleteWorkout: () => {
          deleteCalls++
          return Effect.succeed(undefined)
        },
      }),
    )

    await waitFor(() => {
      expect(dialog.textContent).toContain('1 live session')
    })
    fireEvent.click(screen.getByTestId('delete-cancel'))

    await waitFor(() => {
      expect(screen.queryByTestId('delete-dialog')).toBeNull()
    })
    expect(deleteCalls).toBe(0)
    expect(screen.getByTestId('workout-detail-screen')).toBeTruthy()
  })

  it('strengthens the wording when the lobby answers after the prompt is open', async () => {
    const dialog = await openDelete(
      detailHandlers({
        ListActiveSessions: () =>
          Effect.succeed([liveSessionOf('session-abc', athleticaId)]).pipe(
            Effect.delay(Duration.millis(40)),
          ),
        DeleteWorkout: () => Effect.succeed(undefined),
      }),
    )

    // The prompt opens before the lobby has answered, so it starts weak.
    expect(dialog.textContent).not.toContain('live session')
    await waitFor(() => {
      expect(dialog.textContent).toContain('1 live session')
    })
    expect(dialog.textContent).toContain('cannot undo')
  })

  it('keeps the plain confirm — no live-session wording — when nothing runs it', async () => {
    const dialog = await openDelete(
      detailHandlers({
        ListActiveSessions: () => Effect.succeed([liveSessionOf('session-ghi', otherWorkoutId)]),
        DeleteWorkout: () => Effect.succeed(undefined),
      }),
    )

    expect(dialog.textContent).toContain("This can't be undone.")
    expect(dialog.textContent).not.toContain('live session')
  })
})

describe('renaming a workout that live sessions run', () => {
  it('never prompts — a rename is cosmetic under this feature', async () => {
    let renameCalls = 0
    renderApp(
      detailHandlers({
        ListActiveSessions: () =>
          Effect.succeed([
            liveSessionOf('session-abc', athleticaId),
            liveSessionOf('session-def', athleticaId),
          ]),
        RenameWorkout: () => {
          renameCalls++
          return Effect.succeed(athletica)
        },
      }),
      `/workouts/${athleticaId}`,
    )

    fireEvent.click(await screen.findByTestId('rename-button'))
    fireEvent.click(await screen.findByTestId('rename-confirm'))

    await waitFor(() => {
      expect(renameCalls).toBe(1)
    })
    expect(screen.queryByTestId('live-save-dialog')).toBeNull()
    expect(screen.queryByTestId('delete-dialog')).toBeNull()
  })
})
