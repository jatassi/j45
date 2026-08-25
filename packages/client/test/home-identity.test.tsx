// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  athletica,
  defaultHandlers,
  ironCircuit,
  makeCompletion,
  makeLibraryWorkout,
  renderHomeScreen,
  rowOrder,
  startedSummary,
} from './home-harness'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

afterEach(() => {
  cleanup()
})

/**
 * How Home joins completion records to the caller's library: by the source
 * `WorkoutId` on the record, never by its workout name. Names are free text
 * and nothing keeps them unique, so a name match can offer — and start — a
 * workout the user did not choose.
 */
describe('HomeScreen — history resolves by identity', () => {
  // The caller's own second copy of a workout, sharing "Iron Circuit" with the
  // library head. Duplicate-and-rename-back makes this reachable by ordinary use.
  const ironTwin = makeLibraryWorkout('workout-iron-copy', 'Iron Circuit', 'strength')
  // A third entry, last in library order, so a recent list padded from the
  // library reads differently from one a history entry led.
  const ladderDay = makeLibraryWorkout('workout-ladder', 'Ladder Day', 'hybrid')
  const threeWorkouts = [ironCircuit, athletica, ladderDay]

  it('starts the workout the record identifies when two library workouts share a name', async () => {
    let startPayload: unknown
    renderHomeScreen(
      defaultHandlers({
        ListWorkouts: () => Effect.succeed([ironCircuit, ironTwin]),
        // The twin, not the library head a name match would have returned.
        ListHistory: () => Effect.succeed([makeCompletion('c-twin', 'Iron Circuit', ironTwin.id)]),
        StartSession: (payload) => {
          startPayload = payload
          return Effect.succeed(startedSummary)
        },
      }),
    )

    const hero = await screen.findByTestId('home-hero')
    expect(hero.textContent).toContain('Start last')
    fireEvent.click(screen.getByTestId('hero-start'))

    await screen.findByTestId(`session-screen-${startedSummary.id}`)
    expect(startPayload).toEqual({ workoutId: ironTwin.id })
  })

  it('keeps a renamed workout leading the recent list, under its current name', async () => {
    renderHomeScreen(
      defaultHandlers({
        ListWorkouts: () => Effect.succeed(threeWorkouts),
        // The record holds the name as run; the library entry has moved on.
        ListHistory: () =>
          Effect.succeed([makeCompletion('c-renamed', 'Ladder Day (old)', ladderDay.id)]),
      }),
    )

    const list = await screen.findByTestId('home-recent-list')
    // History leads; the library pads behind it in its own order.
    expect(rowOrder(list)).toEqual([
      `recent-row-${ladderDay.id}`,
      `recent-row-${ironCircuit.id}`,
      `recent-row-${athletica.id}`,
    ])

    const row = screen.getByTestId(`recent-row-${ladderDay.id}`)
    expect(row.textContent).toContain('Ladder Day')
    expect(row.textContent).not.toContain('(old)')
  })

  it('offers no row and no hero for a session run on another user’s plan, walking to the caller’s own', async () => {
    let startPayload: unknown
    renderHomeScreen(
      defaultHandlers({
        ListHistory: () =>
          Effect.succeed([
            // Newest: a friend's plan, sharing a name with the caller's copy.
            makeCompletion('c-foreign', 'Iron Circuit', 'workout-their-iron'),
            makeCompletion('c-mine', 'Athletica', athletica.id),
          ]),
        StartSession: (payload) => {
          startPayload = payload
          return Effect.succeed(startedSummary)
        },
      }),
    )

    const hero = await screen.findByTestId('home-hero')
    expect(hero.textContent).toContain('Start last')
    expect(hero.textContent).toContain('Athletica')
    fireEvent.click(screen.getByTestId('hero-start'))
    await screen.findByTestId(`session-screen-${startedSummary.id}`)
    expect(startPayload).toEqual({ workoutId: athletica.id })
  })

  it('skips unresolvable records in the recent list and keeps it full from the library', async () => {
    renderHomeScreen(
      defaultHandlers({
        ListWorkouts: () => Effect.succeed(threeWorkouts),
        ListHistory: () =>
          Effect.succeed([
            // A deleted workout, another user's plan whose name collides with
            // the caller's own copy, and a record written before completions
            // carried identity. None of the three can be started.
            makeCompletion('c-deleted', 'Gone Workout', 'workout-deleted'),
            makeCompletion('c-foreign', 'Ladder Day', 'workout-their-ladder'),
            makeCompletion('c-legacy', 'Athletica'),
          ]),
      }),
    )

    const list = await screen.findByTestId('home-recent-list')
    // Nothing from the history leads: the list is the library, in its order.
    expect(rowOrder(list)).toEqual([
      `recent-row-${ironCircuit.id}`,
      `recent-row-${athletica.id}`,
      `recent-row-${ladderDay.id}`,
    ])
  })

  it('falls back to the browse hero when nothing in the history resolves', async () => {
    renderHomeScreen(
      defaultHandlers({
        ListHistory: () =>
          Effect.succeed([makeCompletion('c-foreign', 'Iron Circuit', 'workout-their-iron')]),
      }),
    )

    const hero = await screen.findByTestId('home-hero')
    expect(hero.textContent).toContain('From your library')
    expect(hero.textContent).not.toContain('Start last')
    expect(screen.getByTestId('hero-browse-link')).toBeTruthy()
  })
})
