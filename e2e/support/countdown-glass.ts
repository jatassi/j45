/// <reference lib="dom" />
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * The measurement ticket jatassi/j45#54 turns on: no glass surface overlaps
 * the countdown.
 *
 * Two shortcuts in `progress-arc.tsx` depend on it. The digits' scene proxy
 * repaints them flat white, which is not their colour when a critical count is
 * red. The proxy also measures their size and their place once, when it
 * registers, and the type scale has changed size mid-Session since #53. Both
 * are correct only while nothing refracts over the digits. A proxy that never
 * repaints cannot show the wrong colour, and it cannot show a stale size.
 *
 * Both player screens hold a copy of this check, for two separate reasons.
 *
 * The live Session is where the defect would be seen. Its control dock takes
 * the refract tier, so the composited slice becomes the visible refraction.
 * The manual timer caps its dock at the CSS tier, which composites the slice
 * for the rim tint only and shows none of it.
 *
 * Neither screen bounds the other, so one check cannot stand for both. They
 * take their arc widths from different ceilings — 350px here, 420px there —
 * and they put different content below the arc. On a small phone the manual
 * timer has the smaller clearance, by about 8px. On a 430px phone the two are
 * within 2px of each other. Do not read either screen's number off the other.
 *
 * The region measured is the region the proxy registers. `readDigitsRegion`
 * takes the union of the digits' container and the countdown's own box,
 * because the countdown hangs below the container on a negative margin.
 *
 * This derives that union again rather than importing it. Playwright
 * serialises page functions with `toString()`, so the source helper is out of
 * reach here. A check that shared the source's arithmetic would also pass
 * while both were wrong.
 *
 * A failure here does not mean the layout broke. It means the arc has grown
 * into the dock, and that both shortcuts must now be paid for. Repair them in
 * three steps. Make `paintDigits` read the digit colour the component already
 * sets. Make `useDigitProxy` measure again whenever the character count
 * changes. Then invalidate the union of the old rect and the new one, so that
 * a smaller countdown clears the region the larger one left.
 */
export async function expectNoGlassOverlapsTheCountdown(page: Page): Promise<void> {
  const measured = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(
      '[data-testid="player-progress-arc-digits"]',
    )
    if (container === null) {
      throw new Error('the countdown container did not lay out')
    }
    const digits = container.querySelector<HTMLElement>('[data-arc-digits]') ?? container
    const host = container.getBoundingClientRect()
    const own = digits.getBoundingClientRect()
    const region = {
      left: Math.min(host.left, own.left),
      top: Math.min(host.top, own.top),
      right: Math.max(host.right, own.right),
      bottom: Math.max(host.bottom, own.bottom),
    }
    const surfaces = [...document.querySelectorAll<HTMLElement>('.glass-surface')].map(
      (element) => {
        const box = element.getBoundingClientRect()
        const width = Math.min(region.right, box.right) - Math.max(region.left, box.left)
        const height = Math.min(region.bottom, box.bottom) - Math.max(region.top, box.top)
        return {
          surface: element.dataset.testid ?? 'unnamed glass surface',
          overlapArea: width > 0 && height > 0 ? Math.round(width * height) : 0,
        }
      },
    )
    return { surfaceCount: surfaces.length, overlapping: surfaces.filter((s) => s.overlapArea > 0) }
  })

  // An empty page has no overlaps either. The dock is a glass surface and it is
  // always on screen while the player runs, so a count of zero means the check
  // measured nothing and must not pass.
  expect(measured.surfaceCount).toBeGreaterThan(0)
  expect(measured.overlapping).toEqual([])
}
