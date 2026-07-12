import type { JSX } from 'react'
import { useRef } from 'react'

import { useLiquidGlass } from '@/glass/use-liquid-glass'

/**
 * Wordmark study — candidate J45 header treatments, each shown on the same
 * glass header strip it would actually live on, with the avatar chip for
 * balance. Throwaway; the winner graduates into the nav-shell AppHeader.
 */

function AvatarChip(): JSX.Element {
  return (
    <span className="flex size-9 items-center justify-center rounded-full bg-white/8 text-[12px] font-bold text-white/80 ring-1 ring-white/12">
      JA
    </span>
  )
}

function HeaderStrip(props: { label: string; children: JSX.Element }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLiquidGlass(ref)
  return (
    <div className="flex flex-col gap-1.5">
      <p className="proto-eyebrow px-1 text-[9px] text-white/35">{props.label}</p>
      <div className="relative overflow-hidden rounded-2xl">
        <div ref={ref} className="glass-surface rounded-2xl px-5 py-4">
          <div className="flex items-center justify-between">
            {props.children}
            <AvatarChip />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * F45-construction badge lockup: chunky fused block letters knocked into a
 * plate by an inner keyline, slanted top-right corner and stepped bottom-left
 * notch like the source mark. `plate` fills the badge, `line` draws the
 * letter keylines.
 */
function WordmarkBadge(props: { plate: string; line: string }): JSX.Element {
  return (
    <svg viewBox="0 0 300 140" className="h-7 w-auto" aria-label="J45">
      <path d="M8 6 L262 6 L292 30 L292 134 L104 134 L104 124 L8 124 Z" fill={props.plate} />
      <g fill="none" stroke={props.line} strokeWidth="6" strokeLinejoin="miter">
        <path d="M36 18 L96 18 L96 116 L22 116 L22 78 L42 78 L42 90 L70 90 L70 44 L36 44 Z" />
        <path d="M136 18 L184 18 L184 116 L158 116 L158 98 L106 98 L106 72 Z" />
        <path d="M154 36 L154 64 L138 64 Z" />
        <path d="M194 18 L272 18 L272 40 L216 40 L216 56 L272 56 L272 116 L194 116 L194 94 L246 94 L246 78 L194 78 Z" />
      </g>
    </svg>
  )
}

function BadgeTreatments(): JSX.Element {
  return (
    <>
      <HeaderStrip label="8 · F45 construction — orange plate, white keyline">
        <WordmarkBadge plate="var(--proto-orange)" line="#ffffff" />
      </HeaderStrip>

      <HeaderStrip label="9 · F45 construction — orange plate, ground keyline">
        <WordmarkBadge plate="var(--proto-orange)" line="#0b0d11" />
      </HeaderStrip>

      <HeaderStrip label="10 · F45 construction — slate plate, orange keyline">
        <WordmarkBadge plate="#191d24" line="var(--proto-orange)" />
      </HeaderStrip>
    </>
  )
}

function Treatments(): JSX.Element {
  return (
    <>
      <HeaderStrip label="1 · Current — italic black, orange 45">
        <span className="font-heading text-[24px] leading-none font-black tracking-tighter text-white italic">
          J<span className="text-[var(--proto-orange)]">45</span>
        </span>
      </HeaderStrip>

      <HeaderStrip label="2 · Upright black, orange 45">
        <span className="font-heading text-[24px] leading-none font-black tracking-tighter text-white">
          J<span className="text-[var(--proto-orange)]">45</span>
        </span>
      </HeaderStrip>

      <HeaderStrip label="3 · Italic black, orange J">
        <span className="font-heading text-[24px] leading-none font-black tracking-tighter italic">
          <span className="text-[var(--proto-orange)]">J</span>
          <span className="text-white">45</span>
        </span>
      </HeaderStrip>

      <HeaderStrip label="4 · All white + orange full stop">
        <span className="font-heading text-[24px] leading-none font-black tracking-tighter text-white">
          J45<span className="text-[var(--proto-orange)]">.</span>
        </span>
      </HeaderStrip>

      <HeaderStrip label="5 · Orange slash divider">
        <span className="flex items-center gap-1 font-heading text-[24px] leading-none font-black tracking-tighter text-white">
          J
          <span className="inline-block h-[22px] w-[3px] -skew-x-12 rounded-full bg-[var(--proto-orange)]" />
          45
        </span>
      </HeaderStrip>

      <HeaderStrip label="6 · Eyebrow lockup">
        <span className="flex flex-col gap-0.5">
          <span className="proto-eyebrow text-[8px] text-[var(--proto-orange)]">Team Atassi</span>
          <span className="font-heading text-[20px] leading-none font-black tracking-tighter text-white">
            J<span className="text-[var(--proto-orange)]">45</span>
          </span>
        </span>
      </HeaderStrip>

      <HeaderStrip label="7 · Boxed badge">
        <span className="flex items-center">
          <span className="rounded-md bg-[var(--proto-orange)] px-1.5 py-0.5 font-heading text-[18px] leading-none font-black tracking-tighter text-black italic">
            J45
          </span>
        </span>
      </HeaderStrip>
    </>
  )
}

export function Wordmarks(): JSX.Element {
  return (
    <div className="proto-phone">
      <div className="proto-scroll flex h-full flex-col gap-4 overflow-y-auto px-4 py-6">
        <BadgeTreatments />
        <Treatments />
      </div>
    </div>
  )
}
