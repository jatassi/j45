import { ServerInfoCard } from '@/components/server-info-card'
import { GlassDemo } from '@/glass-demo'

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
    <div className="flex min-h-svh items-center justify-center p-6">
      <ServerInfoCard />
    </div>
  )
}

export default App
