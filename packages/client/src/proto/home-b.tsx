import type { JSX } from 'react'
import { useRef } from 'react'

import { Dumbbell, Play, Plus, Sparkles, Timer } from 'lucide-react'

import { useLiquidGlass } from '@/glass/use-liquid-glass'

import { FOCUS_HUE, WORKOUTS, type Workout } from './data'
import { FocusBadge, TabItems } from './shared'

/**
 * Home dashboard, Variant B — "launcher grid". A greeting sets the tone, a slim
 * live banner strip surfaces the joinable session, a 2-up tile grid launches the
 * core actions (start-last is the orange primary), and recents live in a
 * horizontally snapping rail you flick through.
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
}

/** The last workout you ran — the primary launch tile. */
const LAST_WORKOUT = {
  id: 'blaze-45',
  name: 'Blaze 45',
  focus: 'cardio',
  minutes: 45,
  blurb: 'Relentless intervals, zero coasting.',
  stations: 9,
} satisfies Workout

/** Recents for the snapping rail. */
const RECENT = WORKOUTS.slice(0, 5)

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

/** Sticky glass header — wordmark + account, refracts the content beneath it. */
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

/** Greeting line — sets the tone above the launcher. */
function Greeting(): JSX.Element {
  return (
    <div>
      <p className="proto-eyebrow text-[10px] text-[var(--primary)]">Thursday · Afternoon</p>
      <h1 className="mt-1.5 font-heading text-[28px] leading-none font-black tracking-[-0.03em] text-white">
        Ready to move?
      </h1>
    </div>
  )
}

/** Slim live banner — join the session hosted in your circle. */
function ActiveBanner(): JSX.Element {
  const w = ACTIVE_SESSION.workout
  const hue = FOCUS_HUE[w.focus]
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[var(--proto-surface)] py-3 pr-3 pl-4 ring-1 ring-[var(--proto-line)]">
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: hue }}
        aria-hidden="true"
      />
      <div className="flex items-center gap-3">
        <span className="relative flex size-2.5 shrink-0">
          <span
            className="absolute inline-flex size-full animate-ping rounded-full opacity-70"
            style={{ backgroundColor: hue }}
          />
          <span
            className="relative inline-flex size-2.5 rounded-full"
            style={{ backgroundColor: hue }}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="proto-eyebrow text-[9px]" style={{ color: hue }}>
            Live · {ACTIVE_SESSION.host} hosting
          </p>
          <h3 className="truncate font-heading text-[16px] font-bold tracking-[-0.02em] text-white">
            {w.name}
          </h3>
        </div>
        <button
          type="button"
          className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-[var(--primary)] px-4 text-[13px] font-bold text-black"
        >
          <Play className="size-4" fill="currentColor" />
          Join
        </button>
      </div>
    </div>
  )
}

/** One launcher tile. `accent` promotes it to the orange primary. */
function Tile(props: {
  Icon: typeof Timer
  label: string
  desc: string
  accent?: boolean
}): JSX.Element {
  const { Icon, label, desc, accent = false } = props
  return (
    <button
      type="button"
      className={
        accent
          ? 'flex min-h-[116px] flex-col justify-between rounded-2xl bg-[var(--primary)] p-4 text-left shadow-[0_16px_40px_-14px_var(--primary)]'
          : 'flex min-h-[116px] flex-col justify-between rounded-2xl bg-[var(--proto-surface)] p-4 text-left ring-1 ring-[var(--proto-line)]'
      }
    >
      <Icon
        className={accent ? 'size-7 text-black' : 'size-7 text-white/85'}
        strokeWidth={2}
        fill={accent ? 'currentColor' : 'none'}
      />
      <div className="min-w-0">
        <p
          className={
            accent
              ? 'font-heading text-[16px] font-bold tracking-[-0.02em] text-black'
              : 'font-heading text-[16px] font-bold tracking-[-0.02em] text-white'
          }
        >
          {label}
        </p>
        <p
          className={
            accent ? 'truncate text-[11px] text-black/60' : 'truncate text-[11px] text-white/45'
          }
        >
          {desc}
        </p>
      </div>
    </button>
  )
}

/** The 2-up launcher grid — start-last leads, then Timer, Generate, New. */
function LauncherGrid(): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Tile accent Icon={Play} label="Start last" desc={LAST_WORKOUT.name} />
      <Tile Icon={Timer} label="Timer" desc="Ad-hoc intervals" />
      <Tile Icon={Sparkles} label="Generate" desc="Build a session" />
      <Tile Icon={Plus} label="New workout" desc="From scratch" />
    </div>
  )
}

/** A recent workout card in the horizontal snapping rail. */
function RailCard(props: { workout: Workout }): JSX.Element {
  const w = props.workout
  const hue = FOCUS_HUE[w.focus]
  return (
    <button
      type="button"
      className="flex w-[210px] shrink-0 snap-start flex-col rounded-2xl bg-[var(--proto-surface)] p-4 text-left ring-1 ring-[var(--proto-line)]"
    >
      <div className="flex items-start justify-between">
        <span
          className="flex size-11 items-center justify-center rounded-xl"
          style={{ backgroundColor: `color-mix(in oklab, ${hue} 16%, transparent)` }}
        >
          <Dumbbell className="size-5" style={{ color: hue }} />
        </span>
        <FocusBadge focus={w.focus} />
      </div>
      <h3 className="mt-4 font-heading text-[19px] leading-tight font-extrabold tracking-[-0.02em] text-white">
        {w.name}
      </h3>
      <p className="mt-1 truncate text-[12px] text-white/45">{w.blurb}</p>
      <p className="proto-nums mt-3 text-[12px] text-white/50">
        {w.minutes} min · {w.stations} stations
      </p>
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

/** Home Variant B — launcher-grid "start something" dashboard. */
export function HomeB(): JSX.Element {
  return (
    <div className="proto-phone">
      <GlassHeader />
      <div className="proto-scroll h-full overflow-y-auto px-4 pt-24 pb-28">
        <Greeting />

        <div className="mt-5">
          <ActiveBanner />
        </div>

        <div className="mt-7">
          <SectionLabel>Launch</SectionLabel>
          <LauncherGrid />
        </div>

        <div className="mt-7">
          <SectionLabel>Pick up where you left off</SectionLabel>
          <div className="proto-scroll -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
            {RECENT.map((w) => (
              <RailCard key={w.id} workout={w} />
            ))}
          </div>
        </div>
      </div>
      <GlassTabBar />
    </div>
  )
}
