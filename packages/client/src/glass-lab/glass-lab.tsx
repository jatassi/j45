import type { CSSProperties, JSX, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { TabBarSurface, TabItemBody } from '@/components/shell/tab-bar'
import { tabItemClass, TABS, type TabId } from '@/components/shell/tab-defs'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { installBackdrop } from '@/glass/backdrop'
import { GlassCard } from '@/glass/glass-card'
import type { DocRect } from '@/glass/scene'
import { sceneRegistry } from '@/glass/scene'
import type { GlassOptions } from '@/glass/use-liquid-glass'
import { GLASS_DEFAULTS, useLiquidGlass } from '@/glass/use-liquid-glass'
import { useSceneSurface } from '@/glass/use-scene-surface'

import { paintLabBackground } from './background'

/**
 * Everything the lab tunes: the shader/material knobs from `GlassOptions`
 * plus the two CSS-tier knobs (`tint` = card-colour percentage in the surface
 * background, `frost` = opacity of the milky wash).
 */
type LabParams = {
  strength: number
  bevel: number
  curvature: number
  chroma: number
  reflect: number
  blur: number
  saturate: number
  tint: number
  frost: number
}

const LAB_DEFAULTS: LabParams = {
  strength: GLASS_DEFAULTS.strength,
  bevel: GLASS_DEFAULTS.bevel,
  curvature: GLASS_DEFAULTS.curvature,
  chroma: GLASS_DEFAULTS.chroma,
  reflect: GLASS_DEFAULTS.reflect,
  blur: GLASS_DEFAULTS.blur,
  saturate: GLASS_DEFAULTS.saturate,
  tint: 9,
  frost: 0.1,
}

function toGlassOptions(params: LabParams): Partial<GlassOptions> {
  return {
    strength: params.strength,
    bevel: params.bevel,
    curvature: params.curvature,
    chroma: params.chroma,
    reflect: params.reflect,
    blur: params.blur,
    saturate: params.saturate,
  }
}

/** The CSS-tier knobs, applied as the custom properties `glass.css` reads. */
function toSurfaceStyle(params: LabParams): CSSProperties {
  return {
    '--glass-tint': `${params.tint}%`,
    '--glass-frost': `${params.frost}`,
  } as CSSProperties
}

/** Element geometry in document space (CSS px): viewport rect + scroll. */
function readDocRect(el: HTMLElement): DocRect {
  const rect = el.getBoundingClientRect()
  return {
    left: rect.left + window.scrollX,
    top: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height,
  }
}

/**
 * The visible multicolour backdrop and its scene registration in one place:
 * paints `paintLabBackground` into the on-screen canvas, then registers a
 * proxy that `drawImage`s that same canvas into every glass composite — the
 * refraction pipeline sees exactly the pixels the page shows.
 */
function LabBackdrop(): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) {
      return undefined
    }

    const live = { rect: readDocRect(canvas) }
    const repaint = (): void => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(live.rect.width * dpr))
      canvas.height = Math.max(1, Math.round(live.rect.height * dpr))
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        return
      }
      ctx.scale(dpr, dpr)
      paintLabBackground(ctx, live.rect.width, live.rect.height)
    }
    repaint()

    const handle = sceneRegistry.register({
      rect: live.rect,
      z: 0,
      source: canvas,
      paint(ctx) {
        ctx.drawImage(canvas, 0, 0, live.rect.width, live.rect.height)
      },
    })
    // Surfaces mounted before this effect composited without the backdrop —
    // flush them.
    handle.invalidate()

    const sync = (): void => {
      live.rect = readDocRect(canvas)
      repaint()
      handle.update({ rect: live.rect })
    }
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(sync)
      observer.observe(canvas)
    }
    window.addEventListener('resize', sync)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', sync)
      handle.dispose()
    }
  }, [])

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden="true" />
}

function ParamSlider(props: {
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly value: number
  readonly onChange: (value: number) => void
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-xs" aria-label={props.label}>
      <span className="flex items-baseline justify-between">
        <span>{props.label}</span>
        <span className="font-mono text-muted-foreground">{props.value}</span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => {
          props.onChange(Number.parseFloat(event.target.value))
        }}
        className="accent-primary"
      />
    </label>
  )
}

type SliderDef = {
  readonly key: keyof LabParams
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
}

const SLIDERS: readonly SliderDef[] = [
  { key: 'strength', label: 'strength (px)', min: 0, max: 40, step: 1 },
  { key: 'bevel', label: 'bevel (px)', min: 1, max: 80, step: 1 },
  { key: 'curvature', label: 'curvature', min: 0.5, max: 8, step: 0.1 },
  { key: 'chroma', label: 'chroma', min: 0, max: 1, step: 0.01 },
  { key: 'reflect', label: 'reflect', min: 0, max: 1, step: 0.01 },
  { key: 'blur', label: 'blur (px)', min: 0, max: 12, step: 0.5 },
  { key: 'saturate', label: 'saturate', min: 0.5, max: 3, step: 0.05 },
  { key: 'tint', label: 'tint (%)', min: 0, max: 100, step: 1 },
  { key: 'frost', label: 'frost', min: 0, max: 1, step: 0.05 },
]

function ControlPanel(props: {
  readonly params: LabParams
  readonly onChange: (params: LabParams) => void
}): JSX.Element {
  const { params, onChange } = props
  return (
    <div className="fixed top-3 right-3 z-40 flex max-h-[calc(100vh-5rem)] w-56 flex-col gap-2.5 overflow-y-auto rounded-xl border border-border bg-background/95 p-3 shadow-xl">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wide uppercase">Material</p>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-secondary"
          onClick={() => {
            onChange(LAB_DEFAULTS)
          }}
        >
          Reset
        </button>
      </div>
      {SLIDERS.map((slider) => (
        <ParamSlider
          key={slider.key}
          label={slider.label}
          min={slider.min}
          max={slider.max}
          step={slider.step}
          value={params[slider.key]}
          onChange={(value) => {
            onChange({ ...params, [slider.key]: value })
          }}
        />
      ))}
      <pre className="rounded-md bg-secondary/60 p-2 text-[10px] leading-4 whitespace-pre-wrap text-muted-foreground select-all">
        {JSON.stringify(params, null, 1)}
      </pre>
    </div>
  )
}

/** A `rounded-full` glass pill — exercises the corner-radius clamp. */
function GlassPill(props: {
  readonly glass: Partial<GlassOptions>
  readonly style: CSSProperties
  readonly children: ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLiquidGlass(ref, props.glass)
  return (
    <div
      ref={ref}
      style={props.style}
      className="glass-surface rounded-full px-6 py-3 text-sm font-medium"
    >
      {props.children}
    </div>
  )
}

/** An opaque colored card registered as a scene proxy, slid under the glass row. */
function ProxyCard(props: { readonly color: string; readonly className: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useSceneSurface(ref, { color: props.color, radius: 14, z: 1 })
  return (
    <div ref={ref} className={props.className} style={{ backgroundColor: props.color }}>
      <span className="p-2 text-xs font-medium text-white/90">under glass</span>
    </div>
  )
}

/** The real tab bar chrome with router-free tab buttons (active on click). */
function LabTabBar(props: {
  readonly glass: Partial<GlassOptions>
  readonly style: CSSProperties
}): JSX.Element {
  const [active, setActive] = useState<TabId>('home')
  return (
    <TabBarSurface glass={props.glass} style={props.style}>
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => {
            setActive(tab.id)
          }}
          className={tabItemClass(active === tab.id)}
        >
          <TabItemBody tab={tab} active={active === tab.id} />
        </button>
      ))}
    </TabBarSurface>
  )
}

/** The material props every lab surface shares. */
type SurfaceProps = {
  readonly glass: Partial<GlassOptions>
  readonly style: CSSProperties
}

/** One tuned glass card with title/subtitle/body — the lab's repeating unit. */
function LabCard(
  props: SurfaceProps & {
    readonly className: string
    readonly title: string
    readonly subtitle: string
    readonly body: string
  },
): JSX.Element {
  return (
    <GlassCard className={props.className} glass={props.glass} style={props.style}>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm">{props.body}</p>
      </CardContent>
    </GlassCard>
  )
}

function LabHeader(): JSX.Element {
  return (
    <header>
      <h1 className="text-lg font-semibold">Glass lab</h1>
      <p className="max-w-sm text-sm text-white/70">
        Surfaces refract the scene-registered backdrop below. Tune the material on the right; scroll
        to slide colour under the tab bar.
      </p>
    </header>
  )
}

/** The spread of glass surfaces over the colour fields. */
function LabSurfaces({ glass, style }: SurfaceProps): JSX.Element {
  const material = { glass, style }
  return (
    <div className="relative flex flex-col items-start gap-10 p-8 pr-64">
      <LabHeader />

      <div className="relative flex flex-wrap items-start gap-8">
        <ProxyCard
          color="rgb(217, 70, 50)"
          className="absolute -top-6 left-40 z-0 h-28 w-40 rounded-xl"
        />
        <div className="relative z-10">
          <LabCard
            {...material}
            className="w-64 rounded-2xl"
            title="Card"
            subtitle="rounded-2xl"
            body="Body copy sits on the surface, above the refraction."
          />
        </div>
        <LabCard
          {...material}
          className="w-80 rounded-4xl"
          title="Wide card"
          subtitle="rounded-4xl"
          body="Straddles a colour boundary — watch the rim bend it."
        />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <GlassPill glass={glass} style={style}>
          Glass pill
        </GlassPill>
        <GlassPill glass={glass} style={style}>
          Start workout
        </GlassPill>
      </div>

      <LabCard
        {...material}
        className="mt-40 w-72 rounded-2xl"
        title="Mid-page"
        subtitle="over the lower colour fields"
        body="Scroll — fixed chrome recomposites, this card stays put."
      />
    </div>
  )
}

/**
 * `/glass-lab` — the liquid-glass refinement bench: the app tab bar and a
 * spread of glass surfaces over a scene-registered multicolour backdrop, with
 * every material knob on a live slider. Distinct from `/glass`, which is the
 * e2e fixture and must stay stable.
 */
export function GlassLab(): JSX.Element {
  useEffect(() => {
    installBackdrop()
  }, [])

  const [params, setParams] = useState<LabParams>(LAB_DEFAULTS)
  const glass = toGlassOptions(params)
  const style = toSurfaceStyle(params)

  return (
    <div className="relative min-h-[190vh] overflow-x-clip pb-32">
      <LabBackdrop />
      <LabSurfaces glass={glass} style={style} />
      <ControlPanel params={params} onChange={setParams} />
      <LabTabBar glass={glass} style={style} />
    </div>
  )
}

export default GlassLab
