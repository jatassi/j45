/**
 * rAF-coalesced work scheduler for glass surfaces.
 *
 * Multiple `schedule` calls for the same key within one animation frame
 * collapse to a single run of the last-scheduled work. Distinct keys each
 * run once per frame. Work scheduled from inside a frame lands in the next
 * frame. When nothing is pending the scheduler holds no open rAF handle.
 *
 * Standalone: the hook-upgrade path funnels geometry / scene-dirt / scroll
 * work through this so each surface composites + uploads at most once per
 * frame. Injectable `raf`/`caf` keep the module unit-testable without a DOM.
 */

export type GlassScheduler = {
  schedule(key: unknown, work: () => void): void
  cancel(key: unknown): void
}

type Raf = (callback: (time: number) => void) => number
type Caf = (handle: number) => void

/** Real browser `requestAnimationFrame`, resolved at call time. */
function browserRaf(cb: (time: number) => void): number {
  return globalThis.requestAnimationFrame(cb)
}

/** Real browser `cancelAnimationFrame`, resolved at call time. */
function browserCaf(handle: number): void {
  globalThis.cancelAnimationFrame(handle)
}

export function createGlassScheduler(
  // Default wrappers look up the browser APIs on each call so constructing
  // the module-level singleton does not require a DOM (unit tests inject fakes).
  raf: Raf = browserRaf,
  caf: Caf = browserCaf,
): GlassScheduler {
  /** Latest work per key, pending for the next frame flush. */
  const pending = new Map<unknown, () => void>()
  /** Non-null while a frame is scheduled with `raf`. */
  let frameId: number | null = null

  const flush = (_time: number): void => {
    frameId = null
    // Snapshot then clear so work that re-schedules lands in a *new* frame.
    const entries = [...pending]
    pending.clear()
    for (const [, work] of entries) {
      work()
    }
  }

  const ensureFrame = (): void => {
    if (frameId !== null) {
      return
    }
    frameId = raf(flush)
  }

  return {
    schedule(key, work) {
      pending.set(key, work)
      ensureFrame()
    },
    cancel(key) {
      pending.delete(key)
      if (pending.size === 0 && frameId !== null) {
        caf(frameId)
        frameId = null
      }
    },
  }
}

/** Shared scheduler used by glass surfaces at runtime. */
export const glassScheduler: GlassScheduler = createGlassScheduler()
