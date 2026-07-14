import * as React from 'react'

import type { SlotProps } from 'input-otp'
import { OTPInput, OTPInputContext } from 'input-otp'
import { MinusIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * A slot can outrun the context (fewer typed characters than rendered
 * slots), so every field falls back to its empty state. `.at`, not
 * `[index]`: typed `| undefined` under both tsc's noUncheckedIndexedAccess
 * and oxlint-tsgolint (which ignores that flag), so the `?.`s satisfy both
 * checkers.
 */
function slotStateAt(
  slots: readonly SlotProps[],
  index: number,
): { char: string | null; hasFakeCaret: boolean; isActive: boolean } {
  const slot = slots.at(index)
  return {
    char: slot?.char ?? null,
    hasFakeCaret: slot?.hasFakeCaret ?? false,
    isActive: slot?.isActive ?? false,
  }
}

function InputOTP({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<typeof OTPInput> & {
  containerClassName?: string
}) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn('flex items-center gap-2 has-disabled:opacity-50', containerClassName)}
      className={cn('disabled:cursor-not-allowed', className)}
      {...props}
    />
  )
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="input-otp-group" className={cn('flex items-center', className)} {...props} />
  )
}

function InputOTPSlot({
  index,
  masked = false,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  index: number
  /** Render a dot instead of the typed character — for PIN-style secrets. */
  masked?: boolean
}) {
  const { char, hasFakeCaret, isActive } = slotStateAt(
    React.useContext(OTPInputContext).slots,
    index,
  )
  const maskedChar = masked ? '•' : char

  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      className={cn(
        'relative flex h-14 w-12 items-center justify-center rounded-lg border border-input text-2xl shadow-xs transition-all outline-none aria-invalid:border-destructive data-[active=true]:z-10 data-[active=true]:border-ring data-[active=true]:ring-3 data-[active=true]:ring-ring/50 data-[active=true]:aria-invalid:border-destructive data-[active=true]:aria-invalid:ring-destructive/20 dark:bg-input/30 dark:data-[active=true]:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    >
      {char === null ? null : maskedChar}
      {hasFakeCaret ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-px animate-caret-blink bg-foreground duration-1000" />
        </div>
      ) : null}
    </div>
  )
}

function InputOTPSeparator({ ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="input-otp-separator" role="separator" {...props}>
      <MinusIcon />
    </div>
  )
}

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator }
