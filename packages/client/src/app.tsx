import { useEffect } from 'react'

import { RouterProvider } from '@tanstack/react-router'

import { AuthGate } from '@/components/auth-gate'
import { DesignPage } from '@/components/design/design-page'
import { Toaster } from '@/components/ui/sonner'
import { GlassDemo } from '@/glass-demo'
import { GlassLab } from '@/glass-lab/glass-lab'
import { installBackdrop } from '@/glass/backdrop'
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
 * renders the liquid-glass e2e demo, `/glass-lab` the glass refinement
 * bench, `/design` the design-system gallery,
 * everything else the existing landing page. The server's static route
 * falls back to `index.html` for any path (`packages/server/src/routes.ts`),
 * so a direct load of `/glass` or `/design` reaches this switch too.
 * `/glass`'s and `/design`'s e2e suites run unauthenticated and must keep
 * passing, so these checks stay *outside* `AuthGate` — the router (and
 * therefore every rpc-backed route) never mounts for them.
 *
 * Everything else renders behind `AuthGate`: anonymous visitors (including
 * deep links like `/workouts/<id>`) see `LoginScreen` first, since the gate
 * never redirects — once `GET /auth/me` succeeds, `RouterProvider` mounts
 * and renders whatever path the browser was already on.
 *
 * `Toaster` is mounted once for every route this app serves so command
 * failures (e.g. exercise create/update/delete) can surface sonner toasts
 * outside the design gallery.
 */
export function App() {
  // The document-anchored backdrop every glass surface refracts a slice of.
  // Idempotent — the demo/design routes that install it themselves (for
  // standalone e2e runs) just repaint the same element.
  useEffect(() => {
    installBackdrop()
  }, [])

  let tree: React.ReactNode

  if (location.pathname === '/glass') {
    tree = <GlassDemo />
  } else if (location.pathname === '/glass-lab') {
    tree = <GlassLab />
  } else if (location.pathname === '/proto') {
    tree = <ProtoPage />
  } else if (location.pathname === '/design') {
    tree = <DesignPage />
  } else {
    tree = (
      <AuthGate>
        {(user) => (
          <RouterProvider router={router} context={{ user, onLoggedOut: handleLoggedOut }} />
        )}
      </AuthGate>
    )
  }

  return (
    <>
      {tree}
      <Toaster />
    </>
  )
}

export default App
