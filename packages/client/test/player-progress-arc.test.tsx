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

/**
 * How far a round cap reaches past the path's last point, in degrees of this
 * circle. A round cap is a half disc of the stroke's radius, so it covers half
 * a stroke of arc length. The path gives one up at each end so both caps draw
 * whole inside the box, and the caps put that length back — which is why the
 * assertions below add them in before checking the 180°.
 */
function capDegrees(stroke: number): number {
  return ((stroke / 2 / ARC_RADIUS) * 180) / Math.PI
}

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
  it('sweeps 180° anticlockwise on a half-height box, with the gap across the bottom', () => {
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

    // The path stops one cap short of the chord at each end, and the round cap
    // covers the rest. That inset is the whole reason the ends draw round
    // instead of clipped, and it must not move where the ink lands.
    //
    // Three decimals, not six: the path writes its coordinates to three, so a
    // bearing read back off them carries that rounding. The endpoints used to
    // land on whole numbers, which is the only reason six ever held here.
    const cap = capDegrees(Number(shapes()[0].getAttribute('stroke-width')))
    expect(cap).toBeGreaterThan(0)
    expect(arc.from).toBeCloseTo(90 - cap, 3)
    expect(arc.to).toBeCloseTo(270 + cap, 3)

    // 180° of ink, from one end of the chord to the other, leaving a 180° gap
    // whose midpoint is the bottom (180°). The sweep runs anticlockwise, so
    // its bearing falls as it is drawn, and the gap runs on from its far end
    // in that same direction.
    const inkFrom = arc.from + cap
    const inkTo = arc.to - cap
    const inkSwept = (inkFrom - inkTo + 360) % 360
    expect(inkSwept).toBeCloseTo(180, 3)
    expect((inkTo - (360 - inkSwept) / 2 + 360) % 360).toBeCloseTo(180, 3)

    // A half circle is never the long way round. The sweep runs anticlockwise
    // from the right end of the chord. The dash retracts towards the end it
    // starts at, so the countdown empties from the left and what is left
    // gathers on the right.
    expect(arc.largeArc).toBe(0)
    expect(arc.clockwise).toBe(0)
  })

  it('holds both caps inside the box, so neither end is clipped square', () => {
    vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle())

    render(
      <ProgressArc fraction={1} phase="work">
        <span>12:00</span>
      </ProgressArc>,
    )

    const stroke = Number(shapes()[0].getAttribute('stroke-width'))
    const d = screen.getByTestId('player-progress-arc-sweep').getAttribute('d') ?? ''
    const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)

    // The cap is a half disc of the stroke's radius around the path's last
    // point. Its lowest edge is what the svg would clip, and it has to land on
    // the chord — the box's bottom edge — and not past it.
    for (const y of [n[1], n[8]]) {
      expect(y + stroke / 2).toBeCloseTo(BOX_HEIGHT, 2)
    }
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

  it('draws the closing arc and its sheen only when the workout is done', () => {
    vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle())

    render(
      <ProgressArc fraction={0} phase="work">
        <span>0:00</span>
      </ProgressArc>,
    )
    expect(screen.queryByTestId('player-progress-arc-complete')).toBeNull()
    cleanup()

    render(
      <ProgressArc fraction={0} phase="done">
        <span>0:00</span>
      </ProgressArc>,
    )
    // The track, the (empty) sweep, the closing fill and its sheen — all
    // on the one path, so the geometry has a single source.
    const drawn = shapes()
    expect(drawn).toHaveLength(4)
    const sweep = screen.getByTestId('player-progress-arc-sweep').getAttribute('d')
    for (const shape of drawn) {
      expect(shape.getAttribute('d')).toBe(sweep)
      expect(Number(shape.getAttribute('stroke-width'))).toBe(
        Number(screen.getByTestId('player-progress-arc-sweep').getAttribute('stroke-width')),
      )
    }
  })
})

describe('ProgressArc — depleting against the sweep length', () => {
  it('measures the dash against the path it is drawn on, not the whole circle', () => {
    vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle())

    render(
      <ProgressArc fraction={1} phase="work">
        <span>12:00</span>
      </ProgressArc>,
    )
    const stroke = Number(shapes()[0].getAttribute('stroke-width'))
    cleanup()

    // Half the circle, less the cap the path gives up at each end. Measuring
    // against the bare half circle would leave the dash a cap's worth long,
    // and the arc would read full while a sliver was already gone.
    const pathDegrees = 180 - 2 * capDegrees(stroke)
    expect(ARC_SWEEP_LENGTH).toBeCloseTo(2 * Math.PI * ARC_RADIUS * (pathDegrees / 360), 9)
    expect(ARC_SWEEP_LENGTH).toBeLessThan(2 * Math.PI * ARC_RADIUS * 0.5)
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
    expect(h.update).not.toHaveBeenCalled()

    rerender(
      <ProgressArc fraction={0.49} phase="work" dirtyValue="11:59">
        <span>11:59</span>
      </ProgressArc>,
    )

    // `update` is the invalidation: it notifies the union of the rect before
    // the change and the rect after it. A value change of the same size still
    // costs exactly one notification, as it did when the rect was held.
    expect(h.update).toHaveBeenCalledTimes(1)
  })

  it('re-measures the digits when the type scale changes at a bucket boundary', () => {
    // `1:00` is four characters; `59` is two, and takes the larger share of the
    // arc. Both the font and the box therefore jump across that one tick.
    let digits: Box = { left: 140, top: 260, width: 200, height: 90 }
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ): DOMRect {
      return Object.hasOwn((this as HTMLElement).dataset, 'arcDigits')
        ? rect(digits)
        : rect({ left: 40, top: 100, width: BOX_WIDTH, height: BOX_HEIGHT })
    })

    const h = handle()
    let proxy: SceneProxy | null = null
    vi.spyOn(sceneRegistry, 'register').mockImplementation((next) => {
      proxy = next
      return h
    })

    const { rerender } = render(
      <ProgressArc fraction={0.5} phase="work" dirtyValue="1:00">
        <span data-arc-digits="" style={{ fontSize: '90px', fontWeight: 600 }}>
          1:00
        </span>
      </ProgressArc>,
    )

    digits = { left: 100, top: 220, width: 280, height: 140 }
    rerender(
      <ProgressArc fraction={0.49} phase="work" dirtyValue="59">
        <span data-arc-digits="" style={{ fontSize: '140px', fontWeight: 600 }}>
          59
        </span>
      </ProgressArc>,
    )

    // The repaint uses the font the digits render at now, and their new
    // centre — not the mount-time measurement.
    const ctx = recordingContext()
    const registered = proxy as SceneProxy | null
    registered?.paint(ctx)
    expect(ctx.font).toContain('140px')
    expect(ctx.fillText).toHaveBeenCalledWith('59', 100 - 40 + 140, 220 - 100 + 70)

    // The registered rect follows, so the paint origin and the clip do too.
    // It unions the arc box with the digits' own box, which now hangs lower
    // and wider than it did.
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(h.update).toHaveBeenCalledWith({
      rect: { left: 40, top: 100, width: 380 - 40, height: 360 - 100 },
    })
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
