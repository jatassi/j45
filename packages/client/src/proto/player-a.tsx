import type { JSX } from 'react'
import { useEffect, useState } from 'react'

import { Dumbbell, LogOut, Pause, SkipBack, SkipForward, Volume2 } from 'lucide-react'

import { GlassCard } from '@/glass/glass-card'
import { cn } from '@/lib/utils'

import './player.css'

import { PHASE_HUE } from './data'

/* --- Mock mid-workout state (feature set frozen; nothing wired). --- */
const REMAINING_SECONDS = 23
const WORK = PHASE_HUE.work

type CellState = 'done' | 'active' | 'upcoming'
type Cell = { id: string; state: CellState }
type Pod = { name: string; cells: readonly Cell[] }
const PODS: readonly Pod[] = [
  {
    name: 'Pod 1',
    cells: [
      { id: 'p1a', state: 'done' },
      { id: 'p1b', state: 'done' },
      { id: 'p1c', state: 'done' },
    ],
  },
  {
    name: 'Pod 2',
    cells: [
      { id: 'p2a', state: 'active' },
      { id: 'p2b', state: 'upcoming' },
      { id: 'p2c', state: 'upcoming' },
    ],
  },
  {
    name: 'Pod 3',
    cells: [
      { id: 'p3a', state: 'upcoming' },
      { id: 'p3b', state: 'upcoming' },
      { id: 'p3c', state: 'upcoming' },
    ],
  },
]
const PARTICIPANTS = ['Jackson', 'Maddie'] as const

/** mm:ss, zero-padded. */
function format(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Ticks once a second, looping — the digits live INSIDE the glass hero. */
function useCountdown(start: number): number {
  const [remaining, setRemaining] = useState(start)
  useEffect(() => {
    const id = globalThis.setInterval(() => {
      setRemaining((r) => (r <= 0 ? start : r - 1))
    }, 1000)
    return () => {
      globalThis.clearInterval(id)
    }
  }, [start])
  return remaining
}

/** Top chrome: the distinct LEAVE control, the live label, the audio state. */
function TopBar(): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        aria-label="Leave workout"
        className="flex size-11 items-center justify-center rounded-full bg-[color-mix(in_oklab,#fb7185_16%,transparent)] text-[#fb7185] ring-1 ring-[color-mix(in_oklab,#fb7185_36%,transparent)]"
      >
        <LogOut className="size-5" />
      </button>
      <div className="text-center">
        <p className="proto-eyebrow text-[10px] text-white/40">Live · Blaze 45</p>
        <p className="font-heading text-[15px] font-extrabold tracking-[-0.02em] text-white">
          Round 2 of 3
        </p>
      </div>
      <button
        type="button"
        aria-label="Sound on"
        className="proto-eyebrow flex size-11 items-center justify-center gap-1 rounded-full text-white/45"
      >
        <Volume2 className="size-5" />
      </button>
    </div>
  )
}

/** The hero: one dominant glass phase card — countdown + exercise + demo slot. */
function HeroCard(): JSX.Element {
  const remaining = useCountdown(REMAINING_SECONDS)
  return (
    <GlassCard className="gap-0 rounded-[34px] px-6 py-7">
      <div className="flex items-center justify-between">
        <span
          className="proto-eyebrow inline-flex items-center gap-2 text-[12px]"
          style={{ color: WORK }}
        >
          <span className="size-2 rounded-full" style={{ backgroundColor: WORK }} />
          Work
        </span>
        <span className="proto-eyebrow text-[11px] text-white/40">Pod 2 / 3</span>
      </div>

      <div className="player-count-breathe proto-nums mt-4 text-center text-[92px] leading-none font-extrabold text-white">
        {format(remaining)}
      </div>

      <p className="mt-3 text-center font-heading text-[26px] font-extrabold tracking-[-0.02em] text-white">
        Push-up
      </p>
      <p className="mt-1 text-center text-[13px] text-white/55">Station 1 of 3 · Pod 2</p>

      {/* Reserved slot for a future exercise-demo animation. */}
      <div className="player-media-slot mt-5 flex h-28 items-center justify-center rounded-2xl ring-1 ring-[var(--proto-line)]">
        <span className="proto-eyebrow inline-flex items-center gap-2 text-[10px] text-white/35">
          <Dumbbell className="size-4" />
          Exercise demo
        </span>
      </div>

      <p className="mt-4 text-center text-[13px] text-white/45">
        Next · <span className="font-semibold text-white/75">Sit-up</span>
      </p>
    </GlassCard>
  )
}

function dotColor(state: CellState): string {
  if (state === 'done') return `color-mix(in oklab, ${WORK} 50%, transparent)`
  if (state === 'active') return WORK
  return 'rgb(255 255 255 / 0.14)'
}

/** Per-pod progress dots, out on the tinted ground (not inside the hero). */
function ProgressGrid(): JSX.Element {
  return (
    <div className="mt-6 flex items-end justify-center gap-4">
      {PODS.map((pod) => (
        <div key={pod.name} className="flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-1.5">
            {pod.cells.map((cell) => (
              <span
                key={cell.id}
                className={cn(
                  'size-2.5 rounded-full',
                  cell.state === 'active' && 'player-dot-active',
                )}
                style={{ backgroundColor: dotColor(cell.state) }}
              />
            ))}
          </div>
          <span className="proto-eyebrow text-[8px] text-white/30">{pod.name}</span>
        </div>
      ))}
    </div>
  )
}

/** Prev / Pause / Skip — generous round tap targets. */
function ControlBar(): JSX.Element {
  return (
    <div className="mt-6 flex items-center justify-center gap-4">
      <button
        type="button"
        aria-label="Previous"
        className="flex size-14 items-center justify-center rounded-full bg-[var(--proto-surface-2)] text-white/70 ring-1 ring-[var(--proto-line)]"
      >
        <SkipBack className="size-6" />
      </button>
      <button
        type="button"
        aria-label="Pause"
        className="flex size-[76px] items-center justify-center rounded-full bg-[var(--primary)] text-black shadow-[0_10px_40px_-8px_var(--primary)]"
      >
        <Pause className="size-8" fill="currentColor" />
      </button>
      <button
        type="button"
        aria-label="Skip"
        className="flex size-14 items-center justify-center rounded-full bg-[var(--proto-surface-2)] text-white/70 ring-1 ring-[var(--proto-line)]"
      >
        <SkipForward className="size-6" />
      </button>
    </div>
  )
}

/** Small avatar-ish participant pills. */
function Participants(): JSX.Element {
  return (
    <div className="mt-5 flex items-center justify-center gap-2">
      {PARTICIPANTS.map((name) => (
        <span
          key={name}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--proto-surface-2)] py-1 pr-3 pl-1 text-[12px] text-white/70 ring-1 ring-[var(--proto-line)]"
        >
          <span
            className="proto-eyebrow flex size-6 items-center justify-center rounded-full text-[10px] text-black"
            style={{ backgroundColor: WORK }}
          >
            {name.charAt(0)}
          </span>
          {name}
        </span>
      ))}
    </div>
  )
}

/**
 * PlayerA — "hero card": one dominant glass phase card carries the countdown,
 * exercise, and demo slot, floating over the phase-tinted pulsing backdrop;
 * progress, controls, and participants sit outside it on the tinted ground.
 */
export function PlayerA(): JSX.Element {
  return (
    <div className="proto-phone">
      <div className="proto-phase-bg" aria-hidden="true">
        <div className="proto-phase-pulse" />
      </div>

      <div className="relative z-10 flex h-full flex-col px-5 pt-12 pb-8">
        <TopBar />
        <div className="flex flex-1 flex-col justify-center">
          <HeroCard />
          <ProgressGrid />
          <ControlBar />
          <Participants />
        </div>
      </div>
    </div>
  )
}
