import { PIN_LENGTH } from '@j45/domain'
import { REGEXP_ONLY_DIGITS } from 'input-otp'

import { Field, FieldLabel } from '@/components/ui/field'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'

type PinFieldProps = {
  readonly id: string
  readonly value: string
  readonly onChange: (value: string) => void
  /** `current-password` on login, `new-password` on register. */
  readonly autoComplete: 'current-password' | 'new-password'
  /**
   * Fires with the full PIN once the last slot is filled. Receives the value
   * as an argument because it fires alongside `onChange` — a caller reading
   * its own state instead would race the re-render.
   */
  readonly onComplete?: (pin: string) => void
}

/**
 * The one way a PIN is entered anywhere: `PIN_LENGTH` masked OTP slots,
 * digits only. Shared by the login and register screens so the slot count
 * can never drift from the domain's `Pin` schema.
 */
export function PinField({ id, value, onChange, autoComplete, onComplete }: PinFieldProps) {
  return (
    <Field orientation="vertical">
      <FieldLabel htmlFor={id}>PIN</FieldLabel>
      <InputOTP
        id={id}
        maxLength={PIN_LENGTH}
        pattern={REGEXP_ONLY_DIGITS}
        inputMode="numeric"
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        onComplete={onComplete}
        containerClassName="justify-center"
        required
      >
        <InputOTPGroup className="gap-2.5">
          {Array.from({ length: PIN_LENGTH }, (_, index) => (
            <InputOTPSlot key={index} index={index} masked />
          ))}
        </InputOTPGroup>
      </InputOTP>
    </Field>
  )
}
