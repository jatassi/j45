import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'

/** One in-flight roll: the glyph on its way out, keyed to restart animations. */
type Roll = { readonly from: string; readonly seq: number }

/**
 * A single character cell of the odometer. When `char` changes, the previous
 * glyph rolls down and out (`.player-digit-out`, an absolutely-stacked
 * overlay) while the new one rolls in from above (`.player-digit-in`) — the
 * decrement direction of a countdown. The overlay unmounts on its own
 * `animationend`; under `prefers-reduced-motion` the CSS hides it outright
 * instead (a suppressed animation never ends).
 */
function RollingChar({ char }: { readonly char: string }): JSX.Element {
  const [roll, setRoll] = useState<Roll | null>(null)
  const prevRef = useRef(char)
  const seqRef = useRef(0)

  useEffect(() => {
    const from = prevRef.current
    if (from === char) return
    prevRef.current = char
    seqRef.current += 1
    setRoll({ from, seq: seqRef.current })
  }, [char])

  return (
    <span className="relative inline-flex justify-center overflow-hidden">
      <span
        key={roll === null ? 'settled' : roll.seq}
        className={roll === null ? 'player-digit-glyph' : 'player-digit-glyph player-digit-in'}
      >
        {char}
      </span>
      {roll !== null && (
        <span
          aria-hidden="true"
          className="player-digit-glyph player-digit-out absolute inset-0 inline-flex justify-center"
          onAnimationEnd={() => setRoll(null)}
        >
          {roll.from}
        </span>
      )}
    </span>
  )
}

/**
 * A display value (e.g. `m:ss`) whose characters roll odometer-style as they
 * change. Cells are keyed by position from the *end* of the string, so the
 * seconds glyphs keep their identity when the value gains or loses a leading
 * character (`10:00` → `9:59`). Render inside an `inline-flex` parent that
 * sets the type styling (size, weight, `tabular-nums`).
 */
export function RollingDigits({ value }: { readonly value: string }): JSX.Element {
  const cells: { readonly char: string; readonly place: number }[] = []
  for (let index = 0; index < value.length; index++) {
    cells.push({ char: value.charAt(index), place: value.length - index })
  }
  return (
    <>
      {cells.map((cell) => (
        <RollingChar key={cell.place} char={cell.char} />
      ))}
    </>
  )
}
