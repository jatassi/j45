// Player kit — beep audio.
//
// One lazily-created AudioContext, shared across the whole player. `unlockAudio`
// is called synchronously from the explicit tap that enters a player (never from
// a passive document listener — that is where iOS refuses to start audio); the
// context is re-resumed on `visibilitychange` and immediately before every beep.
// State is surfaced as exactly `"on"` (context running) or `"blocked"`.
//
// This is a shared kit primitive: it must not import from any session or
// live-session module. The dependency points kit ← screen only.

export type AudioState = 'on' | 'blocked'

type WebkitScope = typeof globalThis & {
  webkitAudioContext?: typeof AudioContext
}

let context: AudioContext | undefined
let visibilityBound = false

function audioContextCtor(): typeof AudioContext | undefined {
  if (typeof AudioContext !== 'undefined') return AudioContext
  const scope = globalThis as WebkitScope
  return scope.webkitAudioContext
}

function bindVisibility(): void {
  if (visibilityBound) return
  if (typeof document === 'undefined') return
  document.addEventListener('visibilitychange', () => {
    resume()
  })
  visibilityBound = true
}

function ensureContext(): AudioContext | undefined {
  if (context === undefined) {
    const Ctor = audioContextCtor()
    if (Ctor === undefined) return undefined
    context = new Ctor()
    bindVisibility()
  }
  return context
}

function resume(): void {
  if (context?.state === 'suspended') {
    void context.resume()
  }
}

/** The current audio state: `"on"` only when the context exists and is running. */
export function audioState(): AudioState {
  return context?.state === 'running' ? 'on' : 'blocked'
}

/**
 * Create (once) and resume the AudioContext. Safe to call synchronously inside a
 * tap handler — it never awaits before touching the context. Returns the state
 * observed immediately after the resume request.
 */
export function unlockAudio(): AudioState {
  const ctx = ensureContext()
  if (ctx === undefined) return 'blocked'
  if (ctx.state === 'suspended') {
    void ctx.resume()
  }
  return audioState()
}

const WORK_HZ = 880
const REST_HZ = 440
const READY_HZ = 523
const DONE_HZ = [660, 880, 1046] as const

const BEEP_SECONDS = 0.15
const DONE_NOTE_SECONDS = 0.12
const PEAK_GAIN = 0.3

type ToneSpec = { frequency: number; when: number; duration: number }

function playTone(ctx: AudioContext, spec: ToneSpec): void {
  const { frequency, when, duration } = spec
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = frequency
  osc.connect(gain)
  gain.connect(ctx.destination)
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, when + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration)
  osc.start(when)
  osc.stop(when + duration)
}

function beep(frequencies: readonly number[], noteSeconds: number): void {
  const ctx = ensureContext()
  if (ctx === undefined) return
  resume()
  frequencies.forEach((frequency, index) => {
    playTone(ctx, {
      frequency,
      when: ctx.currentTime + index * noteSeconds,
      duration: noteSeconds,
    })
  })
}

/** Work segment starts — 880Hz. */
export function beepWork(): void {
  beep([WORK_HZ], BEEP_SECONDS)
}

/** Rest segment starts — 440Hz. */
export function beepRest(): void {
  beep([REST_HZ], BEEP_SECONDS)
}

/** Get-ready lead-in — 523Hz. */
export function beepReady(): void {
  beep([READY_HZ], BEEP_SECONDS)
}

/** Workout finished — rising three-note (660 / 880 / 1046Hz). */
export function beepDone(): void {
  beep(DONE_HZ, DONE_NOTE_SECONDS)
}

/**
 * 3-2-1 countdown tone for the last three seconds of a segment. Rising with
 * urgency: 720Hz at three seconds out, 840Hz at two, 960Hz at one
 * (`600 + (4 − secondsRemaining) · 120`, the legacy vocabulary).
 */
export function beepCountdown(secondsRemaining: number): void {
  beep([600 + (4 - secondsRemaining) * 120], BEEP_SECONDS)
}
