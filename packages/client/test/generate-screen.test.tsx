// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import {
  Equipment,
  Flow,
  GenerationInfeasible,
  LibraryWorkout,
  Pod,
  Round,
  Station,
  Workout,
  WorkoutId,
  type GenerationConstraints,
} from '@j45/domain'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GenerateScreen } from '@/components/generate-screen'
import { LibraryScreen } from '@/components/library-screen'
import { WorkoutDetailScreen } from '@/components/workout-detail-screen'
import { NewWorkoutScreen } from '@/components/workout-editor-screen'
import { takeInitialDraft } from '@/lib/editor-draft'
import { ServerRpcClient } from '@/lib/rpc-client'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  // Drain any leftover one-shot handoff so tests stay isolated.
  takeInitialDraft()
})

type Handlers = Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>>

/** Fake rpc runtime — the same idiom `workout-editor-screen.test.tsx` uses. */
function makeFakeRuntime(handlers: Handlers) {
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

/** Athletica: 3 pods × 3 stations, uniform laps 40″/20″ × 3 — domain golden 27 works · 26:45. */
const athleticaWorkout = new Workout({
  name: 'Iron Falcon',
  focus: 'hybrid',
  pods: [
    new Pod({
      name: 'Pod 1',
      stations: [
        new Station({ name: 'Rower' }),
        new Station({ name: 'Squat press' }),
        new Station({ name: 'Burpee' }),
      ],
    }),
    new Pod({
      name: 'Pod 2',
      stations: [
        new Station({ name: 'Bike' }),
        new Station({ name: 'Swing' }),
        new Station({ name: 'Climbers' }),
      ],
    }),
    new Pod({
      name: 'Pod 3',
      stations: [
        new Station({ name: 'Snatch' }),
        new Station({ name: 'Step-ups' }),
        new Station({ name: 'Slam ball' }),
      ],
    }),
  ],
  flow: new Flow({
    type: 'laps',
    rounds: [
      new Round({ workSeconds: 40, restSeconds: 20 }),
      new Round({ workSeconds: 40, restSeconds: 20 }),
      new Round({ workSeconds: 40, restSeconds: 20 }),
    ],
  }),
})

const libraryWorkoutOf = (id: string, workout: Workout) =>
  new LibraryWorkout({
    id: Schema.decodeSync(WorkoutId)(id),
    workout,
    createdAt: seededAt,
    updatedAt: seededAt,
  })

/** Full route tree covering library home, generate, new editor, and detail. */
function renderApp(handlers: Handlers, initialPath: string) {
  const fakeRuntime = makeFakeRuntime(handlers)
  const rootRoute = createRootRoute({ component: Outlet })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: LibraryScreen,
  })
  const generateRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/generate',
    component: GenerateScreen,
  })
  const newRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workouts/new',
    component: NewWorkoutScreen,
  })
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workouts/$workoutId',
    component: WorkoutDetailScreen,
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, generateRoute, newRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  render(
    <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
      <RouterProvider router={testRouter} />
    </RegistryProvider>,
  )
}

const pressed = (testId: string): string | null =>
  screen.getByTestId(testId).getAttribute('aria-pressed')

const fieldValue = (testId: string): string => {
  const el = screen.getByTestId(testId)
  return el instanceof HTMLInputElement ? el.value : ''
}

const isDisabled = (testId: string): boolean => {
  const el = screen.getByTestId(testId)
  return el instanceof HTMLButtonElement && el.disabled
}

describe('GenerateScreen', () => {
  it('renders at /generate with library-nav-link pointing to /library', async () => {
    renderApp(
      {
        ListWorkouts: () => Effect.succeed([]),
      },
      '/generate',
    )

    await screen.findByTestId('generate-screen')
    expect(screen.getByTestId('library-nav-link').getAttribute('href')).toBe('/library')
  })

  it('contains no native <select> and no bare <input> outside ui/ components', async () => {
    renderApp({}, '/generate')
    const root = await screen.findByTestId('generate-screen')

    expect(root.querySelector('select')).toBeNull()

    // Steppers use ui/Input (`data-slot=input`). base-ui Select injects an
    // aria-hidden form input from the kit control — not a bare authored field.
    for (const input of root.querySelectorAll('input')) {
      const fromUiInput = input.dataset.slot === 'input'
      const fromUiSelect = input.getAttribute('aria-hidden') === 'true'
      expect(fromUiInput || fromUiSelect).toBe(true)
    }
  })

  it('renders a preview with codename, works·duration chip matching compile, and data-seed; Regenerate changes seed while constraints stay put', async () => {
    const seeds: number[] = []
    let call = 0
    renderApp(
      {
        GenerateWorkout: (payload) => {
          const constraints = payload as GenerationConstraints
          seeds.push(constraints.seed)
          call++
          // Second call returns a different codename so the preview visibly updates.
          const name = call === 1 ? 'Iron Falcon' : 'Silent Titan'
          return Effect.succeed(
            new Workout({
              name,
              focus: athleticaWorkout.focus,
              pods: athleticaWorkout.pods,
              flow: athleticaWorkout.flow,
            }),
          )
        },
      },
      '/generate',
    )

    await screen.findByTestId('generate-screen')

    // Capture form constraints before Generate/Regenerate.
    const focusBefore = pressed('generate-focus-hybrid')
    const minutesBefore = fieldValue('generate-target-minutes')
    const noRepeatBefore = fieldValue('generate-no-repeat')
    expect(focusBefore).toBe('true')

    fireEvent.click(screen.getByTestId('generate-button'))

    const preview = await screen.findByTestId('generate-preview')
    expect(screen.getByTestId('generate-codename').textContent).toBe('Iron Falcon')
    expect(screen.getByTestId('generate-summary').textContent).toBe('27 works · 26:45')
    const firstSeed = preview.dataset.seed
    expect(firstSeed).not.toBeUndefined()
    expect(Number(firstSeed)).toBe(seeds[0])

    fireEvent.click(screen.getByTestId('generate-regenerate'))

    await waitFor(() => {
      expect(screen.getByTestId('generate-preview').dataset.seed).not.toBe(firstSeed)
    })
    expect(screen.getByTestId('generate-codename').textContent).toBe('Silent Titan')
    expect(seeds).toHaveLength(2)
    expect(seeds[0]).not.toBe(seeds[1])

    // Constraint fields untouched by Regenerate.
    expect(pressed('generate-focus-hybrid')).toBe(focusBefore)
    expect(fieldValue('generate-target-minutes')).toBe(minutesBefore)
    expect(fieldValue('generate-no-repeat')).toBe(noRepeatBefore)
  })

  it('Save issues CreateWorkout with the previewed workout and navigates to its detail; Edit sets the initial draft and navigates to /workouts/new', async () => {
    let created: Workout | undefined
    renderApp(
      {
        GenerateWorkout: () => Effect.succeed(athleticaWorkout),
        CreateWorkout: (payload) => {
          created = (payload as { workout: Workout }).workout
          return Effect.succeed(libraryWorkoutOf('workout-gen-1', created))
        },
        GetWorkout: () =>
          Effect.succeed(libraryWorkoutOf('workout-gen-1', created ?? athleticaWorkout)),
        ListWorkouts: () =>
          Effect.succeed(created === undefined ? [] : [libraryWorkoutOf('workout-gen-1', created)]),
      },
      '/generate',
    )

    await screen.findByTestId('generate-screen')
    fireEvent.click(screen.getByTestId('generate-button'))
    await screen.findByTestId('generate-preview')

    fireEvent.click(screen.getByTestId('generate-save'))
    await screen.findByTestId('workout-detail-screen')
    expect(created).toBeDefined()
    expect(created?.name).toBe('Iron Falcon')
    expect(screen.getByTestId('workout-title').textContent).toBe('Iron Falcon')

    // Re-mount generate → Edit handoff into the new-workout editor.
    cleanup()
    takeInitialDraft()

    renderApp(
      {
        GenerateWorkout: () => Effect.succeed(athleticaWorkout),
        ListWorkouts: () => Effect.succeed([]),
      },
      '/generate',
    )
    await screen.findByTestId('generate-screen')
    fireEvent.click(screen.getByTestId('generate-button'))
    await screen.findByTestId('generate-preview')

    fireEvent.click(screen.getByTestId('generate-edit'))
    await screen.findByTestId('workout-editor-screen')
    expect(screen.getByTestId<HTMLInputElement>('editor-name').value).toBe('Iron Falcon')
    expect(screen.getByTestId('editor-summary').textContent).toBe('27 works · 26:45')
    // Slot was consumed on mount (one-shot).
    expect(takeInitialDraft()).toBeUndefined()
  })

  it('GenerationInfeasible renders its reason in an inline alert and never blanks a prior preview', async () => {
    let call = 0
    renderApp(
      {
        GenerateWorkout: () => {
          call++
          if (call === 1) {
            return Effect.succeed(athleticaWorkout)
          }
          return Effect.fail(
            new GenerationInfeasible({ reason: 'No template fits the target duration' }),
          )
        },
      },
      '/generate',
    )

    await screen.findByTestId('generate-screen')
    fireEvent.click(screen.getByTestId('generate-button'))
    await screen.findByTestId('generate-preview')
    expect(screen.getByTestId('generate-codename').textContent).toBe('Iron Falcon')

    fireEvent.click(screen.getByTestId('generate-regenerate'))

    const error = await screen.findByTestId('generate-error')
    expect(error.getAttribute('role')).toBe('alert')
    expect(error.textContent).toContain('No template fits the target duration')
    // Prior preview stays put — never blanked.
    expect(screen.getByTestId('generate-preview')).toBeTruthy()
    expect(screen.getByTestId('generate-codename').textContent).toBe('Iron Falcon')
    // Form stays editable while the alert is showing.
    expect(isDisabled('generate-focus-cardio')).toBe(false)
    fireEvent.click(screen.getByTestId('generate-focus-cardio'))
    expect(pressed('generate-focus-cardio')).toBe('true')
  })

  it('equipment chips default to all literals selected; duration stepper is 15–45×5; no-repeat defaults to 3 and allows 0', async () => {
    renderApp({}, '/generate')
    await screen.findByTestId('generate-screen')

    for (const eq of Equipment.literals) {
      const chip = screen.getByTestId(`generate-equipment-${eq}`)
      expect(chip.getAttribute('aria-pressed')).toBe('true')
    }

    expect(fieldValue('generate-target-minutes')).toBe('30')
    fireEvent.click(screen.getByTestId('generate-target-minutes-dec'))
    expect(fieldValue('generate-target-minutes')).toBe('25')
    // Floor at 15.
    for (let i = 0; i < 10; i++) {
      fireEvent.click(screen.getByTestId('generate-target-minutes-dec'))
    }
    expect(fieldValue('generate-target-minutes')).toBe('15')
    expect(isDisabled('generate-target-minutes-dec')).toBe(true)
    // Ceiling at 45.
    for (let i = 0; i < 20; i++) {
      fireEvent.click(screen.getByTestId('generate-target-minutes-inc'))
    }
    expect(fieldValue('generate-target-minutes')).toBe('45')
    expect(isDisabled('generate-target-minutes-inc')).toBe(true)

    expect(fieldValue('generate-no-repeat')).toBe('3')

    // Decrement to 0 is allowed.
    fireEvent.click(screen.getByTestId('generate-no-repeat-dec'))
    expect(fieldValue('generate-no-repeat')).toBe('2')
    fireEvent.click(screen.getByTestId('generate-no-repeat-dec'))
    expect(fieldValue('generate-no-repeat')).toBe('1')
    fireEvent.click(screen.getByTestId('generate-no-repeat-dec'))
    expect(fieldValue('generate-no-repeat')).toBe('0')
    // Cannot go below 0.
    fireEvent.click(screen.getByTestId('generate-no-repeat-dec'))
    expect(fieldValue('generate-no-repeat')).toBe('0')
  })

  it('focus, emphasis, and equipment options render domain labels (not raw vocabulary literals)', async () => {
    renderApp({}, '/generate')
    await screen.findByTestId('generate-screen')

    // Focus toggle-group: visible text is the domain label; raw values stay off-screen.
    expect(screen.getByTestId('generate-focus-hybrid').textContent).toBe('Hybrid')
    expect(screen.getByTestId('generate-focus-cardio').textContent).toBe('Cardio')
    expect(screen.getByTestId('generate-focus-strength').textContent).toBe('Strength')
    const focusRoot = screen.getByTestId('generate-focus')
    expect(focusRoot.textContent).not.toMatch(/\bhybrid\b/)
    expect(focusRoot.textContent).not.toMatch(/\bcardio\b/)
    expect(focusRoot.textContent).not.toMatch(/\bstrength\b/)

    // Emphasis select: open the popup and assert option labels.
    fireEvent.click(screen.getByTestId('generate-emphasis'))
    expect(await screen.findByRole('option', { name: 'Core' })).toBeTruthy()
    // Trigger shows the selected "None" domain label, not a raw empty value.
    expect(within(screen.getByTestId('generate-emphasis')).getByText('None')).toBeTruthy()

    // Equipment chips: testids stay raw; chip text is the domain label.
    expect(screen.getByTestId('generate-equipment-med-ball').textContent).toBe('Med ball')
    expect(screen.getByTestId('generate-equipment-jump-rope').textContent).toBe('Jump rope')
    expect(screen.getByTestId('generate-equipment-dumbbell').textContent).toBe('Dumbbells')
    expect(screen.getByTestId('generate-equipment-med-ball').textContent).not.toBe('med-ball')
    expect(screen.getByTestId('generate-equipment-jump-rope').textContent).not.toBe('jump-rope')
  })
})
