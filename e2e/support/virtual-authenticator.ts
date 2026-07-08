import type { CDPSession, Page } from '@playwright/test'

/**
 * A CDP `WebAuthn` virtual authenticator attached to one `Page`'s browsing
 * context, and the means to detach it again.
 */
export type VirtualAuthenticator = {
  readonly authenticatorId: string
  /** Detaches the virtual authenticator from its `CDPSession`. */
  readonly remove: () => Promise<void>
}

/**
 * Registers a resident-key-capable, always-present, always-user-verified CDP
 * virtual authenticator on `page`'s browsing context, so `navigator.credentials
 * .create`/`.get` (driven by `@simplewebauthn/browser`'s `startRegistration`/
 * `startAuthentication` — see `packages/client/src/lib/passkeys.ts`) resolve
 * immediately with no native OS prompt and no human touching a sensor.
 *
 * This is the chromium DevTools Protocol's `WebAuthn` domain
 * (`WebAuthn.enable` + `WebAuthn.addVirtualAuthenticator`) — the only
 * automatable stand-in for a platform authenticator Playwright exposes.
 * `BrowserContext.newCDPSession` only works for chromium-family browsers (it
 * throws for webkit/firefox), which is exactly why `auth-passkey.spec.ts` is
 * pinned to the chromium project: see that spec's own doc comment and
 * `docs/designs/auth-accounts/design.md`'s Testing section ("Passkey specs
 * run **chromium-only** via the CDP `WebAuthn.enable` virtual authenticator
 * (webkit has no equivalent — documented, not silently skipped").
 *
 * - `hasResidentKey`/`hasUserVerification`: the enrollment ceremony
 *   (`PasskeyEnrollStart`) asks for `residentKey: "required"` and
 *   `userVerification: "preferred"` (`packages/server/src/auth/passkeys.ts`);
 *   the virtual authenticator must support both for the ceremony to succeed.
 * - `automaticPresenceSimulation` + `isUserVerified: true`: make every "test
 *   of user presence"/verification succeed the instant it's requested,
 *   rather than hanging forever waiting for a real touch.
 */
export async function addVirtualAuthenticator(page: Page): Promise<VirtualAuthenticator> {
  const client: CDPSession = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })

  return {
    authenticatorId,
    remove: async () => {
      await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
    },
  }
}
