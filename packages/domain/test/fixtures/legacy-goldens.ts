// Golden segment sequences for the four legacy fixtures in `legacy.ts`,
// hand-derived from the legacy `buildSegments` algorithm
// (`~/Git/diet-f45/server.js:132-154`) — independent of this package's
// compiler. `workSeconds` isn't stored here — it's read from the matching
// fixture's own `flow.rounds[round - 1]` at assertion time. What this golden
// asserts is the *ordering* (pod/station/round placement) that the legacy
// algorithm's quirks produce.
export type ExpectedWork = {
  readonly kind: 'work'
  readonly podIndex: number
  readonly stationInPod: number
  readonly round: number
}
export type ExpectedRest = { readonly kind: 'rest'; readonly restSeconds: number }
export type ExpectedSegment = ExpectedWork | ExpectedRest

const w = (podIndex: number, stationInPod: number, round: number): ExpectedWork => ({
  kind: 'work',
  podIndex,
  stationInPod,
  round,
})
const r = (restSeconds: number): ExpectedRest => ({ kind: 'rest', restSeconds })

// prettier-ignore
export const athleticaExpected: readonly ExpectedSegment[] = [
  w(0, 1, 1), r(20), w(0, 2, 1), r(20), w(0, 3, 1), r(20),
  w(0, 1, 2), r(20), w(0, 2, 2), r(20), w(0, 3, 2), r(20),
  w(0, 1, 3), r(20), w(0, 2, 3), r(20), w(0, 3, 3), r(20),
  w(1, 1, 1), r(20), w(1, 2, 1), r(20), w(1, 3, 1), r(20),
  w(1, 1, 2), r(20), w(1, 2, 2), r(20), w(1, 3, 2), r(20),
  w(1, 1, 3), r(20), w(1, 2, 3), r(20), w(1, 3, 3), r(20),
  w(2, 1, 1), r(20), w(2, 2, 1), r(20), w(2, 3, 1), r(20),
  w(2, 1, 2), r(20), w(2, 2, 2), r(20), w(2, 3, 2), r(20),
  w(2, 1, 3), r(20), w(2, 2, 3), r(20), w(2, 3, 3),
]

// prettier-ignore
export const docklandsExpected: readonly ExpectedSegment[] = [
  w(0, 1, 1), r(30), w(0, 2, 1), r(30), w(0, 3, 1), r(30),
  w(0, 1, 2), r(15), w(0, 2, 2), r(15), w(0, 3, 2), r(15),
  w(0, 1, 3), r(10), w(0, 2, 3), r(10), w(0, 3, 3), r(10),
  w(0, 1, 4), r(5), w(0, 2, 4), r(5), w(0, 3, 4), r(5),
  w(1, 1, 1), r(30), w(1, 2, 1), r(30), w(1, 3, 1), r(30),
  w(1, 1, 2), r(15), w(1, 2, 2), r(15), w(1, 3, 2), r(15),
  w(1, 1, 3), r(10), w(1, 2, 3), r(10), w(1, 3, 3), r(10),
  w(1, 1, 4), r(5), w(1, 2, 4), r(5), w(1, 3, 4), r(5),
  w(2, 1, 1), r(30), w(2, 2, 1), r(30), w(2, 3, 1), r(30),
  w(2, 1, 2), r(15), w(2, 2, 2), r(15), w(2, 3, 2), r(15),
  w(2, 1, 3), r(10), w(2, 2, 3), r(10), w(2, 3, 3), r(10),
  w(2, 1, 4), r(5), w(2, 2, 4), r(5), w(2, 3, 4),
]

// prettier-ignore
export const medusaExpected: readonly ExpectedSegment[] = [
  w(0, 1, 1), r(15), w(0, 1, 2), r(20), w(0, 1, 3), r(30),
  w(0, 2, 1), r(15), w(0, 2, 2), r(20), w(0, 2, 3), r(30),
  w(0, 3, 1), r(15), w(0, 3, 2), r(20), w(0, 3, 3), r(30),
  w(0, 4, 1), r(15), w(0, 4, 2), r(20), w(0, 4, 3), r(30),
  w(0, 5, 1), r(15), w(0, 5, 2), r(20), w(0, 5, 3), r(30),
  w(0, 6, 1), r(15), w(0, 6, 2), r(20), w(0, 6, 3), r(30),
  w(0, 7, 1), r(15), w(0, 7, 2), r(20), w(0, 7, 3), r(30),
  w(0, 8, 1), r(15), w(0, 8, 2), r(20), w(0, 8, 3), r(30),
  w(0, 9, 1), r(15), w(0, 9, 2), r(20), w(0, 9, 3),
]

// prettier-ignore
export const apexExpected: readonly ExpectedSegment[] = [
  w(0, 1, 1), r(30), w(0, 2, 1), r(30), w(0, 3, 1), r(30), w(0, 4, 1),
  r(30), w(0, 5, 1), r(30), w(0, 6, 1), r(30), w(0, 7, 1), r(30), w(0, 8, 1),
]
