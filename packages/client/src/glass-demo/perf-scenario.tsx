import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'

/**
 * Measure name the liquid-glass hook emits around each dirt-driven
 * composite+upload (`use-liquid-glass.ts` → `measureDirtyUpdate`).
 */
export const GLASS_DIRTY_UPDATE_MEASURE = 'glass-dirty-update'

export type PerfScenarioProps = {
  /** Invoked when the user arms the scripted scenario. */
  onStart: () => void
  /** Whether the scenario has already been armed (disables the start button). */
  armed: boolean
}

function appendGlassDurations(
  entries: readonly PerformanceEntry[],
  setSamples: (fn: (prev: string) => string) => void,
): void {
  const glass = entries.filter((entry) => entry.name === GLASS_DIRTY_UPDATE_MEASURE)
  if (glass.length === 0) {
    return
  }
  setSamples((prev) => {
    const additions = glass.map((entry) => String(entry.duration))
    return prev === '' ? additions.join(',') : `${prev},${additions.join(',')}`
  })
}

/** Subscribe to measure entries and fold glass-dirty-update durations into state. */
function useGlassDirtySamples(): string {
  const [samples, setSamples] = useState('')

  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') {
      return undefined
    }
    const observer = new PerformanceObserver((list) => {
      appendGlassDurations(list.getEntries(), setSamples)
    })
    try {
      observer.observe({ type: 'measure', buffered: true })
    } catch {
      observer.observe({ entryTypes: ['measure'] })
    }
    return () => {
      observer.disconnect()
    }
  }, [])

  return samples
}

/**
 * Perf harness UI: start control + `data-glass-perf-samples` accumulator for
 * `'glass-dirty-update'` measure durations (ms, comma-separated).
 */
export function PerfScenario(props: PerfScenarioProps): JSX.Element {
  const { onStart, armed } = props
  const samplesElRef = useRef<HTMLDivElement>(null)
  const samples = useGlassDirtySamples()

  useEffect(() => {
    const el = samplesElRef.current
    if (el) {
      el.dataset.glassPerfSamples = samples
    }
  }, [samples])

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        data-testid="glass-perf-start"
        disabled={armed}
        onClick={onStart}
        className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
      >
        {armed ? 'Scenario armed' : 'Start perf scenario'}
      </button>
      <div
        ref={samplesElRef}
        data-testid="glass-perf-scenario"
        data-glass-perf-samples={samples}
        className="font-mono text-xs text-muted-foreground"
      >
        samples: {samples === '' ? '(none)' : samples}
      </div>
    </div>
  )
}
