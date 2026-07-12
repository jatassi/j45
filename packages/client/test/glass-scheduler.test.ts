import { describe, expect, it, vi } from 'vitest'

import { createGlassScheduler, glassScheduler, type GlassScheduler } from '@/glass/scheduler'

/** Injectable rAF/cAF pair that queues callbacks for a manual `flush()`. */
function createFakeRaf() {
  let nextId = 1
  const callbacks = new Map<number, (time: number) => void>()

  const raf = vi.fn((cb: (time: number) => void): number => {
    const id = nextId++
    callbacks.set(id, cb)
    return id
  })

  const caf = vi.fn((id: number): void => {
    callbacks.delete(id)
  })

  /** Run every currently queued rAF callback (a single "frame"). */
  function flush(time = 0): void {
    const pending = [...callbacks.entries()]
    callbacks.clear()
    for (const [, cb] of pending) {
      cb(time)
    }
  }

  return {
    raf,
    caf,
    flush,
    pendingCount: () => callbacks.size,
  }
}

describe('createGlassScheduler', () => {
  it('coalesces N schedule calls for one key into a single run of the last work', () => {
    const { raf, caf, flush } = createFakeRaf()
    const scheduler = createGlassScheduler(raf, caf)
    const runs: string[] = []

    scheduler.schedule('surface-a', () => {
      runs.push('first')
    })
    scheduler.schedule('surface-a', () => {
      runs.push('second')
    })
    scheduler.schedule('surface-a', () => {
      runs.push('third')
    })

    expect(runs).toEqual([])
    flush()
    expect(runs).toEqual(['third'])
  })

  it('runs distinct keys once each in the same frame', () => {
    const { raf, caf, flush } = createFakeRaf()
    const scheduler = createGlassScheduler(raf, caf)
    const runs: string[] = []

    scheduler.schedule('a', () => {
      runs.push('a')
    })
    scheduler.schedule('b', () => {
      runs.push('b')
    })
    scheduler.schedule('c', () => {
      runs.push('c')
    })

    flush()
    expect(runs).toEqual(['a', 'b', 'c'])
  })

  it('cancel before the frame prevents the run', () => {
    const { raf, caf, flush } = createFakeRaf()
    const scheduler = createGlassScheduler(raf, caf)
    const work = vi.fn()

    scheduler.schedule('surface-a', work)
    scheduler.cancel('surface-a')
    flush()

    expect(work).not.toHaveBeenCalled()
  })

  it('scheduling from inside a work callback lands in the next frame', () => {
    const { raf, caf, flush } = createFakeRaf()
    const scheduler = createGlassScheduler(raf, caf)
    const runs: string[] = []

    scheduler.schedule('outer', () => {
      runs.push('outer')
      scheduler.schedule('inner', () => {
        runs.push('inner')
      })
    })

    flush()
    expect(runs).toEqual(['outer'])

    flush()
    expect(runs).toEqual(['outer', 'inner'])
  })

  it('holds no open rAF when nothing is pending', () => {
    const { raf, caf, flush, pendingCount } = createFakeRaf()
    const scheduler = createGlassScheduler(raf, caf)

    expect(pendingCount()).toBe(0)
    expect(raf).not.toHaveBeenCalled()

    // schedule → one frame requested
    scheduler.schedule('a', () => undefined)
    expect(pendingCount()).toBe(1)
    expect(raf).toHaveBeenCalledTimes(1)

    // more schedules for any key must not stack extra frames
    scheduler.schedule('a', () => undefined)
    scheduler.schedule('b', () => undefined)
    expect(pendingCount()).toBe(1)
    expect(raf).toHaveBeenCalledTimes(1)

    // cancel all pending keys → frame cancelled, nothing held open
    scheduler.cancel('a')
    scheduler.cancel('b')
    expect(caf).toHaveBeenCalledTimes(1)
    expect(pendingCount()).toBe(0)

    // schedule + run to completion with no re-schedule → frame gone
    scheduler.schedule('a', () => undefined)
    expect(pendingCount()).toBe(1)
    flush()
    expect(pendingCount()).toBe(0)

    // idle: further flushes do nothing; no re-request
    const rafCallsAfterIdle = raf.mock.calls.length
    flush()
    expect(pendingCount()).toBe(0)
    expect(raf).toHaveBeenCalledTimes(rafCallsAfterIdle)
  })
})

describe('glassScheduler singleton', () => {
  it('exports a GlassScheduler-shaped singleton', () => {
    const s: GlassScheduler = glassScheduler
    expect(typeof s.schedule).toBe('function')
    expect(typeof s.cancel).toBe('function')
  })
})
