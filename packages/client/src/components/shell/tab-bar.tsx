import { useRef } from 'react'

import { Link, useLocation } from '@tanstack/react-router'
import { History, Home, LibraryBig, Sparkles, type LucideIcon } from 'lucide-react'

import { useLiquidGlass } from '@/glass/use-liquid-glass'
import { cn } from '@/lib/utils'

type TabId = 'home' | 'library' | 'generate' | 'history'

type TabDef = {
  readonly id: TabId
  readonly testId: string
  readonly to: '/' | '/library' | '/generate' | '/history'
  readonly label: string
  readonly Icon: LucideIcon
}

const TABS: readonly TabDef[] = [
  { id: 'home', testId: 'tab-home', to: '/', label: 'Home', Icon: Home },
  { id: 'library', testId: 'tab-library', to: '/library', label: 'Library', Icon: LibraryBig },
  { id: 'generate', testId: 'tab-generate', to: '/generate', label: 'Generate', Icon: Sparkles },
  { id: 'history', testId: 'tab-history', to: '/history', label: 'History', Icon: History },
]

/** True when `pathname` is `base` or a sub-path under it. */
function matchesPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`)
}

/**
 * Active tab from the current pathname's group:
 * exact `/` → Home; `/library*` and `/workouts*` → Library;
 * `/generate*` → Generate; `/history*` → History.
 */
function activeTabForPath(pathname: string): TabId | null {
  if (pathname === '/') {
    return 'home'
  }
  if (matchesPath(pathname, '/library') || matchesPath(pathname, '/workouts')) {
    return 'library'
  }
  if (matchesPath(pathname, '/generate')) {
    return 'generate'
  }
  if (matchesPath(pathname, '/history')) {
    return 'history'
  }
  return null
}

function TabLink({ tab, active }: { readonly tab: TabDef; readonly active: boolean }) {
  const { Icon, label, testId, to } = tab
  return (
    <Link
      to={to}
      data-testid={testId}
      aria-current={active ? 'page' : undefined}
      data-active={active ? 'true' : undefined}
      className={cn(
        'flex min-h-11 flex-1 flex-col items-center justify-center gap-1 py-0.5 transition-colors',
        active ? 'text-primary' : 'text-white/45',
      )}
    >
      <Icon className="size-[22px]" strokeWidth={active ? 2.4 : 1.9} aria-hidden />
      <span className="text-[9px] font-medium tracking-wide uppercase">{label}</span>
    </Link>
  )
}

/**
 * Floating glass bottom tab bar (Home · Library · Generate · History).
 * Active tab is derived from the router location — no props.
 */
function TabBar() {
  const ref = useRef<HTMLDivElement>(null)
  useLiquidGlass(ref)
  const { pathname } = useLocation()
  const active = activeTabForPath(pathname)

  return (
    <div className="fixed inset-x-3 bottom-0 z-20 pb-[env(safe-area-inset-bottom)]">
      <div ref={ref} className="glass-surface mb-3 flex items-stretch rounded-3xl px-2 py-2.5">
        {TABS.map((tab) => (
          <TabLink key={tab.id} tab={tab} active={active === tab.id} />
        ))}
      </div>
    </div>
  )
}

export { TabBar }
