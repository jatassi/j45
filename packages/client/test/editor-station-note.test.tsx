// @vitest-environment jsdom
import * as React from 'react'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { PodsSection } from '@/components/editor/pods-section'
import * as Editor from '@/lib/workout-editor-state'

afterEach(cleanup)

type Report = (state: Editor.EditorState) => void

/** The pods section over live state, reporting each committed state to the test. */
function Harness({
  initial,
  report,
}: {
  readonly initial: Editor.EditorState
  readonly report: Report
}) {
  const [state, setState] = React.useState(initial)
  React.useEffect(() => {
    report(state)
  }, [state, report])
  return <PodsSection state={state} setState={setState} errors={[]} />
}

/** Renders the section and returns a reader for the latest state. */
function renderPods(initial = Editor.blankState()) {
  let latest = initial
  const report: Report = (state) => {
    latest = state
  }
  render(<Harness initial={initial} report={report} />)
  return () => latest
}

/** Blank editor whose one station is named, with an optional note already on it. */
const stationState = (patch: Partial<Omit<Editor.EStation, 'id'>>): Editor.EditorState =>
  Editor.setStationField(Editor.blankState(), { podIndex: 0, stationIndex: 0, patch })

describe('station note field', () => {
  it('edits the note of a station and carries it into the draft', () => {
    const latest = renderPods(stationState({ name: 'Rower' }))
    fireEvent.change(screen.getByTestId('station-detail-input'), { target: { value: '10 cal' } })

    expect(screen.getByTestId<HTMLInputElement>('station-detail-input').value).toBe('10 cal')
    expect(Editor.effectiveDraft(latest()).pods[0].stations[0]).toEqual({
      name: 'Rower',
      detail: '10 cal',
    })
  })

  it('drops a blank note from the draft rather than saving an empty string', () => {
    const latest = renderPods(stationState({ name: 'Rower', detail: '10 cal' }))
    fireEvent.change(screen.getByTestId('station-detail-input'), { target: { value: '  ' } })

    expect(Editor.effectiveDraft(latest()).pods[0].stations[0]).toEqual({ name: 'Rower' })
  })

  it('shows the note an existing workout station already carries', () => {
    renderPods(stationState({ name: 'Burpee', detail: 'step back = no-jump' }))

    expect(screen.getByTestId<HTMLInputElement>('station-detail-input').value).toBe(
      'step back = no-jump',
    )
  })
})
