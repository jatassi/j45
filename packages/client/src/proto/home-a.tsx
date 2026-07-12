import type { JSX } from 'react'
import { useRef } from 'react'

import { Clock, Dumbbell, Flame, Play, Plus, Sparkles, Timer } from 'lucide-react'

import { useLiquidGlass } from '@/glass/use-liquid-glass'

import { FOCUS_HUE, WORKOUTS, type Workout } from './data'
import { FocusBadge, TabItems } from './shared'

/**
 * Home dashboard, Variant A — "hero-first". One dominant action owns the fold
 * (Join the live session when someone in your circle is mid-workout, else Start
 * your last one), a three-up quick-action row sits under it, and recents drop to
 * a compact tap-to-start list.
 */

/** One mocked live session — someone in the circle is mid-workout. */
const ACTIVE_SESSION = {
  workout: {
    id: 'hybrid-havoc',
    name: 'Hybrid Havoc',
    focus: 'hybrid',
    minutes: 42,
    blurb: 'Lift, sprint, repeat until smoked.',
    stations: 10,
  } satisfies Workout,
  host: 'Marcus',
  elapsedMin: 12,
  station: 4,
}

/** Recents you can restart with one tap. */
const RECENT = WORKOUTS.slice(0, 4)

/** Heavy, tight-tracked J45 wordmark with the signature orange on the digits. */
function Wordmark(): JSX.Element {
  return (
    <span className="font-heading text-[24px] leading-none font-black tracking-tighter text-white italic">
      J<span className="text-[var(--primary)]">45</span>
    </span>
  )
}

/** Account entry point — the header avatar chip. */
function AvatarChip(): JSX.Element {
  return (
    <button
      type="button"
      className="flex size-11 items-center justify-center rounded-full bg-[var(--proto-surface-2)] ring-1 ring-[var(--proto-line)]"
    >
      <span className="font-heading text-[13px] font-bold text-white/80">JA</span>
    </button>
  )
}

/** Sticky glass header — wordmark + account, refracts the list beneath it. */
function GlassHeader(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLiquidGlass(ref)
  return (
    <div className="absolute inset-x-0 top-0 z-20">
      <div ref={ref} className="glass-surface rounded-none px-5 pt-11 pb-4">
        <div className="flex items-center justify-between">
          <Wordmark />
          <AvatarChip />
        </div>
      </div>
    </div>
  )
}

/** A small pulsing live dot in the given hue. */
function LiveDot(props: { hue: string; size?: string }): JSX.Element {
  const size = props.size ?? 'size-2'
  return (
    <span className={`relative flex ${size}`}>
      <span
        className="absolute inline-flex size-full animate-ping rounded-full opacity-70"
        style={{ backgroundColor: props.hue }}
      />
      <span
        className={`relative inline-flex ${size} rounded-full`}
        style={{ backgroundColor: props.hue }}
      />
    </span>
  )
}

/** The dominant hero — join the live session in one tap. */
function HeroJoin(): JSX.Element {
  const w = ACTIVE_SESSION.workout
  const hue = FOCUS_HUE[w.focus]
  return (
    <div
      className="relative overflow-hidden rounded-[28px] bg-[var(--proto-surface)] p-5 ring-1 ring-[var(--proto-line)]"
      style={{ boxShadow: `0 24px 60px -34px ${hue}` }}
    >
      <div
        className="pointer-events-none absolute -top-16 -right-12 size-52 rounded-full opacity-25 blur-3xl"
        style={{ backgroundColor: hue }}
        aria-hidden="true"
      />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span
            className="proto-eyebrow inline-flex items-center gap-2 text-[11px]"
            style={{ color: hue }}
          >
            <LiveDot hue={hue} />
            Live now
          </span>
          <FocusBadge focus={w.focus} />
        </div>

        <h2 className="mt-4 font-heading text-[34px] leading-[0.95] font-black tracking-[-0.03em] text-white">
          {w.name}
        </h2>
        <p className="mt-2 text-[14px] text-white/55">{ACTIVE_SESSION.host} is hosting live</p>

        <div className="mt-3 flex items-center gap-4 text-[12px] text-white/50">
          <span className="proto-nums inline-flex items-center gap-1.5">
            <Clock className="size-3.5" /> {ACTIVE_SESSION.elapsedMin} min in
          </span>
          <span className="proto-nums inline-flex items-center gap-1.5">
            <Flame className="size-3.5" /> Station {ACTIVE_SESSION.station}/{w.stations}
          </span>
        </div>

        <button
          type="button"
          className="mt-5 flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] text-[16px] font-bold text-black shadow-[0_12px_36px_-10px_var(--primary)]"
        >
          <Play className="size-5" fill="currentColor" />
          Join now
        </button>
      </div>
    </div>
  )
}

/** One square quick action. */
function QuickAction(props: { Icon: typeof Timer; label: string }): JSX.Element {
  const { Icon, label } = props
  return (
    <button
      type="button"
      className="flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-2xl bg-[var(--proto-surface)] ring-1 ring-[var(--proto-line)]"
    >
      <Icon className="size-6 text-white/85" strokeWidth={2} />
      <span className="proto-eyebrow text-[10px] text-white/60">{label}</span>
    </button>
  )
}

/** Timer · Generate · New — the three-up row under the hero. */
function QuickActions(): JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-3">
      <QuickAction Icon={Timer} label="Timer" />
      <QuickAction Icon={Sparkles} label="Generate" />
      <QuickAction Icon={Plus} label="New" />
    </div>
  )
}

/** Compact recent row — icon, name, quick play. */
function RecentRow(props: { workout: Workout }): JSX.Element {
  const w = props.workout
  const hue = FOCUS_HUE[w.focus]
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-2xl bg-[var(--proto-surface)] p-3 text-left ring-1 ring-[var(--proto-line)]"
    >
      <span
        className="flex size-11 shrink-0 items-center justify-center rounded-xl"
        style={{ backgroundColor: `color-mix(in oklab, ${hue} 16%, transparent)` }}
      >
        <Dumbbell className="size-5" style={{ color: hue }} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-heading text-[16px] font-bold tracking-[-0.02em] text-white">
          {w.name}
        </h3>
        <p className="proto-nums mt-0.5 text-[12px] text-white/45">
          {w.minutes} min · {w.stations} stations
        </p>
      </div>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--proto-surface-2)] text-white/75">
        <Play className="size-4" fill="currentColor" />
      </span>
    </button>
  )
}

/** Wide-tracked section eyebrow. */
function SectionLabel(props: { children: string }): JSX.Element {
  return <p className="proto-eyebrow mb-3 text-[10px] text-white/35">{props.children}</p>
}

/** Floating glass bottom tab bar — refracts content behind it. */
function GlassTabBar(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLiquidGlass(ref)
  return (
    <div className="absolute inset-x-3 bottom-4 z-20">
      <div ref={ref} className="glass-surface flex items-stretch rounded-3xl px-2 py-2.5">
        <TabItems active="home" />
      </div>
    </div>
  )
}

/** Home Variant A — hero-first "start something" dashboard. */
export function HomeA(): JSX.Element {
  return (
    <div className="proto-phone">
      <GlassHeader />
      <div className="proto-scroll h-full overflow-y-auto px-4 pt-24 pb-28">
        <HeroJoin />

        <div className="mt-6">
          <SectionLabel>Quick start</SectionLabel>
          <QuickActions />
        </div>

        <div className="mt-6">
          <SectionLabel>Recent</SectionLabel>
          <div className="flex flex-col gap-2.5">
            {RECENT.map((w) => (
              <RecentRow key={w.id} workout={w} />
            ))}
          </div>
        </div>
      </div>
      <GlassTabBar />
    </div>
  )
}
