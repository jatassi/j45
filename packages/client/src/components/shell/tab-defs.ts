import { History, Home, LibraryBig, Sparkles, type LucideIcon } from 'lucide-react'

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

/** The shared per-tab classes — one writer for router links and demo buttons. */
function tabItemClass(active: boolean): string {
  return cn(
    'flex min-h-11 flex-1 flex-col items-center justify-center gap-1 py-0.5 transition-colors',
    active ? 'text-primary' : 'text-white/45',
  )
}

export { TABS, tabItemClass }
export type { TabDef, TabId }
