import type { JSX, RefObject } from 'react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { installBackdrop } from '@/glass/backdrop'
import { GlassCard } from '@/glass/glass-card'
import type { DocRect, SceneProxyHandle } from '@/glass/scene'
import { sceneRegistry } from '@/glass/scene'
import { useLiquidGlass } from '@/glass/use-liquid-glass'
import { useSceneSurface } from '@/glass/use-scene-surface'

import { PerfScenario } from './glass-demo/perf-scenario'
import { DIGIT_SIZE, TickingDigit } from './glass-demo/ticking-digit'

const TICK_MS = 250
const PRIMARY_TEST_ID = 'glass-surface-small'

/** Cycle of dominant colors for the movable proxy behind the small surface. */
const PROXY_COLORS = [
  'rgb(220, 40, 40)',
  'rgb(40, 180, 80)',
  'rgb(40, 100, 220)',
  'rgb(220, 160, 20)',
] as const

/** Document-space origin of the ticking digit (under the fixed bar only). */
const DIGIT_RECT: DocRect = {
  left: 24,
  top: 8,
  width: DIGIT_SIZE,
  height: DIGIT_SIZE,
}

/** Document-space rect of an element (viewport rect + scroll). */
function readDocRect(el: HTMLElement): DocRect {
  const rect = el.getBoundingClientRect()
  return {
    left: rect.left + window.scrollX,
    top: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height,
  }
}

/** Mutating counter every 250ms — e2e proof content mutation ≠ re-render. */
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

function readTier(testId: string): string {
  const surface = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  return surface?.dataset.glassTier ?? 'css'
}

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

/** Visible tier indicator mirrored from `data-glass-tier` on `testId`. */
function useTierIndicator(testId: string): string {
  return useSyncExternalStore(
    (onChange) => subscribeToTier(testId, onChange),
    () => readTier(testId),
  )
}

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
 * Surface with `maxTier: 'css'` — never acquires a GPU texture or layer.
 * Still a real `useLiquidGlass` mount (tier/renders attributes, rim tint).
 * Omits the `.glass-surface` class so the pre-existing e2e suite's
 * "every `.glass-surface` reaches refract" loop is not broken; the next
 * e2e task asserts the tier cap via `data-testid` instead.
 */
function CappedSurface(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLiquidGlass(ref, { maxTier: 'css' })
  return (
    <div
      ref={ref}
      className="relative w-64 overflow-hidden rounded-xl border border-border bg-card/55 p-4 shadow-lg backdrop-blur-md"
      data-testid="glass-capped-surface"
    >
      <p className="text-sm font-medium">Capped (maxTier: css)</p>
      <p className="text-xs text-muted-foreground">Never acquires a GPU surface.</p>
    </div>
  )
}

/**
 * Position-fixed glass bar. Positioning on the wrapper; glass surface (and
 * test id) on the inner element — see packages/client/CLAUDE.md gotcha.
 */
function FixedBar(): JSX.Element {
  return (
    <div className="fixed inset-x-0 top-0 z-50">
      <GlassCard
        className="rounded-none border-x-0 border-t-0 px-6 py-3"
        data-testid="glass-fixed-bar"
      >
        <p className="text-sm font-medium">Fixed glass bar</p>
      </GlassCard>
    </div>
  )
}

/** Opaque content card registered as a scene proxy (never a glass surface). */
function SceneProxyCard(props: {
  color: string
  className: string
  label: string
  z?: number
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useSceneSurface(ref, { color: props.color, radius: 12, z: props.z ?? 1 })
  return (
    <div ref={ref} className={props.className} style={{ backgroundColor: props.color }}>
      <span className="text-xs font-medium text-white/90">{props.label}</span>
    </div>
  )
}

type ProxyLive = { colorIndex: number; rect: DocRect }

function proxyColor(index: number): string {
  return PROXY_COLORS[index % PROXY_COLORS.length] ?? PROXY_COLORS[0]
}

function paintProxy(ctx: CanvasRenderingContext2D, live: ProxyLive): void {
  ctx.fillStyle = proxyColor(live.colorIndex)
  ctx.beginPath()
  ctx.roundRect(0, 0, live.rect.width, live.rect.height, 10)
  ctx.fill()
}

/** Register the movable/recolorable proxy behind the small surface. */
function useMovableProxy(hostRef: RefObject<HTMLDivElement | null>): {
  handleRef: RefObject<SceneProxyHandle | null>
  liveRef: RefObject<ProxyLive>
} {
  const handleRef = useRef<SceneProxyHandle | null>(null)
  const liveRef = useRef<ProxyLive>({
    colorIndex: 0,
    rect: { left: 0, top: 0, width: 120, height: 80 },
  })

  useEffect(() => {
    const host = hostRef.current
    const live = liveRef.current
    if (host) {
      live.rect = readDocRect(host)
    }
    const handle = sceneRegistry.register({
      rect: live.rect,
      z: 2,
      paint(ctx) {
        paintProxy(ctx, live)
      },
    })
    handleRef.current = handle
    return () => {
      handle.dispose()
      handleRef.current = null
    }
  }, [hostRef])

  return { handleRef, liveRef }
}

function moveProxyHandle(handle: SceneProxyHandle, live: ProxyLive): void {
  live.rect = {
    ...live.rect,
    left: live.rect.left + 24,
    top: live.rect.top + 16,
  }
  handle.update({
    rect: live.rect,
    paint(ctx) {
      paintProxy(ctx, live)
    },
  })
}

function recolorProxyHandle(handle: SceneProxyHandle, live: ProxyLive): void {
  live.colorIndex = (live.colorIndex + 1) % PROXY_COLORS.length
  handle.update({
    paint(ctx) {
      paintProxy(ctx, live)
    },
  })
  handle.invalidate(live.rect)
}

/** Buttons that move/recolor the registry proxy behind glass-surface-small. */
function MovableProxyControls(props: { hostRef: RefObject<HTMLDivElement | null> }): JSX.Element {
  const { handleRef, liveRef } = useMovableProxy(props.hostRef)
  const [colorIndex, setColorIndex] = useState(0)

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        data-testid="glass-move-proxy"
        onClick={() => {
          const handle = handleRef.current
          if (handle) {
            moveProxyHandle(handle, liveRef.current)
          }
        }}
        className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-secondary-foreground hover:bg-secondary/80"
      >
        Move proxy
      </button>
      <button
        type="button"
        data-testid="glass-proxy-color"
        onClick={() => {
          const handle = handleRef.current
          if (handle) {
            recolorProxyHandle(handle, liveRef.current)
            setColorIndex(liveRef.current.colorIndex)
          }
        }}
        className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-secondary-foreground hover:bg-secondary/80"
      >
        Recolor proxy
      </button>
      <span className="font-mono text-xs text-muted-foreground">color {colorIndex}</span>
    </div>
  )
}

function SurfacesRow(props: {
  tick: number
  movableHostRef: RefObject<HTMLDivElement | null>
}): JSX.Element {
  return (
    <div className="relative flex min-h-48 w-full max-w-3xl flex-wrap items-start justify-center gap-8">
      <SceneProxyCard
        color="rgb(180, 60, 120)"
        className="absolute top-6 left-[calc(50%-14rem)] z-0 h-24 w-36 rounded-xl p-3"
        label="proxy · small"
        z={1}
      />
      <div
        ref={props.movableHostRef}
        className="pointer-events-none absolute top-10 left-[calc(50%-10rem)] z-0 h-20 w-28 rounded-lg opacity-0"
        aria-hidden="true"
      />
      <div className="relative z-10">
        <SmallSurface tick={props.tick} />
      </div>
      <MediumSurface />
      <LargeSurface />
    </div>
  )
}

/**
 * `/glass` — e2e fixture for live refraction: sized surfaces, fixed bar,
 * CSS-capped surface, scene proxies, and a scripted dirty-region perf scenario.
 */
export function GlassDemo(): JSX.Element {
  useEffect(() => {
    installBackdrop()
  }, [])

  const tick = useMutatingTick()
  const tier = useTierIndicator(PRIMARY_TEST_ID)
  const [perfArmed, setPerfArmed] = useState(false)
  const movableHostRef = useRef<HTMLDivElement>(null)

  return (
    <div className="relative flex min-h-[200vh] flex-col items-center gap-10 p-10 pt-24">
      <FixedBar />
      <p className="text-sm text-muted-foreground" data-testid="glass-tier-indicator">
        Tier: <span className="font-mono">{tier}</span>
      </p>
      <MovableProxyControls hostRef={movableHostRef} />
      <PerfScenario armed={perfArmed} onStart={() => setPerfArmed(true)} />
      <SurfacesRow tick={tick} movableHostRef={movableHostRef} />
      <CappedSurface />
      <SceneProxyCard
        color="rgb(50, 140, 200)"
        className="absolute top-2 left-1/2 z-0 h-10 w-48 -translate-x-1/2 rounded-lg p-2"
        label="proxy · bar"
        z={1}
      />
      <TickingDigit armed={perfArmed} rect={DIGIT_RECT} />
      <div className="h-[120vh] w-full max-w-xl rounded-xl border border-dashed border-border/40 p-6">
        <p className="text-sm text-muted-foreground">
          Scroll region — fixed bar re-composites; static surfaces stay put.
        </p>
      </div>
    </div>
  )
}

export default GlassDemo
