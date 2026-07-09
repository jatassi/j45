// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as AudioModule from '@/player/audio'
import audioSource from '@/player/audio.ts?raw'

// ── Fake Web Audio ───────────────────────────────────────────────────────────
// jsdom has no AudioContext, so we install a fake on the global. Its `resume`
// synchronously flips `state` to 'running' — the transition the module reports.

class FakeAudioParam {
  value = 0
  setValueAtTime = vi.fn(() => this)
  exponentialRampToValueAtTime = vi.fn(() => this)
}

class FakeOscillator {
  type = 'sine'
  frequency = new FakeAudioParam()
  connect = vi.fn()
  start = vi.fn()
  stop = vi.fn()
}

class FakeGain {
  gain = new FakeAudioParam()
  connect = vi.fn()
}

const contexts: FakeAudioContext[] = []

class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended'
  currentTime = 0
  destination = {}
  oscillators: FakeOscillator[] = []
  resume = vi.fn(() => {
    this.state = 'running'
    return Promise.resolve()
  })

  constructor() {
    contexts.push(this)
  }

  createOscillator(): FakeOscillator {
    const osc = new FakeOscillator()
    this.oscillators.push(osc)
    return osc
  }

  createGain(): FakeGain {
    return new FakeGain()
  }
}

async function loadAudio(): Promise<typeof AudioModule> {
  vi.resetModules()
  return import('@/player/audio')
}

beforeEach(() => {
  contexts.length = 0
  ;(globalThis as { AudioContext?: unknown }).AudioContext = FakeAudioContext
})

afterEach(() => {
  delete (globalThis as { AudioContext?: unknown }).AudioContext
})

describe('audio state', () => {
  it('starts blocked before any unlock', async () => {
    const audio = await loadAudio()
    expect(audio.audioState()).toBe('blocked')
    expect(contexts).toHaveLength(0)
  })

  it('transitions blocked → on when unlockAudio resumes the context', async () => {
    const audio = await loadAudio()
    expect(audio.audioState()).toBe('blocked')

    expect(audio.unlockAudio()).toBe('on')
    expect(audio.audioState()).toBe('on')
    expect(contexts[0]?.resume).toHaveBeenCalledTimes(1)
  })

  it('re-resumes on visibilitychange, restoring on after a background suspend', async () => {
    const audio = await loadAudio()
    audio.unlockAudio()
    const ctx = contexts[0]

    // The browser suspended us while backgrounded.
    ctx.state = 'suspended'
    expect(audio.audioState()).toBe('blocked')

    document.dispatchEvent(new Event('visibilitychange'))

    expect(ctx.resume).toHaveBeenCalledTimes(2)
    expect(audio.audioState()).toBe('on')
  })

  it('re-resumes before every beep', async () => {
    const audio = await loadAudio()
    audio.unlockAudio()
    const ctx = contexts[0]

    ctx.state = 'suspended'
    audio.beepWork()

    expect(ctx.resume).toHaveBeenCalledTimes(2)
    expect(audio.audioState()).toBe('on')
  })

  it('lazily creates exactly one AudioContext across unlock and beeps', async () => {
    const audio = await loadAudio()
    audio.unlockAudio()
    audio.unlockAudio()
    audio.beepWork()
    audio.beepRest()

    expect(contexts).toHaveLength(1)
  })

  it('reports blocked when no AudioContext constructor exists', async () => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext
    const audio = await loadAudio()

    expect(audio.unlockAudio()).toBe('blocked')
    expect(audio.audioState()).toBe('blocked')
  })
})

describe('beep vocabulary', () => {
  function frequencies(ctx: FakeAudioContext): number[] {
    return ctx.oscillators.map((osc) => osc.frequency.value)
  }

  it('plays the documented tones', async () => {
    const audio = await loadAudio()
    audio.unlockAudio()
    const ctx = contexts[0]

    audio.beepWork()
    expect(frequencies(ctx)).toEqual([880])

    ctx.oscillators.length = 0
    audio.beepRest()
    expect(frequencies(ctx)).toEqual([440])

    ctx.oscillators.length = 0
    audio.beepReady()
    expect(frequencies(ctx)).toEqual([523])

    ctx.oscillators.length = 0
    audio.beepDone()
    expect(frequencies(ctx)).toEqual([660, 880, 1046])

    ctx.oscillators.length = 0
    audio.beepCountdown(3)
    audio.beepCountdown(2)
    audio.beepCountdown(1)
    expect(frequencies(ctx)).toEqual([720, 840, 960])
  })
})

describe('kit isolation', () => {
  it('imports nothing from session or live-session modules', () => {
    const importLines = audioSource
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line) || /\bfrom\s+['"]/.test(line))
    for (const line of importLines) {
      expect(line).not.toMatch(/session/)
    }
  })
})
