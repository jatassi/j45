import { AccountScreen } from '@/components/account-screen'
import { AuthGate } from '@/components/auth-gate'
import { GlassDemo } from '@/glass-demo'

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
 * this switch too.
 */
export function App() {
  if (location.pathname === '/glass') {
    return <GlassDemo />
  }

  return (
    <AuthGate>{(user) => <AccountScreen user={user} onLoggedOut={handleLoggedOut} />}</AuthGate>
  )
}

export default App
