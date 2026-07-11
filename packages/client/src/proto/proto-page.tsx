import type { JSX } from 'react'
import { useEffect, useState } from 'react'

import { installBackdrop } from '@/glass/backdrop'
import { cn } from '@/lib/utils'

import { VariantA } from './variant-a'
import { VariantB } from './variant-b'
import { VariantC } from './variant-c'

import './proto.css'

type VariantId = 'a' | 'b' | 'c'

const VARIANTS: readonly { id: VariantId; label: string; role: string }[] = [
  { id: 'a', label: 'A', role: 'Glass chrome' },
  { id: 'b', label: 'B', role: 'Glass content' },
  { id: 'c', label: 'C', role: 'Glass hero' },
]

/** Segmented switch across the three glass-role variants. */
function Segmented(props: { value: VariantId; onChange: (id: VariantId) => void }): JSX.Element {
  return (
    <div className="flex items-center gap-1 rounded-full bg-white/5 p-1 ring-1 ring-white/10">
      {VARIANTS.map((v) => {
        const active = v.id === props.value
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => {
              props.onChange(v.id)
            }}
            className={cn(
              'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors',
              active ? 'bg-[var(--proto-orange)] text-black' : 'text-white/60 hover:text-white',
            )}
          >
            <span className="proto-eyebrow text-[11px]">{v.label}</span>
            <span className="hidden sm:inline">{v.role}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * `/proto` — throwaway comparison of three roles for the liquid-glass
 * material. Installs the shared document backdrop (so the real refract tier
 * has its gradient to sample) and lets the owner flip between variants.
 */
export function ProtoPage(): JSX.Element {
  const [variant, setVariant] = useState<VariantId>('a')

  useEffect(() => {
    installBackdrop()
  }, [])

  return (
    <div className="proto-scope flex min-h-svh flex-col items-center bg-[var(--proto-ground)] px-4 py-5">
      <div className="mb-5 flex w-full max-w-[390px] flex-col items-center gap-3">
        <p className="proto-eyebrow text-[10px] text-white/35">Liquid glass · role study</p>
        <Segmented value={variant} onChange={setVariant} />
      </div>

      {variant === 'a' && <VariantA />}
      {variant === 'b' && <VariantB />}
      {variant === 'c' && <VariantC />}
    </div>
  )
}

export default ProtoPage
