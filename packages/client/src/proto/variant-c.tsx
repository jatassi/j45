import type { JSX } from 'react'
import { useEffect, useState } from 'react'

import { Pause, SkipForward } from 'lucide-react'

import { GlassCard } from '@/glass/glass-card'
import { cn } from '@/lib/utils'

import { PHASE_HUE } from './data'

const START_SECONDS = 37
const TOTAL_STATIONS = 9
const CURRENT_STATION = 4

/** mm:ss, zero-padded. */
function format(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Ticks once a second, looping — the digits live INSIDE the glass, so the
 *  refraction never goes stale from this. */
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

/** The hero: a large glass live-player card over the phase-tinted ambient. */
function PlayerCard(): JSX.Element {
  const remaining = useCountdown(START_SECONDS)
  const work = PHASE_HUE.work
  return (
    <GlassCard className="gap-0 rounded-[32px] px-6 py-7">
      <div className="flex items-center justify-between">
        <span
          className="proto-eyebrow inline-flex items-center gap-2 text-[12px]"
          style={{ color: work }}
        >
          <span className="size-2 rounded-full" style={{ backgroundColor: work }} />
          Work
        </span>
        <span className="proto-eyebrow text-[11px] text-white/40">
          Station {CURRENT_STATION} / {TOTAL_STATIONS}
        </span>
      </div>

      <div
        className="proto-nums mt-5 text-center text-[92px] leading-none font-extrabold text-white"
        style={{ textShadow: `0 0 40px color-mix(in oklab, ${work} 35%, transparent)` }}
      >
        {format(remaining)}
      </div>

      <p className="mt-3 text-center font-heading text-[24px] font-extrabold tracking-[-0.02em] text-white">
        Goblet Squat
      </p>
      <p className="mt-1 text-center text-[13px] text-white/55">Next · Kettlebell Swing</p>

      <div className="mt-6 flex items-center justify-center gap-2">
        {Array.from({ length: TOTAL_STATIONS }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 rounded-full transition-all',
              i <= CURRENT_STATION ? 'w-6' : 'w-2',
            )}
            style={{ backgroundColor: dotColor(i, work) }}
          />
        ))}
      </div>
    </GlassCard>
  )
}

function dotColor(index: number, work: string): string {
  if (index < CURRENT_STATION) return `color-mix(in oklab, ${work} 55%, transparent)`
  if (index === CURRENT_STATION) return work
  return 'rgb(255 255 255 / 0.16)'
}

/** Opaque control — solid on purpose; only the hero is glass. */
function ControlBar(): JSX.Element {
  return (
    <div className="mt-5 flex items-center justify-center gap-4">
      <button
        type="button"
        className="flex size-14 items-center justify-center rounded-full bg-[var(--proto-surface-2)] text-white/70 ring-1 ring-[var(--proto-line)]"
      >
        <SkipForward className="size-6" />
      </button>
      <button
        type="button"
        className="flex size-20 items-center justify-center rounded-full bg-[var(--proto-orange)] text-black shadow-[0_10px_40px_-8px_var(--proto-orange)]"
      >
        <Pause className="size-8" fill="currentColor" />
      </button>
      <button
        type="button"
        className="flex size-14 items-center justify-center rounded-full bg-[var(--proto-surface-2)] text-white/70 ring-1 ring-[var(--proto-line)]"
      >
        <span className="proto-eyebrow text-[10px]">End</span>
      </button>
    </div>
  )
}

/** Variant C — one glass hero, everything else opaque. */
export function VariantC(): JSX.Element {
  return (
    <div className="proto-phone">
      <div className="proto-phase-bg" aria-hidden="true">
        <div className="proto-phase-pulse" />
      </div>

      <div className="relative z-10 flex h-full flex-col px-5 pt-12 pb-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="proto-eyebrow text-[10px] text-white/40">Live · Blaze 45</p>
            <h1 className="font-heading text-[20px] font-extrabold tracking-[-0.02em] text-white">
              Round 2 of 3
            </h1>
          </div>
          <span className="proto-nums proto-eyebrow text-[13px] text-white/55">18:24 left</span>
        </div>

        <div className="flex flex-1 flex-col justify-center">
          <PlayerCard />
          <ControlBar />
        </div>
      </div>
    </div>
  )
}
