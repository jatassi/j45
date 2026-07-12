// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import { Exercise, ExerciseId, LibraryExercise } from '@j45/domain'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ExerciseLibraryScreen } from '@/components/exercise-library-screen'
import { ServerRpcClient } from '@/lib/rpc-client'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/**
 * Builds a `Runtime` that provides `ServerRpcClient` with `handlers` in place
 * of the real (websocket-backed) rpc client — the same fake-runtime idiom
 * `account-screen.test.tsx` / `library-screen.test.tsx` use, seeding
 * `ServerRpcClient.runtime` via `RegistryProvider`'s `initialValues` below.
 */
function makeFakeRuntime(
  handlers: Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>>,
) {
  const client = (tag: string, payload: unknown) => {
    const handler = handlers[tag]
    if (handler === undefined) {
      throw new Error(`unexpected rpc call: ${tag}`)
    }
    return handler(payload)
  }
  return Runtime.defaultRuntime.pipe(Runtime.provideService(ServerRpcClient, client as never))
}

const seededAt = DateTime.unsafeMake('2026-01-01T00:00:00.000Z')

const rower = new LibraryExercise({
  id: Schema.decodeSync(ExerciseId)('ex-rower'),
  exercise: new Exercise({
    name: 'Rower',
    modality: 'cardio',
    muscleGroups: ['full-body'],
    equipment: ['rower'],
    intensity: 'high',
  }),
  createdAt: seededAt,
  updatedAt: seededAt,
})

const frontSquat = new LibraryExercise({
  id: Schema.decodeSync(ExerciseId)('ex-front-squat'),
  exercise: new Exercise({
    name: 'Barbell front squat',
    modality: 'strength',
    muscleGroups: ['quads', 'glutes'],
    equipment: ['barbell'],
    intensity: 'moderate',
  }),
  createdAt: seededAt,
  updatedAt: seededAt,
})

/**
 * Mounts `ExerciseLibraryScreen` as the `/library/exercises` route of a
 * throwaway router (memory history, no file-based codegen) — a minimal
 * stand-in for `router.tsx`'s own tree, matching `library-screen.test.tsx`.
 */
function renderScreen(
  handlers: Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>>,
) {
  const fakeRuntime = makeFakeRuntime(handlers)
  const rootRoute = createRootRoute({ component: Outlet })
  const libraryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/library',
    component: () => <div data-testid="library-destination" />,
  })
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: '/library/exercises',
    component: ExerciseLibraryScreen,
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([libraryRoute, route]),
    history: createMemoryHistory({ initialEntries: ['/library/exercises'] }),
  })

  render(
    <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
      <RouterProvider router={testRouter} />
    </RegistryProvider>,
  )
}

describe('ExerciseLibraryScreen', () => {
  it('lists the caller catalog from ListExercises (name + tag badges)', async () => {
    renderScreen({ ListExercises: () => Effect.succeed([rower, frontSquat]) })

    await screen.findByTestId(`exercise-row-${rower.id}`)
    expect(screen.getByTestId(`exercise-name-${rower.id}`).textContent).toBe('Rower')
    expect(screen.getByTestId(`exercise-row-${frontSquat.id}`)).toBeTruthy()
    expect(screen.getByTestId(`exercise-name-${frontSquat.id}`).textContent).toBe(
      'Barbell front squat',
    )
    // Tag badges use domain label maps, not raw vocabulary literals.
    expect(screen.getByTestId(`exercise-row-${rower.id}`).textContent).toContain('Rower')
    expect(screen.getByTestId(`exercise-row-${rower.id}`).textContent).toContain('Full body')
    expect(screen.getByTestId(`exercise-row-${rower.id}`).textContent).toContain('Cardio')
    expect(screen.getByTestId(`exercise-row-${rower.id}`).textContent).toContain('High')
    expect(screen.getByTestId(`exercise-row-${rower.id}`).textContent).not.toContain('full-body')
    expect(screen.getByTestId(`exercise-row-${frontSquat.id}`).textContent).toContain('Strength')
    expect(screen.getByTestId(`exercise-row-${frontSquat.id}`).textContent).toContain('Moderate')
    expect(screen.getByTestId(`exercise-row-${frontSquat.id}`).textContent).toContain('Quads')
    expect(screen.getByTestId(`exercise-row-${frontSquat.id}`).textContent).toContain('Barbell')
  })

  it('renders library-nav-link to /library and LibrarySegments with Exercises active', async () => {
    renderScreen({ ListExercises: () => Effect.succeed([rower]) })

    await screen.findByTestId('exercise-library-screen')
    expect(screen.getByTestId('library-nav-link').getAttribute('href')).toBe('/library')
    expect(screen.getByTestId('library-segments')).toBeTruthy()
    expect(screen.getByTestId('library-segment-workouts').getAttribute('href')).toBe('/library')
    expect(screen.getByTestId('library-segment-exercises').getAttribute('href')).toBe(
      '/library/exercises',
    )
    expect(screen.getByTestId('library-segment-exercises').dataset.active).toBe('true')
    expect(screen.getByTestId('library-segment-workouts').dataset.active).toBe('false')
  })

  it('filter chips render domain labels while testids stay keyed to raw literals', async () => {
    renderScreen({ ListExercises: () => Effect.succeed([rower, frontSquat]) })

    await screen.findByTestId('filter-bar')

    // Testids stay on raw vocabulary values for stable selectors.
    const fullBodyChip = screen.getByTestId('filter-muscle-full-body')
    expect(fullBodyChip.textContent).toBe('Full body')
    expect(fullBodyChip.textContent).not.toBe('full-body')

    expect(screen.getByTestId('filter-modality-cardio').textContent).toBe('Cardio')
    expect(screen.getByTestId('filter-modality-strength').textContent).toBe('Strength')
    expect(screen.getByTestId('filter-muscle-quads').textContent).toBe('Quads')
    expect(screen.getByTestId('filter-equipment-rower').textContent).toBe('Rower')
    expect(screen.getByTestId('filter-equipment-barbell').textContent).toBe('Barbell')
  })

  it('empty equipment renders the Bodyweight pseudo-tag label on the row', async () => {
    const pushup = new LibraryExercise({
      id: Schema.decodeSync(ExerciseId)('ex-pushup'),
      exercise: new Exercise({
        name: 'Push-up',
        modality: 'strength',
        muscleGroups: ['chest'],
        equipment: [],
        intensity: 'moderate',
      }),
      createdAt: seededAt,
      updatedAt: seededAt,
    })
    renderScreen({ ListExercises: () => Effect.succeed([pushup]) })

    const row = await screen.findByTestId(`exercise-row-${pushup.id}`)
    expect(row.textContent).toContain('Bodyweight')
    expect(row.textContent).not.toContain('bodyweight')
  })

  it('narrows the list when a muscle-group filter chip is selected (AND across facets)', async () => {
    renderScreen({ ListExercises: () => Effect.succeed([rower, frontSquat]) })

    await screen.findByTestId(`exercise-row-${rower.id}`)

    // `quads` is a facet of the front squat only (testid stays on raw literal).
    fireEvent.click(screen.getByTestId('filter-muscle-quads'))

    expect(screen.getByTestId(`exercise-row-${frontSquat.id}`)).toBeTruthy()
    expect(screen.queryByTestId(`exercise-row-${rower.id}`)).toBeNull()
  })

  it('creates an exercise via the dialog and shows it in the refreshed list', async () => {
    const catalog: LibraryExercise[] = [rower]

    renderScreen({
      ListExercises: () => Effect.succeed([...catalog]),
      CreateExercise: (payload) => {
        const { exercise } = payload as { exercise: Exercise }
        const created = new LibraryExercise({
          id: Schema.decodeSync(ExerciseId)('ex-new'),
          exercise,
          createdAt: seededAt,
          updatedAt: seededAt,
        })
        catalog.push(created)
        return Effect.succeed(created)
      },
    })

    await screen.findByTestId(`exercise-row-${rower.id}`)

    fireEvent.click(screen.getByTestId('create-exercise-button'))
    await screen.findByTestId('exercise-dialog')

    fireEvent.change(screen.getByTestId('exercise-form-name'), {
      target: { value: 'Wall ball' },
    })
    fireEvent.change(screen.getByTestId('exercise-form-modality'), {
      target: { value: 'strength' },
    })
    fireEvent.change(screen.getByTestId('exercise-form-intensity'), {
      target: { value: 'moderate' },
    })
    fireEvent.click(screen.getByTestId('exercise-form-muscle-quads'))
    fireEvent.click(screen.getByTestId('exercise-form-equipment-med-ball'))

    fireEvent.click(screen.getByTestId('exercise-form-submit'))

    await screen.findByTestId('exercise-row-ex-new')
    expect(screen.getByTestId('exercise-name-ex-new').textContent).toBe('Wall ball')
  })
})
