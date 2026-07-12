import { Link, useRouterState } from '@tanstack/react-router'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

/**
 * Workouts | Exercises segmented control for the Library tab. Built on
 * `ui/toggle-group`; the active segment is derived from the current path
 * (`/library` vs `/library/exercises`, plus the legacy `/` and `/exercises`
 * paths until the route restructure lands). Each item is a real `Link` so
 * navigation and hrefs stay intact for consumers (e.g. exercise-library).
 */
export function LibrarySegments() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const exercisesActive = pathname === '/library/exercises' || pathname === '/exercises'
  const workoutsActive = !exercisesActive
  const active = exercisesActive ? 'exercises' : 'workouts'

  return (
    <ToggleGroup
      value={[active]}
      data-testid="library-segments"
      className="rounded-lg bg-muted p-[3px]"
      spacing={1}
      size="sm"
    >
      <ToggleGroupItem
        value="workouts"
        nativeButton={false}
        render={
          <Link
            to="/library"
            data-testid="library-segment-workouts"
            data-active={workoutsActive ? 'true' : 'false'}
          />
        }
        className="rounded-md px-2.5 text-muted-foreground data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-sm"
      >
        Workouts
      </ToggleGroupItem>
      <ToggleGroupItem
        value="exercises"
        nativeButton={false}
        render={
          <Link
            to="/library/exercises"
            data-testid="library-segment-exercises"
            data-active={exercisesActive ? 'true' : 'false'}
          />
        }
        className="rounded-md px-2.5 text-muted-foreground data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-sm"
      >
        Exercises
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
