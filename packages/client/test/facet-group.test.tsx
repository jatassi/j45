// @vitest-environment jsdom
import { equipmentLabel, type Equipment } from '@j45/domain'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FacetGroup } from '@/components/facet-group'

afterEach(() => {
  cleanup()
})

const VALUES: readonly Equipment[] = ['barbell', 'rower']

const noop = () => undefined

/** True when `later` comes after `earlier` in document order. */
function follows(earlier: Element, later: Element) {
  return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

describe('FacetGroup', () => {
  it('renders the bare toggle group when neither slot is supplied', () => {
    const { container } = render(
      <FacetGroup
        values={VALUES}
        selected={['barbell']}
        labels={equipmentLabel}
        testIdPrefix="facet"
        onChange={noop}
      />,
    )

    // No wrapper element. The toggle group is the full control. The six
    // existing call sites thus keep their markup and their layout.
    expect(container.childElementCount).toBe(1)
    const group = container.querySelector('[data-slot="toggle-group"]')
    expect(container.firstElementChild).toBe(group)
    expect(group?.childElementCount).toBe(VALUES.length)
    expect(container.querySelectorAll('[data-slot="button"]').length).toBe(0)
    expect(screen.queryByTestId('facet-summary')).toBeNull()
    expect(screen.getByTestId('facet-barbell').textContent).toBe(equipmentLabel.barbell)
  })

  it('renders the bare toggle group when the bulk-action list is empty', () => {
    const { container } = render(
      <FacetGroup
        values={VALUES}
        selected={[]}
        labels={equipmentLabel}
        testIdPrefix="facet"
        onChange={noop}
        bulkActions={[]}
      />,
    )

    expect(container.childElementCount).toBe(1)
    expect(container.firstElementChild).toBe(container.querySelector('[data-slot="toggle-group"]'))
  })

  it('treats a null summary as not supplied', () => {
    // A caller that shows the line only sometimes writes `summary={on ? x : null}`.
    const { container } = render(
      <FacetGroup
        values={VALUES}
        selected={[]}
        labels={equipmentLabel}
        testIdPrefix="facet"
        onChange={noop}
        summary={null}
      />,
    )

    expect(container.childElementCount).toBe(1)
    expect(container.firstElementChild).toBe(container.querySelector('[data-slot="toggle-group"]'))
    expect(screen.queryByTestId('facet-summary')).toBeNull()
  })

  it('renders each bulk action above the chips and reports a press', () => {
    const all = vi.fn()
    const none = vi.fn()
    render(
      <FacetGroup
        values={VALUES}
        selected={[]}
        labels={equipmentLabel}
        testIdPrefix="facet"
        onChange={noop}
        bulkActions={[
          { label: 'All', testId: 'facet-all', onSelect: all },
          { label: 'None', testId: 'facet-none', onSelect: none },
        ]}
      />,
    )

    const allButton = screen.getByTestId('facet-all')
    const noneButton = screen.getByTestId('facet-none')
    expect(allButton.textContent).toBe('All')
    expect(noneButton.textContent).toBe('None')

    // Actions, not submits: a bulk button inside a form must never send it.
    expect(allButton.getAttribute('type')).toBe('button')

    // The row sits above the chips, and the chips still render.
    const firstChip = screen.getByTestId('facet-barbell')
    expect(follows(allButton, firstChip)).toBe(true)
    expect(follows(allButton, noneButton)).toBe(true)

    fireEvent.click(allButton)
    expect(all).toHaveBeenCalledTimes(1)
    expect(none).not.toHaveBeenCalled()
  })

  it('renders the summary below the chips under a test id derived from the prefix', () => {
    render(
      <FacetGroup
        values={VALUES}
        selected={['barbell']}
        labels={equipmentLabel}
        testIdPrefix="facet"
        onChange={noop}
        summary="1 of 2 selected"
      />,
    )

    const summary = screen.getByTestId('facet-summary')
    expect(summary.textContent).toBe('1 of 2 selected')
    expect(follows(screen.getByTestId('facet-rower'), summary)).toBe(true)
  })

  it('keeps the chips live when both slots are filled', () => {
    const onChange = vi.fn<(next: Equipment[]) => void>()
    render(
      <FacetGroup
        values={VALUES}
        selected={['barbell']}
        labels={equipmentLabel}
        testIdPrefix="facet"
        onChange={onChange}
        bulkActions={[{ label: 'All', testId: 'facet-all', onSelect: noop }]}
        summary="1 of 2 selected"
      />,
    )

    const chip = screen.getByTestId('facet-rower')
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(chip)

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0]?.[0] ?? []
    expect(next.length).toBe(2)
    expect(next).toContain('barbell')
    expect(next).toContain('rower')
  })

  it('marks a selected chip with a check mark and leaves an unselected chip unmarked', () => {
    render(
      <FacetGroup
        values={VALUES}
        selected={['barbell']}
        labels={equipmentLabel}
        testIdPrefix="facet"
        onChange={noop}
      />,
    )

    const on = screen.getByTestId('facet-barbell')
    const off = screen.getByTestId('facet-rower')

    // A user who cannot see the difference in colour reads the state from the
    // mark, so the mark is present only on the selected chip.
    const check = screen.getByTestId('facet-barbell-check')
    expect(on.contains(check)).toBe(true)
    expect(screen.queryByTestId('facet-rower-check')).toBeNull()

    // `aria-pressed` stays the state contract, so the mark is decoration and it
    // stays out of the accessibility tree. It must not change the chip label.
    expect(on.getAttribute('aria-pressed')).toBe('true')
    expect(off.getAttribute('aria-pressed')).toBe('false')
    expect(check.getAttribute('aria-hidden')).toBe('true')
    expect(on.textContent).toBe(equipmentLabel.barbell)
    expect(off.textContent).toBe(equipmentLabel.rower)
  })

  it('keeps the two states the same width, so a press does not move the other chips', () => {
    render(
      <FacetGroup
        values={VALUES}
        selected={['barbell']}
        labels={equipmentLabel}
        testIdPrefix="facet"
        onChange={noop}
      />,
    )

    // The equipment row holds 16 chips and it wraps. If the mark added width,
    // one press would move the other chips. The unselected chip thus keeps an
    // empty box in the place of the mark. Both boxes take the same slot, so the
    // kit gives both chips the same padding.
    const on = screen.getByTestId('facet-barbell')
    const off = screen.getByTestId('facet-rower')
    expect(on.querySelectorAll('[data-icon="inline-start"]')).toHaveLength(1)
    expect(off.querySelectorAll('[data-icon="inline-start"]')).toHaveLength(1)

    // The box on the unselected chip is empty and it is not a mark.
    const spacer = off.querySelector('[data-icon="inline-start"]')
    expect(spacer?.tagName.toLowerCase()).toBe('span')
    expect(spacer?.textContent).toBe('')
    expect(spacer?.getAttribute('aria-hidden')).toBe('true')
  })

  it('gives the two states different treatments', () => {
    render(
      <FacetGroup
        values={VALUES}
        selected={['barbell']}
        labels={equipmentLabel}
        testIdPrefix="facet"
        onChange={noop}
      />,
    )

    // The control owns its own visual contract. This test does not assert a
    // colour token or a class name: the parent spec names both as a bad test,
    // and either would break on a change of tint that a user cannot see. The
    // contract here is narrower, and it is what the report asked for. The two
    // states must not look the same.
    const on = screen.getByTestId('facet-barbell').className
    const off = screen.getByTestId('facet-rower').className
    expect(on).not.toBe(off)
  })

  it('renders nothing for an empty vocabulary, whatever the slots hold', () => {
    const { container } = render(
      <FacetGroup
        values={[]}
        selected={[]}
        labels={equipmentLabel}
        testIdPrefix="facet"
        onChange={noop}
        bulkActions={[{ label: 'All', testId: 'facet-all', onSelect: noop }]}
        summary="none available"
      />,
    )

    expect(container.childElementCount).toBe(0)
  })
})
