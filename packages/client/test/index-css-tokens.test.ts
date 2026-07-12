// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

const clientSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')
const indexCssPath = path.join(clientSrc, 'index.css')
const protoCssPath = path.join(clientSrc, 'proto/proto.css')

const stripComments = (css: string): string => css.replaceAll(/\/\*[\s\S]*?\*\//g, '')

/** Body of the first `:root { ... }` block (no nested braces in our file). */
function rootBody(css: string): string {
  const match = /:root\s*\{([^}]*)\}/.exec(css)
  expect(match).not.toBeNull()
  return match?.[1] ?? ''
}

/** Body of the first `@theme inline { ... }` block (may nest — take balanced). */
function themeInlineBody(css: string): string {
  const start = css.search(/@theme\s+inline\s*\{/)
  expect(start).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') {
      depth++
    } else if (css[i] === '}') {
      depth--
      if (depth === 0) {
        return css.slice(open + 1, i)
      }
    }
  }
  throw new Error('unclosed @theme inline block')
}

describe('index.css sport-hue tokens', () => {
  it('defines --hue-* as oklch in :root and exposes each via @theme inline as --color-hue-*', () => {
    const css = stripComments(fs.readFileSync(indexCssPath, 'utf8'))
    const root = rootBody(css)
    const theme = themeInlineBody(css)

    const hues = ['cardio', 'strength', 'hybrid', 'work', 'rest'] as const
    for (const hue of hues) {
      expect(root).toMatch(new RegExp(String.raw`--hue-${hue}:\s*oklch\([^)]+\)\s*;`))
      expect(theme).toMatch(new RegExp(String.raw`--color-hue-${hue}:\s*var\(--hue-${hue}\)\s*;`))
    }
  })
})

describe('index.css primary, card surfaces, background', () => {
  it('retires muted primary for hot-orange oklch, lifts card with a -2 step, pins background', () => {
    const css = stripComments(fs.readFileSync(indexCssPath, 'utf8'))
    const root = rootBody(css)
    const theme = themeInlineBody(css)

    // Signature orange — the former muted primary must be gone.
    expect(root).not.toMatch(/--primary:\s*oklch\(0\.47\s+0\.157\s+37\.304\)/)
    expect(root).toMatch(/--primary:\s*oklch\([^)]+\)\s*;/)

    // Lifted card surface + nested -2 step, both oklch, exposed for Tailwind.
    expect(root).toMatch(/--card:\s*oklch\([^)]+\)\s*;/)
    expect(root).toMatch(/--card-2:\s*oklch\([^)]+\)\s*;/)
    expect(theme).toMatch(/--color-card:\s*var\(--card\)\s*;/)
    expect(theme).toMatch(/--color-card-2:\s*var\(--card-2\)\s*;/)

    // Backdrop invariant — exact hex, single :root.
    expect(root).toMatch(/--background:\s*#08090b\s*;/)
  })
})

describe('index.css type utilities and motion language', () => {
  it('records text-eyebrow / text-display @utility rules and motion tokens', () => {
    const css = stripComments(fs.readFileSync(indexCssPath, 'utf8'))

    // Eyebrow: uppercase, +0.16em tracking, bold (the .proto-eyebrow idiom).
    expect(css).toMatch(/@utility\s+text-eyebrow\s*\{[^}]*text-transform:\s*uppercase/)
    expect(css).toMatch(/@utility\s+text-eyebrow\s*\{[^}]*letter-spacing:\s*0\.16em/)
    expect(css).toMatch(/@utility\s+text-eyebrow\s*\{[^}]*font-weight:\s*700/)

    // Display/timer digits: tabular-nums (the .proto-nums idiom).
    expect(css).toMatch(/@utility\s+text-display\s*\{[^}]*font-variant-numeric:\s*tabular-nums/)

    // Motion language: 150ms state, 250ms enter/exit, ease-out.
    expect(css).toMatch(/150ms/)
    expect(css).toMatch(/250ms/)
    expect(css).toMatch(/ease-out/)
  })
})

describe('proto.css graduated tokens retired', () => {
  it('drops sport-hue and orange custom properties from .proto-scope (surfaces stay)', () => {
    const css = stripComments(fs.readFileSync(protoCssPath, 'utf8'))

    for (const retired of [
      '--proto-orange',
      '--proto-cardio',
      '--proto-strength',
      '--proto-hybrid',
      '--proto-work',
      '--proto-rest',
    ]) {
      expect(css).not.toMatch(new RegExp(String.raw`${retired}\s*:`))
    }

    // Surface stack has not graduated — still local to the prototype.
    expect(css).toMatch(/--proto-ground\s*:/)
    expect(css).toMatch(/--proto-surface\s*:/)
    expect(css).toMatch(/--proto-surface-2\s*:/)
    expect(css).toMatch(/--proto-line\s*:/)
  })
})

describe('Wordmark', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders upright font-black tight-tracked lockup: white J + primary 45, with variant seam', async () => {
    const { Wordmark } = await import('@/components/wordmark')
    render(createElement(Wordmark))

    const mark = screen.getByText((_, el) => el?.textContent === 'J45' && el.tagName === 'SPAN')
    expect(mark.className).toMatch(/font-black/)
    expect(mark.className).toMatch(/tracking-tighter/)
    expect(mark.className).not.toMatch(/italic/)
    expect(mark.className).toMatch(/text-white/)

    const fortyFive = mark.querySelector('span')
    expect(fortyFive?.textContent).toBe('45')
    // Primary orange via the real token utility (not --proto-orange).
    expect(fortyFive?.className).toMatch(/text-primary/)

    // Variant seam accepts 'default' without throwing (room for later variants).
    cleanup()
    render(createElement(Wordmark, { variant: 'default' }))
    expect(
      screen.getByText((_, el) => el?.textContent === 'J45' && el.tagName === 'SPAN'),
    ).toBeTruthy()
  })
})
