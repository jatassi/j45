import { RouterProvider } from '@tanstack/react-router'

import { AuthGate } from '@/components/auth-gate'
import { GlassDemo } from '@/glass-demo'
import { ProtoPage } from '@/proto/proto-page'
import { router } from '@/router'

/**
 * `AuthGate`'s `meAtom` session probe is private to `auth-gate.tsx` — the
 * only way to flip it (and therefore the gate) back to its anonymous state
 * after logout is to reload the page, which redoes the whole atom registry
 * (and, with it, that probe) from scratch against the now-cleared session
 * cookie.
 */
const handleLoggedOut = (): void => {
  globalThis.location.reload()
}

/**
 * Switches on `location.pathname` with no router dependency: `/glass`
 * renders the liquid-glass demo, everything else the existing landing page.
 * The server's static route falls back to `index.html` for any path
 * (`packages/server/src/routes.ts`), so a direct load of `/glass` reaches
 * this switch too. `/glass`'s own e2e suite runs unauthenticated and must
 * keep passing unchanged, so this check stays *outside* `AuthGate` — the
 * router (and therefore every rpc-backed route) never mounts for it.
 *
 * Everything else renders behind `AuthGate`: anonymous visitors (including
 * deep links like `/workouts/<id>`) see `LoginScreen` first, since the gate
 * never redirects — once `GET /auth/me` succeeds, `RouterProvider` mounts
 * and renders whatever path the browser was already on.
 */
export function App() {
  if (location.pathname === '/glass') {
    return <GlassDemo />
  }

  if (location.pathname === '/proto') {
    return <ProtoPage />
  }

  return (
    <AuthGate>
      {(user) => (
        <RouterProvider router={router} context={{ user, onLoggedOut: handleLoggedOut }} />
      )}
    </AuthGate>
  )
}

export default App
