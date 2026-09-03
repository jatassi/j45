// @vitest-environment jsdom
import {
  Equipment,
  GenerationInfeasible,
  MuscleGroup,
  Workout,
  type GenerationConstraints,
} from '@j45/domain'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { takeInitialDraft } from '@/lib/editor-draft'

import {
  athleticaWorkout,
  fieldValue,
  isDisabled,
  libraryWorkoutOf,
  pressed,
  renderApp,
  renderCapturingPayloads,
} from './generate-harness'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  // Drain any leftover one-shot handoff so tests stay isolated.
  takeInitialDraft()
})

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
    expect(screen.getByTestId('generate-summary').textContent).toBe('27 works · 27:10')
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
    expect(screen.getByTestId('editor-summary').textContent).toBe('27 works · 27:10')
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

  it('shows every equipment chip as plainly selected on arrival, and clears the mark when one goes off', async () => {
    renderApp({}, '/generate')
    await screen.findByTestId('generate-screen')

    // The report says that the all-on default reads as all-off. Every chip
    // thus carries its own mark when the form opens.
    for (const eq of Equipment.literals) {
      expect(pressed(`generate-equipment-${eq}`)).toBe('true')
      expect(screen.queryByTestId(`generate-equipment-${eq}-check`)).not.toBeNull()
    }

    // Off is now the state that the screen marks. The mark goes from the chip
    // that the user pressed, and from no other chip.
    fireEvent.click(screen.getByTestId('generate-equipment-barbell'))
    expect(pressed('generate-equipment-barbell')).toBe('false')
    expect(screen.queryByTestId('generate-equipment-barbell-check')).toBeNull()
    expect(pressed('generate-equipment-rower')).toBe('true')
    expect(screen.queryByTestId('generate-equipment-rower-check')).not.toBeNull()
  })

  it('equipment All and None set the whole kit, and the summary line states each of the three states', async () => {
    renderApp({}, '/generate')
    await screen.findByTestId('generate-screen')

    const summary = () => screen.getByTestId('generate-equipment-summary').textContent
    const total = Equipment.literals.length
    const allPressed = (state: string) =>
      Equipment.literals.every((eq) => pressed(`generate-equipment-${eq}`) === state)

    // Arrival: every chip on, and the line says so in words.
    expect(allPressed('true')).toBe(true)
    expect(summary()).toBe('All kit')

    // None clears the kit. The empty kit is a choice, so the line names it.
    fireEvent.click(screen.getByTestId('generate-equipment-none'))
    expect(allPressed('false')).toBe(true)
    expect(summary()).toBe('Bodyweight only')

    // "I own dumbbells only" is now two taps, and the line counts them.
    fireEvent.click(screen.getByTestId('generate-equipment-dumbbell'))
    expect(pressed('generate-equipment-dumbbell')).toBe('true')
    expect(pressed('generate-equipment-barbell')).toBe('false')
    expect(summary()).toBe(`1 of ${total} selected`)

    // All restores the full kit.
    fireEvent.click(screen.getByTestId('generate-equipment-all'))
    expect(allPressed('true')).toBe(true)
    expect(summary()).toBe('All kit')

    // One chip off is a partial kit, and not the full kit.
    fireEvent.click(screen.getByTestId('generate-equipment-rower'))
    expect(summary()).toBe(`${total - 1} of ${total} selected`)
  })

  it('sends the empty equipment list after None, and the full list after All', async () => {
    const sent = renderCapturingPayloads()
    await screen.findByTestId('generate-screen')

    // None means bodyweight only, and it travels as the empty allowed set.
    fireEvent.click(screen.getByTestId('generate-equipment-none'))
    fireEvent.click(screen.getByTestId('generate-button'))
    await screen.findByTestId('generate-preview')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.equipment).toEqual([])

    // All sends every value. The wire shape stays the same list of literals.
    fireEvent.click(screen.getByTestId('generate-equipment-all'))
    fireEvent.click(screen.getByTestId('generate-regenerate'))
    await waitFor(() => expect(sent).toHaveLength(2))
    expect([...(sent[1]?.equipment ?? [])].toSorted()).toEqual(Equipment.literals.toSorted())
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

    // Emphasis chips: one per muscle group, testids raw, chip text the label.
    for (const group of MuscleGroup.literals) {
      expect(screen.getByTestId(`generate-emphasis-${group}`)).toBeTruthy()
    }
    expect(screen.getByTestId('generate-emphasis-core').textContent).toBe('Core')
    expect(screen.getByTestId('generate-emphasis-hamstrings').textContent).toBe('Hamstrings')
    const emphasisField = screen.getByTestId('generate-emphasis')
    expect(emphasisField.textContent).not.toMatch(/\bcore\b/)
    expect(emphasisField.textContent).not.toMatch(/\bhamstrings\b/)

    // Equipment chips: testids stay raw; chip text is the domain label.
    expect(screen.getByTestId('generate-equipment-med-ball').textContent).toBe('Med ball')
    expect(screen.getByTestId('generate-equipment-jump-rope').textContent).toBe('Jump rope')
    expect(screen.getByTestId('generate-equipment-dumbbell').textContent).toBe('Dumbbells')
    expect(screen.getByTestId('generate-equipment-med-ball').textContent).not.toBe('med-ball')
    expect(screen.getByTestId('generate-equipment-jump-rope').textContent).not.toBe('jump-rope')
  })

  it('Emphasis chips start off; taps add and remove groups, and the payload carries the list', async () => {
    const sent = renderCapturingPayloads()
    await screen.findByTestId('generate-screen')

    // No selected chip is now how the form says "no emphasis".
    for (const group of MuscleGroup.literals) {
      expect(pressed(`generate-emphasis-${group}`)).toBe('false')
      expect(screen.queryByTestId(`generate-emphasis-${group}-check`)).toBeNull()
    }

    // An empty selection is an absence, and it travels as one. The schema
    // cannot hold an empty list, so the key itself goes.
    fireEvent.click(screen.getByTestId('generate-button'))
    await screen.findByTestId('generate-preview')
    expect(sent).toHaveLength(1)
    expect(Object.hasOwn(sent[0] ?? {}, 'emphasis')).toBe(false)

    fireEvent.click(screen.getByTestId('generate-emphasis-glutes'))
    fireEvent.click(screen.getByTestId('generate-emphasis-hamstrings'))
    expect(pressed('generate-emphasis-glutes')).toBe('true')
    expect(screen.queryByTestId('generate-emphasis-glutes-check')).not.toBeNull()
    expect(pressed('generate-emphasis-quads')).toBe('false')

    fireEvent.click(screen.getByTestId('generate-regenerate'))
    await waitFor(() => expect(sent).toHaveLength(2))
    expect([...(sent[1]?.emphasis ?? [])].toSorted()).toEqual(['glutes', 'hamstrings'])

    // A second tap on a selected chip removes that group.
    fireEvent.click(screen.getByTestId('generate-emphasis-glutes'))
    expect(pressed('generate-emphasis-glutes')).toBe('false')
    fireEvent.click(screen.getByTestId('generate-regenerate'))
    await waitFor(() => expect(sent).toHaveLength(3))
    expect(sent[2]?.emphasis).toEqual(['hamstrings'])
  })

  it('a cardio Focus disables the Emphasis chips in place, states why, keeps the selection, and sends no emphasis', async () => {
    const sent = renderCapturingPayloads()
    await screen.findByTestId('generate-screen')

    const summary = () => screen.getByTestId('generate-emphasis-summary').textContent
    const groups = MuscleGroup.literals
    const disabledChips = () => groups.filter((g) => isDisabled(`generate-emphasis-${g}`)).length

    fireEvent.click(screen.getByTestId('generate-emphasis-glutes'))
    fireEvent.click(screen.getByTestId('generate-emphasis-hamstrings'))
    expect(summary()).toBe('2 groups narrow the strength picks')
    const field = screen.getByTestId('generate-emphasis')
    const shapeBefore = field.querySelectorAll('*').length

    fireEvent.click(screen.getByTestId('generate-focus-cardio'))

    // Emphasis narrows the strength picks, and a cardio workout has none. The
    // field stops taking input instead of looking live and doing nothing.
    expect(disabledChips()).toBe(groups.length)
    expect(summary()).toBe('Not used — Emphasis applies to strength picks')

    // The note reuses the summary line rather than adding a second element, so
    // the field holds exactly the elements it held before. That is the
    // structural half of "the form does not reflow"; the pixel half is measured
    // against the live layout in `e2e/generate.spec.ts`, which jsdom cannot do.
    expect(screen.getByTestId('generate-emphasis')).toBe(field)
    expect(field.querySelectorAll('*').length).toBe(shapeBefore)

    // The work of the user survives, no press can change it, and the check
    // marks keep it visible while the line speaks about the focus instead.
    expect(pressed('generate-emphasis-glutes')).toBe('true')
    expect(screen.queryByTestId('generate-emphasis-glutes-check')).not.toBeNull()
    fireEvent.click(screen.getByTestId('generate-emphasis-quads'))
    expect(pressed('generate-emphasis-quads')).toBe('false')

    // A field that does nothing must put nothing on the wire.
    fireEvent.click(screen.getByTestId('generate-button'))
    await screen.findByTestId('generate-preview')
    expect(sent).toHaveLength(1)
    expect(Object.hasOwn(sent[0] ?? {}, 'emphasis')).toBe(false)

    // Back to a focus that draws strength: live again, selection intact.
    fireEvent.click(screen.getByTestId('generate-focus-hybrid'))
    expect(disabledChips()).toBe(0)
    expect(pressed('generate-emphasis-glutes')).toBe('true')
    expect(pressed('generate-emphasis-hamstrings')).toBe('true')
    expect(summary()).toBe('2 groups narrow the strength picks')

    fireEvent.click(screen.getByTestId('generate-regenerate'))
    await waitFor(() => expect(sent).toHaveLength(2))
    expect([...(sent[1]?.emphasis ?? [])].toSorted()).toEqual(['glutes', 'hamstrings'])
  })

  it('the Emphasis summary follows the selection, and its empty state reads unlike an empty kit', async () => {
    renderApp({}, '/generate')
    await screen.findByTestId('generate-screen')

    const emphasis = () => screen.getByTestId('generate-emphasis-summary').textContent
    const equipment = () => screen.getByTestId('generate-equipment-summary').textContent

    expect(emphasis()).toBe('No emphasis — every strength exercise qualifies')

    fireEvent.click(screen.getByTestId('generate-emphasis-glutes'))
    expect(emphasis()).toBe('1 group narrows the strength picks')
    fireEvent.click(screen.getByTestId('generate-emphasis-hamstrings'))
    expect(emphasis()).toBe('2 groups narrow the strength picks')

    // The two empty states mean the opposite of each other. The lines are how
    // the screen tells them apart.
    fireEvent.click(screen.getByTestId('generate-emphasis-glutes'))
    fireEvent.click(screen.getByTestId('generate-emphasis-hamstrings'))
    fireEvent.click(screen.getByTestId('generate-equipment-none'))
    expect(equipment()).toBe('Bodyweight only')
    expect(emphasis()).not.toBe(equipment())
  })
})
