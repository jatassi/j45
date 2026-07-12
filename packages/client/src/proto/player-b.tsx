import type { JSX } from 'react'
import { useEffect, useState } from 'react'

import { Dumbbell, LogOut, Pause, SkipBack, SkipForward, Volume2 } from 'lucide-react'

import { GlassCard } from '@/glass/glass-card'
import { cn } from '@/lib/utils'

import { PHASE_HUE } from './data'

/* --- Mock mid-workout state (feature set frozen; nothing wired). --- */
const REMAINING_SECONDS = 23
const PHASE_SECONDS = 40
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

/** Ticks once a second, looping — drives both the digits and the ring sweep. */
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

/** Top chrome: the distinct LEAVE control and the small audio-state indicator. */
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
        className="flex size-11 items-center justify-center rounded-full text-white/45"
      >
        <Volume2 className="size-5" />
      </button>
    </div>
  )
}

const RING_RADIUS = 132
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/** The depleting phase-tinted arc — a track ring plus the progress stroke. */
function RingArc({ fraction }: { readonly fraction: number }): JSX.Element {
  return (
    <svg viewBox="0 0 300 300" className="size-[290px] -rotate-90" aria-hidden="true">
      <circle
        cx="150"
        cy="150"
        r={RING_RADIUS}
        fill="none"
        stroke="rgb(255 255 255 / 0.08)"
        strokeWidth="8"
      />
      <circle
        cx="150"
        cy="150"
        r={RING_RADIUS}
        fill="none"
        stroke={WORK}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
        style={{
          transition: 'stroke-dashoffset 1s linear',
          filter: `drop-shadow(0 0 10px color-mix(in oklab, ${WORK} 55%, transparent))`,
        }}
      />
    </svg>
  )
}

/**
 * The immersive centrepiece: a thin phase-tinted progress ring with the
 * countdown floating directly on the backdrop inside it. The ring depletes as
 * the seconds tick — SVG stroke-dashoffset, no card behind it.
 */
function TimerRing(): JSX.Element {
  const remaining = useCountdown(REMAINING_SECONDS)
  const fraction = Math.max(0, Math.min(1, remaining / PHASE_SECONDS))
  return (
    <div className="relative flex items-center justify-center">
      <RingArc fraction={fraction} />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="proto-eyebrow inline-flex items-center gap-2 text-[12px]"
          style={{ color: WORK }}
        >
          <span className="size-2 rounded-full" style={{ backgroundColor: WORK }} />
          Work
        </span>
        <span
          className="proto-nums mt-1 text-[84px] leading-none font-extrabold text-white"
          style={{ textShadow: `0 0 40px color-mix(in oklab, ${WORK} 40%, transparent)` }}
        >
          {format(remaining)}
        </span>
        <p className="mt-2 font-heading text-[24px] font-extrabold tracking-[-0.02em] text-white">
          Push-up
        </p>
        <p className="text-[12px] text-white/50">Station 1 of 3 · Pod 2</p>
      </div>
    </div>
  )
}

function dotColor(state: CellState): string {
  if (state === 'done') return `color-mix(in oklab, ${WORK} 50%, transparent)`
  if (state === 'active') return WORK
  return 'rgb(255 255 255 / 0.14)'
}

/** Compact per-pod progress dots. */
function ProgressGrid(): JSX.Element {
  return (
    <div className="flex items-center justify-center gap-3.5">
      {PODS.map((pod) => (
        <div key={pod.name} className="flex items-center gap-1.5">
          {pod.cells.map((cell) => (
            <span
              key={cell.id}
              className={cn('rounded-full', cell.state === 'active' ? 'size-2.5' : 'size-2')}
              style={{ backgroundColor: dotColor(cell.state) }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Small inline media chip — the reserved slot for a future demo animation. */
function MediaChip(): JSX.Element {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl bg-[var(--proto-surface-2)]/70 py-2 pr-4 pl-2 ring-1 ring-[var(--proto-line)]">
      <span className="flex size-9 items-center justify-center rounded-xl bg-white/5 text-white/40">
        <Dumbbell className="size-4" />
      </span>
      <div className="leading-tight">
        <p className="proto-eyebrow text-[9px] text-white/35">Demo</p>
        <p className="text-[12px] text-white/60">Push-up form</p>
      </div>
    </div>
  )
}

/** Small avatar-ish participant pills. */
function Participants(): JSX.Element {
  return (
    <div className="flex items-center justify-center gap-2">
      {PARTICIPANTS.map((name) => (
        <span
          key={name}
          className="inline-flex items-center gap-2 rounded-full bg-white/5 py-1 pr-3 pl-1 text-[12px] text-white/70 ring-1 ring-[var(--proto-line)]"
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

/** The compact glass control dock: next-up line + Prev / Pause / Skip. */
function ControlDock(): JSX.Element {
  return (
    <GlassCard className="gap-0 rounded-[28px] px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="proto-eyebrow text-[10px] text-white/40">Next up</span>
        <span className="text-[14px] font-semibold text-white/85">Sit-up</span>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous"
          className="flex size-12 items-center justify-center rounded-full bg-white/6 text-white/70 ring-1 ring-[var(--proto-line)]"
        >
          <SkipBack className="size-5" />
        </button>
        <button
          type="button"
          aria-label="Pause"
          className="flex size-16 items-center justify-center rounded-full bg-[var(--primary)] text-black shadow-[0_10px_40px_-8px_var(--primary)]"
        >
          <Pause className="size-7" fill="currentColor" />
        </button>
        <button
          type="button"
          aria-label="Skip"
          className="flex size-12 items-center justify-center rounded-full bg-white/6 text-white/70 ring-1 ring-[var(--proto-line)]"
        >
          <SkipForward className="size-5" />
        </button>
      </div>
    </GlassCard>
  )
}

/**
 * PlayerB — "immersive": no card behind the timer. The countdown floats on the
 * phase-tinted backdrop inside a thin depleting progress ring, with a compact
 * glass dock at the bottom holding next-up + controls, and the demo animation
 * reduced to a small inline media chip.
 */
export function PlayerB(): JSX.Element {
  return (
    <div className="proto-phone">
      <div className="proto-phase-bg" aria-hidden="true">
        <div className="proto-phase-pulse" />
      </div>

      <div className="relative z-10 flex h-full flex-col px-5 pt-12 pb-8">
        <TopBar />
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <TimerRing />
          <MediaChip />
          <ProgressGrid />
          <Participants />
        </div>
        <ControlDock />
      </div>
    </div>
  )
}
