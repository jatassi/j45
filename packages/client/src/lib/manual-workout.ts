import { Flow, Pod, Round, Station, Workout } from '@j45/domain'

/**
 * Build a schema-valid synthetic `Workout` for the manual timer from work /
 * rest / rounds. A single pod with a single station and `flow.type: 'sets'`
 * of `rounds` identical `Round`s — hand the result to domain `compile`.
 */
export function buildManualWorkout(
  workSeconds: number,
  restSeconds: number,
  rounds: number,
): Workout {
  const first = new Round({ workSeconds, restSeconds })
  const rest = Array.from({ length: rounds - 1 }, () => new Round({ workSeconds, restSeconds }))
  return new Workout({
    name: 'Manual timer',
    focus: 'hybrid',
    pods: [new Pod({ name: 'Timer', stations: [new Station({ name: 'Work' })] })],
    flow: new Flow({
      type: 'sets',
      rounds: [first, ...rest],
    }),
  })
}
