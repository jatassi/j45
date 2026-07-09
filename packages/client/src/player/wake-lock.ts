import { useEffect } from 'react'

/**
 * DOM libs type `navigator.wakeLock` as always present, but older browsers
 * leave the property undefined. Narrow to the runtime-optional shape without
 * using `any`.
 */
type MaybeWakeLockNavigator = {
  readonly wakeLock?: WakeLock
}

type LiveFlag = { current: boolean }

/** Read a live-flag through a function so post-await checks aren't constant-folded. */
function isLive(flag: LiveFlag): boolean {
  return flag.current
}

/** Best-effort release — `release()` can reject if already released. */
function releaseSentinel(sentinel: WakeLockSentinel): void {
  void sentinel.release().catch(() => {
    // Already released (or unsupported) — nothing to surface.
  })
}

/**
 * Request a screen wake lock, swallowing every failure mode the API has:
 * missing `navigator.wakeLock`, `NotAllowedError` when the document is hidden,
 * and any other runtime rejection. Returns the sentinel, or `null` on no-op.
 */
async function requestScreenLock(): Promise<WakeLockSentinel | null> {
  const api = (navigator as MaybeWakeLockNavigator).wakeLock
  if (!api) {
    return null
  }
  try {
    return await api.request('screen')
  } catch {
    return null
  }
}

/**
 * Acquire a screen wake lock and re-acquire when the tab becomes visible again
 * (the browser auto-releases on hide). Returns teardown that releases the lock.
 */
function holdWakeLock(): () => void {
  const live: LiveFlag = { current: true }
  let sentinel: WakeLockSentinel | null = null
  let requesting = false

  const acquire = async (): Promise<void> => {
    // Skip if torn down, already holding, or a request is in flight (visibility
    // re-acquire can race a pending initial request).
    if (!isLive(live) || requesting || sentinel) {
      return
    }
    requesting = true
    const next = await requestScreenLock()
    requesting = false
    if (!next) {
      return
    }
    if (!isLive(live)) {
      releaseSentinel(next)
      return
    }
    sentinel = next
    // Browser may drop the lock on its own (tab hide, system policy); clear so
    // a later visibility re-acquire can run.
    next.addEventListener('release', () => {
      if (sentinel === next) {
        sentinel = null
      }
    })
  }

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      void acquire()
    }
  }

  void acquire()
  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    live.current = false
    document.removeEventListener('visibilitychange', onVisibilityChange)
    if (sentinel) {
      releaseSentinel(sentinel)
      sentinel = null
    }
  }
}

/**
 * Hold a screen wake lock while `active` is true so a mid-workout phone
 * doesn't dim. The browser auto-releases on tab hide (`visibilitychange`);
 * while still active we re-acquire when the document becomes visible again.
 * Missing API / request failures are silent no-ops — this is a progressive
 * enhancement, not a hard dependency of the player.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return undefined
    }
    return holdWakeLock()
  }, [active])
}
