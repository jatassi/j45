import type { JSX } from 'react'
import { useEffect, useState } from 'react'

import { installBackdrop } from '@/glass/backdrop'
import { cn } from '@/lib/utils'

import { HomeA } from './home-a'
import { HomeB } from './home-b'
import { PlayerA } from './player-a'
import { PlayerB } from './player-b'
import { VariantA } from './variant-a'
import { VariantB } from './variant-b'
import { VariantC } from './variant-c'
import { Wordmarks } from './wordmarks'

import './proto.css'

type StudyId = 'roles' | 'home' | 'player' | 'wordmark'
type VariantKey = `${StudyId}:${string}`

const STUDIES: readonly {
  id: StudyId
  label: string
  variants: readonly { id: string; label: string; render: () => JSX.Element }[]
}[] = [
  {
    id: 'roles',
    label: 'Roles',
    variants: [
      { id: 'a', label: 'Chrome', render: () => <VariantA /> },
      { id: 'b', label: 'Content', render: () => <VariantB /> },
      { id: 'c', label: 'Hero', render: () => <VariantC /> },
    ],
  },
  {
    id: 'home',
    label: 'Home',
    variants: [
      { id: 'a', label: 'Hero-first', render: () => <HomeA /> },
      { id: 'b', label: 'Launcher grid', render: () => <HomeB /> },
    ],
  },
  {
    id: 'player',
    label: 'Player',
    variants: [
      { id: 'a', label: 'Hero card', render: () => <PlayerA /> },
      { id: 'b', label: 'Immersive', render: () => <PlayerB /> },
    ],
  },
  {
    id: 'wordmark',
    label: 'Wordmark',
    variants: [{ id: 'a', label: 'All treatments', render: () => <Wordmarks /> }],
  },
]

/** One row of pill buttons — reused for the study switch and its variants. */
function PillRow(props: {
  items: readonly { key: string; label: string }[]
  value: string
  onChange: (key: string) => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-1 rounded-full bg-white/5 p-1 ring-1 ring-white/10">
      {props.items.map((item) => {
        const active = item.key === props.value
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              props.onChange(item.key)
            }}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors',
              active ? 'bg-[var(--primary)] text-black' : 'text-white/60 hover:text-white',
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * `/proto` — throwaway design studies: the original liquid-glass role
 * comparison plus the overhaul's home-dashboard and session-player layout
 * variants. Installs the shared document backdrop (so the real refract tier
 * has its gradient to sample) and lets the owner flip between variants.
 */
export function ProtoPage(): JSX.Element {
  const [study, setStudy] = useState<StudyId>('home')
  const [picked, setPicked] = useState<Record<StudyId, string>>({
    roles: 'a',
    home: 'a',
    player: 'a',
    wordmark: 'a',
  })

  useEffect(() => {
    installBackdrop()
  }, [])

  const current = STUDIES.find((s) => s.id === study) ?? STUDIES[0]
  const variantId = picked[current.id]
  const variant = current.variants.find((v) => v.id === variantId) ?? current.variants[0]
  const key: VariantKey = `${current.id}:${variant.id}`

  return (
    <div className="proto-scope flex h-svh flex-col items-center overflow-hidden bg-[var(--proto-ground)] px-4 py-5">
      <div className="mb-5 flex w-full max-w-[390px] flex-col items-center gap-2">
        <p className="proto-eyebrow text-[10px] text-white/35">Design studies · judged by eye</p>
        <PillRow
          items={STUDIES.map((s) => ({ key: s.id, label: s.label }))}
          value={current.id}
          onChange={(id) => {
            setStudy(id as StudyId)
          }}
        />
        <PillRow
          items={current.variants.map((v) => ({ key: v.id, label: v.label }))}
          value={variant.id}
          onChange={(id) => {
            setPicked((prev) => ({ ...prev, [current.id]: id }))
          }}
        />
      </div>

      <div key={key} className="contents">
        {variant.render()}
      </div>
    </div>
  )
}

export default ProtoPage
