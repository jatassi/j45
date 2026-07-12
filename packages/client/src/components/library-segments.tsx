import { Link, useRouterState } from '@tanstack/react-router'

const segmentClass =
  'rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=true]:shadow-sm'

/**
 * Workouts | Exercises segmented control for the Library tab. Active segment
 * is derived from the current path (`/library` vs `/library/exercises`, plus
 * the legacy `/` and `/exercises` paths until the route restructure lands).
 */
export function LibrarySegments() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const exercisesActive = pathname === '/library/exercises' || pathname === '/exercises'
  const workoutsActive = !exercisesActive

  return (
    <nav
      className="inline-flex items-center gap-1 rounded-lg bg-muted p-[3px]"
      data-testid="library-segments"
    >
      <Link
        to="/library"
        data-testid="library-segment-workouts"
        data-active={workoutsActive ? 'true' : 'false'}
        className={segmentClass}
      >
        Workouts
      </Link>
      <Link
        to="/library/exercises"
        data-testid="library-segment-exercises"
        data-active={exercisesActive ? 'true' : 'false'}
        className={segmentClass}
      >
        Exercises
      </Link>
    </nav>
  )
}
