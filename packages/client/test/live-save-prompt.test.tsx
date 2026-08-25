// @vitest-environment jsdom
import type { Workout } from '@j45/domain'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  athletica,
  athleticaId,
  libraryWorkoutOf,
  liveSessionOf,
  otherWorkoutId,
  renderApp,
  type Handlers,
  type RenderOptions,
} from './live-workout-harness'
import { makeLobby, staticLobby } from './lobby-feed'

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Everything the editor needs, plus whatever lobby the case is about. */
const editorHandlers = (rest: Handlers): Handlers => ({
  GetWorkout: () => Effect.succeed(athletica),
  ListWorkouts: () => Effect.succeed([athletica]),
  ...rest,
})

/** Renames the first station, so the save has a change to carry. */
const editTheDraft = () => {
  fireEvent.change(screen.getAllByTestId('station-name-input')[0], { target: { value: 'Ski erg' } })
}

const openEditor = async (handlers: Handlers, options: RenderOptions = {}) => {
  renderApp(handlers, `/workouts/${athleticaId}/edit`, options)
  await screen.findByTestId('workout-editor-screen')
  editTheDraft()
  fireEvent.click(screen.getByTestId('editor-save'))
}

describe('saving an edit into a workout that live sessions run', () => {
  it('prompts before writing, and states how many sessions the change reaches', async () => {
    let updateCalls = 0
    await openEditor(
      editorHandlers({
        WatchActiveSessions: staticLobby([
          liveSessionOf('session-abc', athleticaId),
          liveSessionOf('session-def', athleticaId),
          liveSessionOf('session-ghi', otherWorkoutId),
        ]),
        UpdateWorkout: () => {
          updateCalls++
          return Effect.succeed(athletica)
        },
      }),
    )

    const dialog = await screen.findByTestId('live-save-dialog')
    expect(dialog.textContent).toContain('2 live sessions')
    expect(updateCalls).toBe(0)
  })

  it('writes the edit when the host confirms', async () => {
    let updated: Workout | undefined
    await openEditor(
      editorHandlers({
        WatchActiveSessions: staticLobby([liveSessionOf('session-abc', athleticaId)]),
        UpdateWorkout: (payload) => {
          updated = (payload as { workout: Workout }).workout
          return Effect.succeed(libraryWorkoutOf(updated))
        },
      }),
    )

    const dialog = await screen.findByTestId('live-save-dialog')
    expect(dialog.textContent).toContain('1 live session')
    fireEvent.click(screen.getByTestId('live-save-confirm'))

    await screen.findByTestId('workout-detail-screen')
    expect(updated?.pods[0].stations.map((station) => station.name)).toEqual([
      'Ski erg',
      'Squat press',
      'Burpee',
    ])
  })

  it('writes nothing and keeps the draft when the host cancels', async () => {
    let updateCalls = 0
    await openEditor(
      editorHandlers({
        WatchActiveSessions: staticLobby([liveSessionOf('session-abc', athleticaId)]),
        UpdateWorkout: () => {
          updateCalls++
          return Effect.succeed(athletica)
        },
      }),
    )

    await screen.findByTestId('live-save-dialog')
    fireEvent.click(screen.getByTestId('live-save-cancel'))

    await waitFor(() => {
      expect(screen.queryByTestId('live-save-dialog')).toBeNull()
    })
    expect(updateCalls).toBe(0)
    expect(screen.getByTestId('workout-editor-screen')).toBeTruthy()
    expect(screen.getAllByTestId<HTMLInputElement>('station-name-input')[0].value).toBe('Ski erg')
  })

  it('saves straight through, with no prompt, when no session runs the workout', async () => {
    let updateCalls = 0
    await openEditor(
      editorHandlers({
        WatchActiveSessions: staticLobby([liveSessionOf('session-ghi', otherWorkoutId)]),
        UpdateWorkout: (payload) => {
          updateCalls++
          return Effect.succeed(libraryWorkoutOf((payload as { workout: Workout }).workout))
        },
      }),
    )

    await screen.findByTestId('workout-detail-screen')
    expect(screen.queryByTestId('live-save-dialog')).toBeNull()
    expect(updateCalls).toBe(1)
  })

  it('keeps its opening count when the last session ends under the open prompt', async () => {
    const lobby = makeLobby([liveSessionOf('session-abc', athleticaId)])
    let updateCalls = 0
    await openEditor(
      editorHandlers({
        WatchActiveSessions: lobby.handler,
        UpdateWorkout: () => {
          updateCalls++
          return Effect.succeed(athletica)
        },
      }),
      { probesSessions: true },
    )

    const dialog = await screen.findByTestId('live-save-dialog')
    expect(dialog.textContent).toContain('1 live session')

    // The session ends while the host reads the prompt.
    await lobby.publish([])
    await waitFor(() => {
      expect(screen.getByTestId('lobby-probe').dataset.count).toBe('0')
    })

    // The title says the workout is live, so the count must not say nobody.
    expect(dialog.textContent).not.toContain('0 live sessions')
    expect(dialog.textContent).toContain('1 live session')
    expect(updateCalls).toBe(0)
  })

  it('strengthens the wording when a session starts under the open prompt', async () => {
    const lobby = makeLobby([liveSessionOf('session-abc', athleticaId)])
    await openEditor(
      editorHandlers({
        WatchActiveSessions: lobby.handler,
        UpdateWorkout: () => Effect.succeed(athletica),
      }),
      { probesSessions: true },
    )

    const dialog = await screen.findByTestId('live-save-dialog')
    expect(dialog.textContent).toContain('1 live session')

    await lobby.publish([
      liveSessionOf('session-abc', athleticaId),
      liveSessionOf('session-def', athleticaId),
    ])

    await waitFor(() => {
      expect(dialog.textContent).toContain('2 live sessions')
    })
  })

  it('gates launch mode the same way — its Save to plan writes the same workout', async () => {
    let updated: Workout | undefined
    renderApp(
      editorHandlers({
        WatchActiveSessions: staticLobby([liveSessionOf('session-abc', athleticaId)]),
        UpdateWorkout: (payload) => {
          updated = (payload as { workout: Workout }).workout
          return Effect.succeed(libraryWorkoutOf(updated))
        },
      }),
      `/workouts/${athleticaId}/reflow`,
    )

    await screen.findByTestId('reflow-editor-screen')
    fireEvent.click(screen.getByTestId('reflow-flow-sets'))
    fireEvent.click(screen.getByTestId('reflow-save'))

    const dialog = await screen.findByTestId('live-save-dialog')
    expect(dialog.textContent).toContain('1 live session')
    expect(updated).toBeUndefined()

    fireEvent.click(screen.getByTestId('live-save-confirm'))
    await screen.findByTestId('workout-detail-screen')
    expect(updated?.flow.type).toBe('sets')
  })
})
