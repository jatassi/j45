import type { CSSProperties, ReactNode } from 'react'
import { useRef } from 'react'

import { Link, useLocation } from '@tanstack/react-router'

import type { GlassOptions } from '@/glass/use-liquid-glass'
import { useLiquidGlass } from '@/glass/use-liquid-glass'

import { tabItemClass, TABS, type TabDef, type TabId } from './tab-defs'

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

/** Icon + label of one tab — the look, minus the interactive wrapper. */
function TabItemBody({ tab, active }: { readonly tab: TabDef; readonly active: boolean }) {
  const { Icon, label } = tab
  return (
    <>
      <Icon className="size-[22px]" strokeWidth={active ? 2.4 : 1.9} aria-hidden />
      <span className="text-[9px] font-medium tracking-wide uppercase">{label}</span>
    </>
  )
}

/**
 * The tab bar's chrome: fixed bottom wrapper + the glass surface, with the
 * tab items supplied by the caller. `glass`/`style` exist for the glass lab
 * (`/glass-lab`) to tune the material; the app's `TabBar` passes neither.
 */
function TabBarSurface(props: {
  readonly glass?: Partial<GlassOptions>
  readonly style?: CSSProperties
  readonly children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLiquidGlass(ref, props.glass)
  return (
    <div className="fixed inset-x-3 bottom-0 z-20 pb-[env(safe-area-inset-bottom)]">
      <div
        ref={ref}
        style={props.style}
        className="glass-surface mb-3 flex items-stretch rounded-full px-2 py-2.5"
      >
        {props.children}
      </div>
    </div>
  )
}

function TabLink({ tab, active }: { readonly tab: TabDef; readonly active: boolean }) {
  return (
    <Link
      to={tab.to}
      data-testid={tab.testId}
      aria-current={active ? 'page' : undefined}
      data-active={active ? 'true' : undefined}
      className={tabItemClass(active)}
    >
      <TabItemBody tab={tab} active={active} />
    </Link>
  )
}

/**
 * Floating glass bottom tab bar (Home · Library · Generate · History).
 * Active tab is derived from the router location — no props.
 */
function TabBar() {
  const { pathname } = useLocation()
  const active = activeTabForPath(pathname)

  return (
    <TabBarSurface>
      {TABS.map((tab) => (
        <TabLink key={tab.id} tab={tab} active={active === tab.id} />
      ))}
    </TabBarSurface>
  )
}

export { TabBar, TabBarSurface, TabItemBody }
