import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Form label. Association is supplied by the caller via `htmlFor` (or by
 * wrapping a control as children) — both are part of the native label API
 * and are forwarded through props.
 */
function Label({ className, htmlFor, children, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      htmlFor={htmlFor}
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </label>
  )
}

export { Label }
