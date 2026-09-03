// @vitest-environment jsdom
import * as React from 'react'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { PodsSection } from '@/components/editor/pods-section'
import * as Editor from '@/lib/workout-editor-state'

afterEach(cleanup)

/** Renders the pods section over live state and exposes the state to the test. */
function Harness({ onState }: { readonly onState: (state: Editor.EditorState) => void }) {
  const [state, setState] = React.useState(() => Editor.blankState())
  onState(state)
  return <PodsSection state={state} setState={setState} errors={[]} />
}

function renderPods() {
  let latest = Editor.blankState()
  render(<Harness onState={(state) => (latest = state)} />)
  return () => latest
}

describe('station note field', () => {
  it('edits the note of a station and carries it into the draft', () => {
    const state = renderPods()
    fireEvent.change(screen.getByTestId('station-name-input'), { target: { value: 'Rower' } })
    fireEvent.change(screen.getByTestId('station-detail-input'), { target: { value: '10 cal' } })

    expect(screen.getByTestId<HTMLInputElement>('station-detail-input').value).toBe('10 cal')
    expect(Editor.effectiveDraft(state()).pods[0].stations[0]).toEqual({
      name: 'Rower',
      detail: '10 cal',
    })
  })

  it('drops a blank note from the draft rather than saving an empty string', () => {
    const state = renderPods()
    fireEvent.change(screen.getByTestId('station-name-input'), { target: { value: 'Rower' } })
    fireEvent.change(screen.getByTestId('station-detail-input'), { target: { value: '10 cal' } })
    fireEvent.change(screen.getByTestId('station-detail-input'), { target: { value: '  ' } })

    expect(Editor.effectiveDraft(state()).pods[0].stations[0]).toEqual({ name: 'Rower' })
  })

  it('shows the note of an existing workout station', () => {
    let latest = Editor.blankState()
    function Existing() {
      const [state, setState] = React.useState(() =>
        Editor.setStationField(Editor.blankState(), {
          podIndex: 0,
          stationIndex: 0,
          patch: { name: 'Burpee', detail: 'step back = no-jump' },
        }),
      )
      latest = state
      return <PodsSection state={state} setState={setState} errors={[]} />
    }
    render(<Existing />)

    expect(screen.getByTestId<HTMLInputElement>('station-detail-input').value).toBe(
      'step back = no-jump',
    )
    expect(latest.pods[0].stations[0].detail).toBe('step back = no-jump')
  })
})
