import type { JSX } from 'react'
import { useRef } from 'react'

import { Clock, Flame } from 'lucide-react'

import { useLiquidGlass } from '@/glass/use-liquid-glass'

import { WORKOUTS, type Workout } from './data'
import { FocusBadge, TabItems } from './shared'

/** Opaque slate content card — the thing the glass chrome refracts. */
function WorkoutCard(props: { workout: Workout }): JSX.Element {
  const w = props.workout
  return (
    <div className="rounded-2xl bg-[var(--proto-surface)] p-4 ring-1 ring-[var(--proto-line)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-heading text-[19px] leading-tight font-extrabold tracking-[-0.02em] text-white">
            {w.name}
          </h3>
          <p className="mt-1 truncate text-[13px] text-white/50">{w.blurb}</p>
        </div>
        <FocusBadge focus={w.focus} className="shrink-0" />
      </div>
      <div className="mt-4 flex items-center gap-4 text-[12px] text-white/55">
        <span className="proto-nums inline-flex items-center gap-1.5">
          <Clock className="size-3.5" /> {w.minutes} min
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Flame className="size-3.5" /> {w.stations} stations
        </span>
      </div>
    </div>
  )
}

/** Sticky glass header — refracts the list scrolling beneath it. */
function GlassHeader(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLiquidGlass(ref)
  return (
    <div className="absolute inset-x-0 top-0 z-20">
      <div ref={ref} className="glass-surface rounded-none px-5 pt-11 pb-4">
        <p className="proto-eyebrow text-[10px] text-[var(--primary)]">J45 · Studio</p>
        <h1 className="mt-1 font-heading text-[26px] leading-none font-extrabold tracking-[-0.02em] text-white">
          Library
        </h1>
      </div>
    </div>
  )
}

/** Floating glass bottom tab bar — refracts content behind it. */
function GlassTabBar(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLiquidGlass(ref)
  return (
    <div className="absolute inset-x-3 bottom-4 z-20">
      <div ref={ref} className="glass-surface flex items-stretch rounded-3xl px-2 py-2.5">
        <TabItems active="library" />
      </div>
    </div>
  )
}

/** Variant A — glass as chrome over opaque content. */
export function VariantA(): JSX.Element {
  return (
    <div className="proto-phone">
      <GlassHeader />
      <div className="proto-scroll h-full overflow-y-auto px-4 pt-32 pb-28">
        <div className="flex flex-col gap-3">
          {WORKOUTS.map((w) => (
            <WorkoutCard key={w.id} workout={w} />
          ))}
        </div>
      </div>
      <GlassTabBar />
    </div>
  )
}
