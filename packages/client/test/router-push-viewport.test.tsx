// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import type { PasskeySummary } from '@j45/domain'
import { ServerInfo } from '@j45/domain'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import type * as Stream from 'effect/Stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '@/app'
import { ServerRpcClient } from '@/lib/rpc-client'
import { router } from '@/router'

import { emptyLobby } from './lobby-feed'

// Glass hooks touch canvas / ResizeObserver on mount; this suite only reads
// the push layout's box contract out of the DOM.
vi.mock('@/glass/use-liquid-glass', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useLiquidGlass: vi.fn(),
}))
vi.mock('@/glass/use-scene-surface', () => ({ useSceneSurface: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'wakeLock')
})

/**
 * `pushViewportRoute`'s column (`router.tsx`): the one box sized to exactly
 * the dynamic viewport, holding the `PushHeader` and the leaf below it.
 * `h-dvh`, not `min-h-dvh` — a floor lets a tall leaf grow the column and
 * push its own bottom edge below the fold again.
 */
const PUSH_COLUMN_CLASSES = ['flex', 'h-dvh', 'flex-col'] as const

/** Any viewport height a `/timer` shell must no longer claim for itself. */
const VIEWPORT_HEIGHT_CLASS = /\b(?:min-|max-)?h-(?:d|s|l)vh\b/

/** Tailwind's positioning utilities — anything that becomes a containing block. */
const POSITIONED_CLASSES = ['relative', 'absolute', 'fixed', 'sticky'] as const

/**
 * The nearest positioned ancestor of `el`, stopping at (and including)
 * `stopAt`. What `absolute` insets on `el` actually resolve against.
 */
function positionedAncestorOf(el: Element, stopAt: Element): Element | null {
  let node: Element | null = el.parentElement
  while (node !== null) {
    const box: Element = node
    if (POSITIONED_CLASSES.some((className) => box.classList.contains(className))) {
      return box
    }
    if (box === stopAt) {
      return null
    }
    node = box.parentElement
  }
  return null
}

/** Builds a `Runtime` serving `ServerRpcClient` from `handlers` — the shared fake-runtime idiom. */
function makeFakeRuntime(
  handlers: Partial<
    Record<
      string,
      (payload: unknown) => Effect.Effect<unknown, unknown> | Stream.Stream<unknown, unknown>
    >
  >,
) {
  const client = (tag: string, payload: unknown) => {
    const handler = handlers[tag]
    if (handler === undefined) {
      throw new Error(`unexpected rpc call: ${tag}`)
    }
    return handler(payload)
  }
  return Runtime.defaultRuntime.pipe(Runtime.provideService(ServerRpcClient, client as never))
}

const userJson = { id: 'u1', username: 'jill', displayName: 'Jill Owner', role: 'owner' as const }

/** The nearest ancestor of `el` that is the push layout's viewport column. */
function pushColumnOf(el: Element | null): Element | null {
  let node: Element | null = el
  while (node !== null) {
    const box: Element = node
    if (PUSH_COLUMN_CLASSES.every((className) => box.classList.contains(className))) {
      return box
    }
    node = node.parentElement
  }
  return null
}

/**
 * Renders the app authenticated, with just the handlers the push leaves and
 * Home need. `router` is a module-scope singleton that keeps its location
 * between tests, so every test navigates to the route it reads.
 */
function renderApp(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string) => {
      if (path === '/auth/me') {
        return Promise.resolve(Response.json({ user: userJson }, { status: 200 }))
      }
      throw new Error(`unexpected fetch to ${path}`)
    }),
  )

  const fakeRuntime = makeFakeRuntime({
    WatchActiveSessions: emptyLobby,
    ServerInfo: () =>
      Effect.succeed(
        new ServerInfo({
          sha: 'abc1234',
          version: '0.0.1',
          serverTime: DateTime.unsafeMake('2026-07-08T00:00:00.000Z'),
        }),
      ),
    ListPasskeys: () => Effect.succeed([] as readonly PasskeySummary[]),
  })

  render(
    <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
      <App />
    </RegistryProvider>,
  )
}

describe('router.tsx push-layout viewport box', () => {
  it(
    '/timer fills the viewport the sticky PushHeader leaves — idle and running, the shell is a ' +
      'flex-1 child of the layout column, never a viewport-height box of its own, so the ' +
      "bottom-anchored ControlDock lands above the fold rather than a header's height below it",
    async () => {
      renderApp()
      await act(async () => {
        await router.navigate({ to: '/timer' })
      })

      // Idle. The shell must take the column's leftover height, not its own
      // viewport height — the header sits above it and is real layout — and
      // it scrolls, because the column will not grow for a tall form.
      const idleShell = await screen.findByTestId('timer-screen')
      const column = pushColumnOf(idleShell)
      expect(column).not.toBeNull()
      expect(VIEWPORT_HEIGHT_CLASS.test(idleShell.className)).toBe(false)
      expect(idleShell.classList.contains('flex-1')).toBe(true)
      expect(idleShell.classList.contains('overflow-y-auto')).toBe(true)
      // A direct child: `flex-1` only resolves against the flex column itself.
      expect(idleShell.parentElement).toBe(column)
      // That column carries the header whose height is being left behind.
      expect(column?.querySelector('[data-testid="back-button"]')).not.toBeNull()

      // Running. Same contract, and this is the one that matters: the dock is
      // anchored to the shell's bottom edge, so the shell's bottom edge has to
      // be the viewport's.
      fireEvent.click(screen.getByTestId('start-button'))
      const runShell = screen.getByTestId('timer-screen')
      expect(VIEWPORT_HEIGHT_CLASS.test(runShell.className)).toBe(false)
      expect(runShell.classList.contains('flex-1')).toBe(true)
      expect(runShell.classList.contains('relative')).toBe(true)
      expect(runShell.classList.contains('overflow-hidden')).toBe(true)
      expect(runShell.parentElement).toBe(column)

      // The dock is `absolute bottom-0`, so its bottom edge is the bottom edge
      // of its nearest positioned ancestor. That has to be the shell itself:
      // a positioned wrapper in the run view's own flow would only line the two
      // up while the content above happens to fit.
      const dock = screen.getByTestId('player-control-dock')
      expect(runShell.contains(dock)).toBe(true)
      expect(dock.classList.contains('absolute')).toBe(true)
      expect(dock.classList.contains('bottom-0')).toBe(true)
      expect(positionedAncestorOf(dock, runShell)).toBe(runShell)
    },
  )

  it('/account keeps the plain flowing push layout — no viewport-height box above it, so the document stays its scroll container', async () => {
    renderApp()
    await act(async () => {
      await router.navigate({ to: '/account' })
    })

    const accountScreen = await screen.findByTestId('account-screen')
    const backButton = document.querySelector('[data-testid="back-button"]')

    // The shared push header is still there…
    expect(backButton).not.toBeNull()
    // …but neither it nor the screen sits in `/timer`'s viewport column, so
    // the document is still what scrolls here.
    expect(pushColumnOf(accountScreen)).toBeNull()
    expect(pushColumnOf(backButton)).toBeNull()
  })
})
