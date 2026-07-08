// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { GlassCard } from '@/glass/glass-card'

// No renderer is mocked here: in jsdom the shared WebGL2 renderer is genuinely
// unavailable, so this also exercises the graceful css-tier fallback end to end.
afterEach(() => {
  cleanup()
})

describe('GlassCard', () => {
  it('composes the shadcn Card unchanged with the glass surface and the hook', () => {
    render(<GlassCard data-testid="glass-card">body</GlassCard>)
    const el = screen.getByTestId('glass-card')

    // The shadcn Card is composed unchanged — its data-slot and classes survive.
    expect(el.dataset.slot).toBe('card')
    expect(el.className).toContain('rounded-xl')
    expect(el.textContent).toBe('body')

    // The glass-surface class is added alongside Card's own classes.
    expect(el.classList.contains('glass-surface')).toBe(true)

    // The hook ran against the composed element — proving the ref threaded
    // through Card to its div — and, with no GPU, held the css tier.
    expect(el.dataset.glassTier).toBe('css')
    expect(el.querySelector('canvas')).toBeNull()
  })
})
