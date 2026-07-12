// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ControlDock } from '@/components/player/control-dock'
import { useLiquidGlass } from '@/glass/use-liquid-glass'

vi.mock('@/glass/use-liquid-glass', () => ({ useLiquidGlass: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ControlDock — positioned-wrapper / glass-surface split', () => {
  it('puts positioning on the outer wrapper and glass-surface on the inner element', () => {
    render(
      <ControlDock info={<span data-testid="dock-next">Next · Sit-up</span>}>
        <button data-testid="dock-primary" type="button">
          Pause
        </button>
      </ControlDock>,
    )

    const wrapper = screen.getByTestId('player-control-dock')
    const surface = screen.getByTestId('player-control-dock-surface')

    // Positioning lives on the wrapper, never on the glass element.
    expect(wrapper.className).toContain('absolute')
    expect(wrapper.classList.contains('glass-surface')).toBe(false)

    // The glass surface carries glass-surface and none of the positioning utils.
    expect(surface.classList.contains('glass-surface')).toBe(true)
    expect(surface.className).not.toContain('absolute')
    expect(surface.className).not.toContain('inset-x-0')

    // Both slots render their content.
    expect(screen.getByTestId('dock-next').textContent).toBe('Next · Sit-up')
    expect(screen.getByTestId('dock-primary')).toBeTruthy()
  })
})

describe('ControlDock — maxTier passthrough', () => {
  it('forwards maxTier to useLiquidGlass on the inner surface', () => {
    render(<ControlDock maxTier="css">controls</ControlDock>)
    expect(vi.mocked(useLiquidGlass)).toHaveBeenCalledWith(expect.anything(), { maxTier: 'css' })
  })

  it('forwards refract when requested', () => {
    render(<ControlDock maxTier="refract">controls</ControlDock>)
    expect(vi.mocked(useLiquidGlass)).toHaveBeenCalledWith(expect.anything(), {
      maxTier: 'refract',
    })
  })
})
