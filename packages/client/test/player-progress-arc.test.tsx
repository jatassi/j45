// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ARC_RADIUS, ARC_SWEEP_LENGTH, ProgressArc } from '@/components/player/progress-arc'
import type { SceneProxy, SceneProxyHandle } from '@/glass/scene'
import { sceneRegistry } from '@/glass/scene'

function handle(): SceneProxyHandle {
  return { update: vi.fn(), invalidate: vi.fn(), dispose: vi.fn() }
}

/** The 300×150 viewBox the arc is drawn on — wide, and half as tall. */
const BOX_WIDTH = 300
const BOX_HEIGHT = 150
/** The circle's centre: the middle of the box's bottom edge, so the chord is that edge. */
const CENTER_X = BOX_WIDTH / 2
const CENTER_Y = BOX_HEIGHT

/** Bearing of a point on the circle, in degrees clockwise from the box's top. */
function bearing(x: number, y: number): number {
  return ((Math.atan2(x - CENTER_X, CENTER_Y - y) * 180) / Math.PI + 360) % 360
}

type Arc = {
  from: number
  to: number
  radius: number
  largeArc: number
  clockwise: number
  onCircle: readonly number[]
}

/** Decode an `M x y A r r 0 large sweep x y` arc command into its geometry. */
function readArc(d: string): Arc {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  expect(n).toHaveLength(9)
  // M x0 y0 · A radius radius x-rotation large-arc clockwise x1 y1
  return {
    from: bearing(n[0], n[1]),
    to: bearing(n[7], n[8]),
    radius: n[2],
    largeArc: n[5],
    clockwise: n[6],
    onCircle: [
      Math.hypot(n[0] - CENTER_X, n[1] - CENTER_Y),
      Math.hypot(n[7] - CENTER_X, n[8] - CENTER_Y),
    ],
  }
}

/** Every shape the arc's svg draws, in document order. */
function shapes(): readonly Element[] {
  const svg = screen.getByTestId('player-progress-arc').querySelector('svg')
  return [...(svg?.children ?? [])]
}

/** Render once and read the arc's dash state; unmounts before returning. */
function dashAt(fraction: number): { dash: number; offset: number; pathLength: number } {
  const { unmount } = render(
    <ProgressArc fraction={fraction} phase="work">
      <span>12:00</span>
    </ProgressArc>,
  )
  const arc = screen.getByTestId('player-progress-arc-sweep')
  const read = (name: string): number => Number(arc.getAttribute(name))
  const state = {
    dash: read('stroke-dasharray'),
    offset: read('stroke-dashoffset'),
    pathLength: read('pathLength'),
  }
  unmount()
  return state
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ProgressArc — the 180° sweep', () => {
  it('sweeps 180° clockwise on a half-height box, with the gap across the bottom', () => {
    vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle())

    render(
      <ProgressArc fraction={1} phase="work">
        <span>12:00</span>
      </ProgressArc>,
    )

    // The box is half as tall as it is wide, which is what makes the half
    // circle a vertical saving: a square box would carry an empty bottom half.
    const svg = screen.getByTestId('player-progress-arc').querySelector('svg')
    expect(svg?.getAttribute('viewBox')).toBe(`0 0 ${BOX_WIDTH} ${BOX_HEIGHT}`)

    const d = screen.getByTestId('player-progress-arc-sweep').getAttribute('d') ?? ''
    const arc = readArc(d)

    // Both ends sit on the circle, at the ends of the chord.
    expect(arc.radius).toBe(ARC_RADIUS)
    for (const distance of arc.onCircle) {
      expect(distance).toBeCloseTo(ARC_RADIUS, 2)
    }

    // 180° of sweep, leaving a 180° gap whose midpoint is the bottom (180°).
    const swept = (arc.to - arc.from + 360) % 360
    expect(swept).toBeCloseTo(180, 6)
    expect((arc.to + (360 - swept) / 2) % 360).toBeCloseTo(180, 6)

    // A half circle is never the long way round, and it keeps the clockwise
    // direction the countdown has always depleted in.
    expect(arc.largeArc).toBe(0)
    expect(arc.clockwise).toBe(1)
  })

  it('meets the box on all three sides with the stroke it scales by', () => {
    vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle())

    render(
      <ProgressArc fraction={1} phase="work">
        <span>12:00</span>
      </ProgressArc>,
    )

    // The stroke stays in viewBox units, so it grows with the arc rather than
    // reading heavy on a small phone and thin on a large one. Half of it lies
    // outside the radius, and that outer edge must land on the box exactly.
    for (const shape of shapes()) {
      const stroke = Number(shape.getAttribute('stroke-width'))
      expect(stroke).toBeGreaterThan(0)
      expect(ARC_RADIUS + stroke / 2).toBeCloseTo(BOX_WIDTH / 2, 6)
    }
  })

  it('draws the track over the sweep only, and puts nothing in the gap', () => {
    vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle())

    render(
      <ProgressArc fraction={0.5} phase="work">
        <span>12:00</span>
      </ProgressArc>,
    )

    const drawn = shapes()
    const sweep = screen.getByTestId('player-progress-arc-sweep').getAttribute('d')

    // Exactly the track and the arc, both on the same 180° path. There is no
    // full circle behind the sweep, and no third shape to put in the gap.
    expect(drawn).toHaveLength(2)
    for (const shape of drawn) {
      expect(shape.tagName.toLowerCase()).toBe('path')
      expect(shape.getAttribute('d')).toBe(sweep)
    }
  })

  it('keeps the round caps on both the arc and its track', () => {
    vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle())

    render(
      <ProgressArc fraction={0.5} phase="work">
        <span>12:00</span>
      </ProgressArc>,
    )

    for (const shape of shapes()) {
      expect(shape.getAttribute('stroke-linecap')).toBe('round')
    }
  })
})

describe('ProgressArc — depleting against the sweep length', () => {
  it('measures the dash against half the circle, not the whole one', () => {
    vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle())

    expect(ARC_SWEEP_LENGTH).toBeCloseTo(2 * Math.PI * ARC_RADIUS * 0.5, 9)
    expect(dashAt(1).pathLength).toBeCloseTo(ARC_SWEEP_LENGTH, 6)
  })

  it('starts at the sweep’s start and retracts its far end as the count falls', () => {
    vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle())

    const full = dashAt(1)
    const half = dashAt(0.5)
    const empty = dashAt(0)

    // One dash the length of the whole sweep, pushed back by the offset — so
    // the painted run is [0, dash − offset]: it always begins where the sweep
    // begins, and only its far end moves.
    for (const state of [full, half, empty]) {
      expect(state.dash).toBeCloseTo(ARC_SWEEP_LENGTH, 6)
    }
    expect(full.offset).toBe(0)
    expect(half.offset).toBeCloseTo(ARC_SWEEP_LENGTH / 2, 6)
    expect(empty.offset).toBeCloseTo(ARC_SWEEP_LENGTH, 6)
  })

  it('clamps a fraction outside 0..1 so the arc never overdraws the sweep', () => {
    vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle())

    expect(dashAt(1.5).offset).toBe(0)
    expect(dashAt(-1).offset).toBeCloseTo(ARC_SWEEP_LENGTH, 6)
  })
})

/** A 2d context that records what was painted, without a canvas behind it. */
function recordingContext(): CanvasRenderingContext2D & { fillText: ReturnType<typeof vi.fn> } {
  return {
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D & { fillText: ReturnType<typeof vi.fn> }
}

type Box = { left: number; top: number; width: number; height: number }

function rect(box: Box): DOMRect {
  return {
    ...box,
    right: box.left + box.width,
    bottom: box.top + box.height,
    x: box.left,
    y: box.top,
    toJSON: () => ({}),
  }
}

/**
 * Lay the arc box out at 300×150 and the digits low and wide inside it, so a
 * paint centred on the box is told apart from one centred on the digits.
 */
function stubLayout(): { center: readonly [number, number] } {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ): DOMRect {
    return Object.hasOwn((this as HTMLElement).dataset, 'arcDigits')
      ? rect({ left: 140, top: 260, width: 200, height: 90 })
      : rect({ left: 40, top: 100, width: BOX_WIDTH, height: BOX_HEIGHT })
  })
  return { center: [140 - 40 + 100, 260 - 100 + 45] }
}

describe('ProgressArc — children on the chord + dirty-region proxy', () => {
  it('renders arbitrary children and registers a dirty-region proxy for the digits', () => {
    const register = vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle())

    render(
      <ProgressArc fraction={0.5} phase="work" dirtyValue="12:00">
        <span data-testid="arc-digits">12:00</span>
      </ProgressArc>,
    )

    expect(screen.getByTestId('arc-digits').textContent).toBe('12:00')
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('invalidates the digit proxy when the displayed value changes', () => {
    const h = handle()
    vi.spyOn(sceneRegistry, 'register').mockReturnValue(h)

    const { rerender } = render(
      <ProgressArc fraction={0.5} phase="work" dirtyValue="12:00">
        <span>12:00</span>
      </ProgressArc>,
    )
    expect(h.invalidate).not.toHaveBeenCalled()

    rerender(
      <ProgressArc fraction={0.49} phase="work" dirtyValue="11:59">
        <span>11:59</span>
      </ProgressArc>,
    )
    expect(h.invalidate).toHaveBeenCalledTimes(1)
  })

  it('paints the refraction at the rendered digits’ own size and place', () => {
    const { center } = stubLayout()
    let proxy: SceneProxy | null = null
    vi.spyOn(sceneRegistry, 'register').mockImplementation((next) => {
      proxy = next
      return handle()
    })

    render(
      <ProgressArc fraction={0.5} phase="work" dirtyValue="12:00">
        <span data-arc-digits="" style={{ fontSize: '90px', fontWeight: 600 }}>
          12:00
        </span>
      </ProgressArc>,
    )

    const ctx = recordingContext()
    const registered = proxy as SceneProxy | null
    expect(registered).not.toBeNull()
    registered?.paint(ctx)

    // The rendered type scale, not a share of the box's height (which would
    // read 180px here), and the digits' own centre, not the box's.
    expect(ctx.font).toContain('90px')
    expect(ctx.font).toContain('600')
    expect(ctx.fillText).toHaveBeenCalledWith('12:00', center[0], center[1])
  })

  it('falls back to the arc box and its centre when no digits are marked', () => {
    stubLayout()
    let proxy: SceneProxy | null = null
    vi.spyOn(sceneRegistry, 'register').mockImplementation((next) => {
      proxy = next
      return handle()
    })

    render(
      <ProgressArc fraction={0.5} phase="work" dirtyValue="12:00">
        <span>12:00</span>
      </ProgressArc>,
    )

    const ctx = recordingContext()
    const registered = proxy as SceneProxy | null
    registered?.paint(ctx)

    // Unmarked, the box is measured — but the paint still lands in its middle,
    // never in a corner.
    expect(ctx.fillText).toHaveBeenCalledWith('12:00', BOX_WIDTH / 2, BOX_HEIGHT / 2)
  })
})
