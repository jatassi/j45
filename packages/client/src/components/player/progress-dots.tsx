import { cellState, type CellState, type PodGroup } from '@/lib/session'
import { cn } from '@/lib/utils'

const dotClass: Record<CellState, string> = {
  done: 'size-2 bg-primary/50',
  active: 'player-dot-pulse size-2.5 bg-primary',
  upcoming: 'size-2 bg-input/60',
}

/** One pod's row of progress dots, one per work, keyed by its stable `workIndex`. */
function PodRow({
  group,
  currentWorkIndex,
}: {
  readonly group: PodGroup
  readonly currentWorkIndex: number | undefined
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2"
      data-testid={`session-pod-group-${group.podIndex}`}
    >
      {group.works.map((work) => {
        const state = cellState(work.workIndex, currentWorkIndex)
        return (
          <span
            key={work.workIndex}
            data-testid={`session-progress-cell-${work.workIndex}`}
            data-state={state}
            className={cn('rounded-full', dotClass[state])}
          />
        )
      })}
    </div>
  )
}

/**
 * Every work as a progress dot, grouped by pod — legacy-parity completion
 * strip. Both tiers wrap: pods wrap as whole groups onto extra lines when the
 * strip outgrows a narrow screen, and a single oversized pod wraps within
 * itself rather than clipping at the viewport edge.
 */
export function ProgressDots({
  groups,
  currentWorkIndex,
}: {
  readonly groups: readonly PodGroup[]
  readonly currentWorkIndex: number | undefined
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-x-3.5 gap-y-2"
      data-testid="session-progress"
    >
      {groups.map((group) => (
        <PodRow key={group.podIndex} group={group} currentWorkIndex={currentWorkIndex} />
      ))}
    </div>
  )
}
