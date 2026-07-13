import type { ComponentProps, JSX } from 'react'
import { useRef } from 'react'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import type { GlassOptions } from './use-liquid-glass'
import { useLiquidGlass } from './use-liquid-glass'

/**
 * A shadcn `Card` upgraded to a liquid-glass surface: the component itself is
 * unchanged, composed here with the `glass-surface` class and `useLiquidGlass`,
 * which measures the card's corner radius from its computed `border-radius`.
 * Takes every prop `Card` takes, plus `glass` to override the material knobs
 * (refraction strength, chroma, blur, …) per surface.
 */
export function GlassCard(
  props: ComponentProps<typeof Card> & { glass?: Partial<GlassOptions> },
): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const { className, glass, ...rest } = props
  useLiquidGlass(ref, glass)
  return <Card {...rest} ref={ref} className={cn('glass-surface', className)} />
}
