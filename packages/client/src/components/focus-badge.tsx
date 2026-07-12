import { focusLabel, type Focus } from '@j45/domain'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Sport-hue badge for a workout's focus. Visible text is the human label
 * (`focusLabel[focus]`), never the raw domain literal. Shared by the library
 * list cards and the workout detail header.
 */
export function FocusBadge({
  focus,
  className,
  ...props
}: {
  readonly focus: Focus
  readonly className?: string
} & Omit<React.ComponentProps<'span'>, 'children'>) {
  return (
    <Badge variant={focus} className={cn(className)} {...props}>
      {focusLabel[focus]}
    </Badge>
  )
}
