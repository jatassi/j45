// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GLASS_DIRTY_UPDATE_MEASURE, PerfScenario } from '@/glass-demo/perf-scenario'

type ObserverCallback = (list: { getEntries: () => PerformanceEntry[] }) => void

let observerCallbacks: ObserverCallback[]

function installFakePerformanceObserver(): void {
  observerCallbacks = []
  vi.stubGlobal(
    'PerformanceObserver',
    class FakePerformanceObserver {
      private readonly cb: ObserverCallback
      constructor(cb: ObserverCallback) {
        this.cb = cb
        observerCallbacks.push(cb)
      }
      observe(): void {
        /* capture only */
      }
      disconnect(): void {
        const idx = observerCallbacks.indexOf(this.cb)
        if (idx !== -1) {
          observerCallbacks.splice(idx, 1)
        }
      }
    },
  )
}

function emitMeasures(entries: readonly { name: string; duration: number }[]): void {
  const list = {
    getEntries: () =>
      entries.map(
        (entry) =>
          ({
            name: entry.name,
            duration: entry.duration,
            entryType: 'measure',
            startTime: 0,
            toJSON: () => entry,
          }) satisfies PerformanceEntry,
      ),
  }
  for (const cb of observerCallbacks) {
    cb(list)
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  installFakePerformanceObserver()
})

describe('PerfScenario', () => {
  it('mounts glass-perf-start and glass-perf-scenario with empty samples', () => {
    const onStart = vi.fn()
    render(<PerfScenario armed={false} onStart={onStart} />)

    expect(screen.getByTestId('glass-perf-start')).toBeTruthy()
    const scenario = screen.getByTestId('glass-perf-scenario')
    expect(scenario.dataset.glassPerfSamples).toBe('')
  })

  it('arms via glass-perf-start click', () => {
    const onStart = vi.fn()
    render(<PerfScenario armed={false} onStart={onStart} />)

    fireEvent.click(screen.getByTestId('glass-perf-start'))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('disables the start button once armed', () => {
    render(<PerfScenario armed onStart={vi.fn()} />)
    const button = screen.getByTestId('glass-perf-start')
    expect(button instanceof HTMLButtonElement && button.disabled).toBe(true)
  })

  it('appends glass-dirty-update measure durations as a comma-separated list', () => {
    render(<PerfScenario armed={false} onStart={vi.fn()} />)
    const scenario = screen.getByTestId('glass-perf-scenario')

    act(() => {
      emitMeasures([
        { name: GLASS_DIRTY_UPDATE_MEASURE, duration: 1.25 },
        { name: 'other-measure', duration: 99 },
      ])
    })
    expect(scenario.dataset.glassPerfSamples).toBe('1.25')

    act(() => {
      emitMeasures([
        { name: GLASS_DIRTY_UPDATE_MEASURE, duration: 2.5 },
        { name: GLASS_DIRTY_UPDATE_MEASURE, duration: 3 },
      ])
    })
    expect(scenario.dataset.glassPerfSamples).toBe('1.25,2.5,3')
  })

  it('ignores measures that are not glass-dirty-update', () => {
    render(<PerfScenario armed={false} onStart={vi.fn()} />)
    const scenario = screen.getByTestId('glass-perf-scenario')

    act(() => {
      emitMeasures([
        { name: 'navigation', duration: 10 },
        { name: 'resource', duration: 20 },
      ])
    })
    expect(scenario.dataset.glassPerfSamples).toBe('')
  })
})
