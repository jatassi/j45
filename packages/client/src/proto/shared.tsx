import type { JSX } from 'react'

import { History, Home, LibraryBig, Sparkles } from 'lucide-react'

import { cn } from '@/lib/utils'

import { FOCUS_HUE, FOCUS_LABEL, type Focus } from './data'

/** Sport-coded pill. Hue is driven inline so the three foci read distinctly. */
export function FocusBadge(props: { focus: Focus; className?: string }): JSX.Element {
  const hue = FOCUS_HUE[props.focus]
  return (
    <span
      className={cn(
        'proto-eyebrow inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px]',
        props.className,
      )}
      style={{
        color: hue,
        backgroundColor: `color-mix(in oklab, ${hue} 16%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${hue} 34%, transparent)`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: hue }} />
      {FOCUS_LABEL[props.focus]}
    </span>
  )
}

type TabId = 'home' | 'library' | 'generate' | 'history'

const TABS: readonly { id: TabId; label: string; Icon: typeof Home }[] = [
  { id: 'home', label: 'Home', Icon: Home },
  { id: 'library', label: 'Library', Icon: LibraryBig },
  { id: 'generate', label: 'Generate', Icon: Sparkles },
  { id: 'history', label: 'History', Icon: History },
]

/** Row of tab items; caller decides the surrounding surface (glass vs opaque). */
export function TabItems(props: { active: TabId }): JSX.Element {
  return (
    <>
      {TABS.map(({ id, label, Icon }) => {
        const active = id === props.active
        return (
          <div
            key={id}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 py-0.5 transition-colors',
              active ? 'text-[var(--primary)]' : 'text-white/45',
            )}
          >
            <Icon className="size-[22px]" strokeWidth={active ? 2.4 : 1.9} />
            <span className="proto-eyebrow text-[9px]">{label}</span>
          </div>
        )
      })}
    </>
  )
}
