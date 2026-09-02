// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanup, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { MarqueeText } from '@/components/player/marquee-text'

const indexCssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/index.css')

/** jsdom lays nothing out, so geometry is faked: 10px per character. */
const SLOT_WIDTH = 120
const CHAR_WIDTH = 10
/** The travel covers the overrun plus both soft edges. */
const LEAD_FADE = 12
const TAIL_FADE = 14
const EDGES = LEAD_FADE + TAIL_FADE

const original = {
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
  offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => SLOT_WIDTH,
  })
  // The component reads clientWidth only on the slot and offsetWidth only on
  // the track, so one stub each covers both elements.
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.textContent.length * CHAR_WIDTH
    },
  })
})

afterAll(() => {
  for (const [name, descriptor] of Object.entries(original)) {
    if (descriptor === undefined) {
      Reflect.deleteProperty(HTMLElement.prototype, name)
    } else {
      Object.defineProperty(HTMLElement.prototype, name, descriptor)
    }
  }
})

afterEach(cleanup)

/** The inner track — the element that actually carries the transform. */
function track(): HTMLElement {
  const child = screen.getByTestId('marquee').firstElementChild
  expect(child).not.toBeNull()
  return child as HTMLElement
}

/** A name whose 30 characters overrun the 120px slot by 180px. */
const LONG = 'Single-arm dumbbell push press'

describe('MarqueeText — only text that overruns scrolls', () => {
  it('leaves a name that fits unmasked and unanimated', () => {
    render(<MarqueeText data-testid="marquee">Rower</MarqueeText>)

    expect(screen.getByTestId('marquee').classList.contains('player-marquee-scrolls')).toBe(false)
    expect(track().classList.contains('player-marquee-track')).toBe(false)
    expect(screen.getByTestId('marquee').style.getPropertyValue('--marquee-shift')).toBe('')
  })

  it('ignores a sub-pixel overrun as measurement noise', () => {
    // 12 characters -> exactly the slot width, so nothing to recover.
    render(<MarqueeText data-testid="marquee">Box step-ups</MarqueeText>)
    expect(screen.getByTestId('marquee').classList.contains('player-marquee-scrolls')).toBe(false)
  })

  it('scrolls a name that overruns, overshooting so its last glyph clears the tail', () => {
    render(<MarqueeText data-testid="marquee">{LONG}</MarqueeText>)

    const viewport = screen.getByTestId('marquee')
    expect(viewport.classList.contains('player-marquee-scrolls')).toBe(true)
    expect(track().classList.contains('player-marquee-track')).toBe(true)
    expect(viewport.style.getPropertyValue('--marquee-shift')).toBe(`-${180 + EDGES}px`)
  })

  it('keeps one scroll speed by deriving the duration from the distance', () => {
    render(<MarqueeText data-testid="marquee">{LONG}</MarqueeText>)
    // 206px at 30px/s is 6.9s of travel, which is 60% of the cycle.
    const viewport = screen.getByTestId('marquee')
    const duration = Number.parseFloat(viewport.style.getPropertyValue('--marquee-duration'))
    expect(duration).toBeCloseTo((180 + EDGES) / 30 / 0.6, 5)
  })

  it('holds a slight overrun at the floor duration rather than twitching', () => {
    // 13 characters -> a 10px overrun, which would otherwise flick past in 2s.
    render(<MarqueeText data-testid="marquee">Wall balls x2</MarqueeText>)
    const viewport = screen.getByTestId('marquee')
    expect(viewport.style.getPropertyValue('--marquee-shift')).toBe(`-${10 + EDGES}px`)
    expect(viewport.style.getPropertyValue('--marquee-duration')).toBe('3s')
  })

  it('caps a very long name at the ceiling duration', () => {
    render(<MarqueeText data-testid="marquee">{'x'.repeat(60)}</MarqueeText>)
    expect(screen.getByTestId('marquee').style.getPropertyValue('--marquee-duration')).toBe('12s')
  })
})

describe('MarqueeText — the two soft edges', () => {
  it('publishes both fade widths whether or not the text scrolls, since the lead is padding', () => {
    render(<MarqueeText data-testid="marquee">Rower</MarqueeText>)
    const viewport = screen.getByTestId('marquee')
    expect(viewport.classList.contains('player-marquee')).toBe(true)
    expect(viewport.style.getPropertyValue('--marquee-fade')).toBe('12px')
    expect(viewport.style.getPropertyValue('--marquee-tail')).toBe(`${TAIL_FADE}px`)
  })

  it('agrees with the overshoot the CSS tail ramp needs', () => {
    render(<MarqueeText data-testid="marquee">{LONG}</MarqueeText>)
    const viewport = screen.getByTestId('marquee')
    const lead = Number.parseFloat(viewport.style.getPropertyValue('--marquee-fade'))
    const tail = Number.parseFloat(viewport.style.getPropertyValue('--marquee-tail'))
    const shift = Number.parseFloat(viewport.style.getPropertyValue('--marquee-shift'))
    expect(Math.abs(shift) - lead - tail).toBe(180)
  })
})

describe('MarqueeText — a new name restarts from the beginning', () => {
  it('remounts the track so a new string never inherits a scroll position', () => {
    const { rerender } = render(<MarqueeText data-testid="marquee">{LONG}</MarqueeText>)
    const before = track()

    rerender(<MarqueeText data-testid="marquee">Weighted walking lunge, both sides</MarqueeText>)
    const after = track()

    expect(after).not.toBe(before)
    expect(after.textContent).toBe('Weighted walking lunge, both sides')
    // 34 characters -> 340px of text in the same 120px slot.
    expect(screen.getByTestId('marquee').style.getPropertyValue('--marquee-shift')).toBe(
      `-${220 + EDGES}px`,
    )
  })

  it('drops the scroll again when the new name fits', () => {
    const { rerender } = render(<MarqueeText data-testid="marquee">{LONG}</MarqueeText>)
    rerender(<MarqueeText data-testid="marquee">Rower</MarqueeText>)

    expect(screen.getByTestId('marquee').classList.contains('player-marquee-scrolls')).toBe(false)
    expect(track().classList.contains('player-marquee-track')).toBe(false)
  })
})

describe('MarqueeText — layout contract with the row it sits in', () => {
  it('shrinks under flex pressure and clips, the same as the truncate it replaces', () => {
    render(<MarqueeText data-testid="marquee">Rower</MarqueeText>)
    expect(screen.getByTestId('marquee').className).toContain('min-w-0')
    expect(track().className).toContain('whitespace-nowrap')
  })

  it('keeps the caller className alongside its own', () => {
    render(
      <MarqueeText data-testid="marquee" className="ml-3 text-sm">
        Rower
      </MarqueeText>,
    )
    const { className } = screen.getByTestId('marquee')
    expect(className).toContain('ml-3')
    expect(className).toContain('text-sm')
  })
})

describe('index.css marquee — motion, edges and reduced motion', () => {
  const css = fs.readFileSync(indexCssPath, 'utf8')

  it('alternates so the text returns the way it came, never jumping back', () => {
    expect(css).toMatch(
      /\.player-marquee-track\s*\{[^}]*animation:\s*player-marquee-shift var\(--marquee-duration\) ease-in-out infinite alternate;/,
    )
  })

  it('rests at both ends of the leg so the reversal has no corner', () => {
    const frames = /@keyframes player-marquee-shift\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(frames).toContain('20%')
    expect(frames).toContain('80%')
    expect(frames).toContain('translateX(var(--marquee-shift))')
  })

  it('pads only a scrolling label, so a label that fits keeps its full width', () => {
    expect(css).toMatch(/\.player-marquee-scrolls\s*\{[^}]*padding-left:\s*var\(--marquee-fade\);/)
    expect(css).not.toMatch(/\.player-marquee\s*\{[^}]*padding-left:/)
  })

  it('masks both edges only for text that actually scrolls', () => {
    expect(css).toMatch(
      /\.player-marquee-scrolls\s*\{[\s\S]*?\n {2}mask-image:\s*linear-gradient\(\s*to right,\s*transparent 0,\s*black var\(--marquee-fade\),\s*black calc\(100% - var\(--marquee-tail\)\),/,
    )
  })

  it('stops the travel under reduced motion and needs no mask override there', () => {
    const reduced =
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(reduced).toMatch(/\.player-marquee-track\s*\{[^}]*animation:\s*none;/)
    expect(reduced).not.toContain('mask-image')
  })
})
