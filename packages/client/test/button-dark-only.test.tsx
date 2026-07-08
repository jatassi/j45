// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Button } from '@/components/ui/button'

afterEach(() => {
  cleanup()
})

describe('Button dark-only styling', () => {
  it('applies the former dark-mode classes unconditionally, with no dark: variant left in the rendered class list', () => {
    render(
      <>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
      </>,
    )

    const outline = screen.getByText('Outline')
    const ghost = screen.getByText('Ghost')
    const destructive = screen.getByText('Destructive')

    for (const button of [outline, ghost, destructive]) {
      // No leftover `dark:` variant — it no longer depends on a `.dark`
      // ancestor or the OS colour scheme (prefers-color-scheme).
      expect(button.className).not.toMatch(/(?:^|\s)dark:/)
    }

    // These were previously reachable only via `.dark` / OS dark mode;
    // they must now be unconditionally present in the rendered class list.
    expect(outline.className).toContain('border-input')
    expect(outline.className).toContain('bg-input/30')
    expect(ghost.className).toContain('hover:bg-muted/50')
    expect(destructive.className).toContain('bg-destructive/20')
  })
})
