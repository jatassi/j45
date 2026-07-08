import type { JSX } from 'react'
import { useEffect, useState, useSyncExternalStore } from 'react'

import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { installBackdrop } from '@/glass/backdrop'
import { GlassCard } from '@/glass/glass-card'

const TICK_MS = 250
const PRIMARY_TEST_ID = 'glass-surface-small'

/**
 * A counter that mutates every 250ms — the demo's visual + e2e proof that
 * content changes leave a surface's geometry (and therefore its render
 * count) untouched.
 */
function useMutatingTick(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = globalThis.setInterval(() => {
      setTick((current) => current + 1)
    }, TICK_MS)
    return () => {
      globalThis.clearInterval(id)
    }
  }, [])
  return tick
}

/** Current `data-glass-tier` of the surface identified by `testId` (`"css"`
 *  when the surface isn't mounted yet). */
function readTier(testId: string): string {
  const surface = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  return surface?.dataset.glassTier ?? 'css'
}

/** Watches the surface identified by `testId` for `data-glass-tier` changes,
 *  invoking `onChange` (React's re-render trigger) on every mutation. */
function subscribeToTier(testId: string, onChange: () => void): () => void {
  const surface = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  if (!surface) {
    return () => undefined
  }
  const observer = new MutationObserver(onChange)
  observer.observe(surface, { attributes: true, attributeFilter: ['data-glass-tier'] })
  return () => {
    observer.disconnect()
  }
}

/**
 * Mirrors the surface identified by `testId`'s `data-glass-tier` onto
 * visible text — the demo's tier indicator. `useSyncExternalStore` reads the
 * DOM attribute directly rather than caching it in state, so it can never
 * miss a change that lands between render and subscription.
 */
function useTierIndicator(testId: string): string {
  return useSyncExternalStore(
    (onChange) => subscribeToTier(testId, onChange),
    () => readTier(testId),
  )
}

/** Small, `rounded-md` surface — carries the mutating text probe. */
function SmallSurface(props: { tick: number }): JSX.Element {
  return (
    <GlassCard className="w-56 rounded-md" data-testid={PRIMARY_TEST_ID}>
      <CardHeader>
        <CardTitle>Small</CardTitle>
        <CardDescription>rounded-md</CardDescription>
      </CardHeader>
      <CardContent>
        <p
          className="h-5 w-32 overflow-hidden font-mono text-xs whitespace-nowrap"
          data-testid="glass-mutating-text"
        >
          tick {props.tick}
        </p>
      </CardContent>
    </GlassCard>
  )
}

/** Medium, `rounded-2xl` surface. */
function MediumSurface(): JSX.Element {
  return (
    <GlassCard className="w-72 rounded-2xl" data-testid="glass-surface-medium">
      <CardHeader>
        <CardTitle>Medium</CardTitle>
        <CardDescription>rounded-2xl</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm">A static glass surface.</p>
      </CardContent>
    </GlassCard>
  )
}

/** Large, `rounded-4xl` surface. */
function LargeSurface(): JSX.Element {
  return (
    <GlassCard className="w-96 rounded-4xl" data-testid="glass-surface-large">
      <CardHeader>
        <CardTitle>Large</CardTitle>
        <CardDescription>rounded-4xl</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm">Another static glass surface.</p>
      </CardContent>
    </GlassCard>
  )
}

/**
 * `/glass` — installs the document backdrop and mounts three `GlassCard`
 * surfaces of different sizes and corner radii, one of which (`Small`)
 * carries text mutating every 250ms. The visible `Tier:` line mirrors that
 * surface's `data-glass-tier` so the CSS → refract transition is inspectable
 * without devtools.
 */
export function GlassDemo(): JSX.Element {
  useEffect(() => {
    installBackdrop()
  }, [])

  const tick = useMutatingTick()
  const tier = useTierIndicator(PRIMARY_TEST_ID)

  return (
    <div className="flex min-h-svh flex-col items-center gap-10 p-10">
      <p className="text-sm text-muted-foreground" data-testid="glass-tier-indicator">
        Tier: <span className="font-mono">{tier}</span>
      </p>
      <div className="flex flex-wrap items-start justify-center gap-8">
        <SmallSurface tick={tick} />
        <MediumSurface />
        <LargeSurface />
      </div>
    </div>
  )
}

export default GlassDemo
