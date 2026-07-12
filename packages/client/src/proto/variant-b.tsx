import type { JSX } from 'react'

import { Clock, Flame } from 'lucide-react'

import { GlassCard } from '@/glass/glass-card'

import { WORKOUTS, type Workout } from './data'
import { FocusBadge, TabItems } from './shared'

/** The workout card itself is the glass surface, floating over the ambient glow. */
function GlassWorkoutCard(props: { workout: Workout }): JSX.Element {
  const w = props.workout
  return (
    <GlassCard className="gap-0 rounded-3xl py-4">
      <div className="flex items-start justify-between gap-3 px-4">
        <div className="min-w-0">
          <h3 className="font-heading text-[19px] leading-tight font-extrabold tracking-[-0.02em] text-white">
            {w.name}
          </h3>
          <p className="mt-1 truncate text-[13px] text-white/60">{w.blurb}</p>
        </div>
        <FocusBadge focus={w.focus} className="shrink-0" />
      </div>
      <div className="mt-4 flex items-center gap-4 px-4 text-[12px] text-white/65">
        <span className="proto-nums inline-flex items-center gap-1.5">
          <Clock className="size-3.5" /> {w.minutes} min
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Flame className="size-3.5" /> {w.stations} stations
        </span>
      </div>
    </GlassCard>
  )
}

/** Opaque bottom tab bar — the chrome is solid here; the content is glass. */
function OpaqueTabBar(): JSX.Element {
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 flex items-stretch border-t border-[var(--proto-line)] bg-[var(--proto-surface)]/95 px-2 pt-2.5 pb-6 backdrop-blur-sm">
      <TabItems active="library" />
    </div>
  )
}

/** Variant B — glass as content over an animated ambient backdrop. */
export function VariantB(): JSX.Element {
  return (
    <div className="proto-phone">
      <div className="proto-ambient" aria-hidden="true">
        <div className="proto-blob proto-blob-1" />
        <div className="proto-blob proto-blob-2" />
        <div className="proto-blob proto-blob-3" />
      </div>

      <div className="relative z-10 px-5 pt-11 pb-3">
        <p className="proto-eyebrow text-[10px] text-[var(--primary)]">J45 · Studio</p>
        <h1 className="mt-1 font-heading text-[26px] leading-none font-extrabold tracking-[-0.02em] text-white">
          Library
        </h1>
      </div>

      <div className="proto-scroll relative z-10 h-[calc(100%-96px)] overflow-y-auto px-4 pt-1 pb-28">
        <div className="flex flex-col gap-3.5">
          {WORKOUTS.map((w) => (
            <GlassWorkoutCard key={w.id} workout={w} />
          ))}
        </div>
      </div>

      <OpaqueTabBar />
    </div>
  )
}
