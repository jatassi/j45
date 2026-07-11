/**
 * Throwaway prototype data + design tokens for the `/proto` glass-role
 * comparison. Nothing here is wired to the real app — delete `src/proto/`
 * to remove the whole experiment.
 */

export type Focus = 'cardio' | 'strength' | 'hybrid'

/** Sport-coded semantic hues, evolved from the legacy diet-f45 palette. */
export const FOCUS_HUE: Record<Focus, string> = {
  cardio: '#38bdf8',
  strength: '#a78bfa',
  hybrid: '#fb7185',
}

export const FOCUS_LABEL: Record<Focus, string> = {
  cardio: 'Cardio',
  strength: 'Strength',
  hybrid: 'Hybrid',
}

/** Phase hues for the live-player hero (Variant C). */
export const PHASE_HUE = {
  work: '#22c55e',
  rest: '#f59e0b',
} as const

export type Workout = {
  id: string
  name: string
  focus: Focus
  minutes: number
  /** Short, punchy subtitle. */
  blurb: string
  /** Rough station/round count, for texture. */
  stations: number
}

export const WORKOUTS: readonly Workout[] = [
  {
    id: 'blaze-45',
    name: 'Blaze 45',
    focus: 'cardio',
    minutes: 45,
    blurb: 'Relentless intervals, zero coasting.',
    stations: 9,
  },
  {
    id: 'iron-circuit',
    name: 'Iron Circuit',
    focus: 'strength',
    minutes: 50,
    blurb: 'Heavy compound loops for raw force.',
    stations: 8,
  },
  {
    id: 'hybrid-havoc',
    name: 'Hybrid Havoc',
    focus: 'hybrid',
    minutes: 42,
    blurb: 'Lift, sprint, repeat until smoked.',
    stations: 10,
  },
  {
    id: 'summit-climb',
    name: 'Summit Climb',
    focus: 'cardio',
    minutes: 38,
    blurb: 'Ascending EMOM with a burning finish.',
    stations: 7,
  },
  {
    id: 'anvil',
    name: 'Anvil',
    focus: 'strength',
    minutes: 55,
    blurb: 'Slow tempo, brutal time under tension.',
    stations: 6,
  },
  {
    id: 'riptide',
    name: 'Riptide',
    focus: 'hybrid',
    minutes: 45,
    blurb: 'Wave sets that pull you under.',
    stations: 9,
  },
  {
    id: 'afterburn',
    name: 'Afterburn',
    focus: 'cardio',
    minutes: 30,
    blurb: 'Short, savage, all gas.',
    stations: 8,
  },
  {
    id: 'foundry',
    name: 'Foundry',
    focus: 'strength',
    minutes: 48,
    blurb: 'Forge total-body power in the fire.',
    stations: 7,
  },
]
