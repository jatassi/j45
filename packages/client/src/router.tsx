import type { User } from '@j45/domain'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'

import { AccountScreen } from '@/components/account-screen'
import { LibraryScreen } from '@/components/library-screen'
import { TimerScreen } from '@/components/timer-screen'
import { WorkoutDetailScreen } from '@/components/workout-detail-screen'
import { EditWorkoutScreen, NewWorkoutScreen } from '@/components/workout-editor-screen'

/**
 * Everything a routed screen needs that isn't itself route state: the
 * authenticated `User` and the logout callback `AuthGate`'s caller
 * (`app.tsx`) owns. `AuthGate` stays outside the router (see its own doc
 * comment) and hands both down through `RouterProvider`'s `context` prop —
 * re-supplied on every render, so a fresh `user`/`onLoggedOut` always
 * reaches the routes that need them (currently just `/account`) without the
 * router itself knowing anything about auth.
 */
export type RouterContext = {
  readonly user: User
  readonly onLoggedOut: () => void
}

/**
 * The root of the code-based route tree (no file-based codegen, per the
 * design). Renders only an `Outlet` — everything else is one of its
 * children, matched by path.
 */
const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
})

/** `/` — the library home. */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LibraryScreen,
})

/**
 * `/account` — the existing `AccountScreen`, now routed; reads
 * `RouterContext` for the `user`/`onLoggedOut` `RouterProvider` supplies.
 * `useRouteContext()` types its result off the *globally registered*
 * router, not this route tree's own generics — with no such registration
 * here (see the `router` doc comment below) it comes back as `any`, so the
 * assertion is what actually recovers `RouterContext`'s shape.
 */
const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  component: () => {
    const { user, onLoggedOut } = accountRoute.useRouteContext() as RouterContext
    return <AccountScreen user={user} onLoggedOut={onLoggedOut} />
  },
})

/** `/timer` — the manual interval timer, run entirely client-side. */
const timerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/timer',
  component: TimerScreen,
})

/**
 * `/workouts/new` — the editor on a blank draft. A static segment, so it
 * outranks `/workouts/$workoutId` (which would otherwise capture `new` as an
 * id) in TanStack Router's specificity ordering.
 */
const workoutNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workouts/new',
  component: NewWorkoutScreen,
})

/** `/workouts/$workoutId` — `WorkoutDetailScreen`, keyed off the `workoutId` path param. */
const workoutDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workouts/$workoutId',
  component: WorkoutDetailScreen,
})

/** `/workouts/$workoutId/edit` — the editor on the draft loaded from `GetWorkout`. */
const workoutEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workouts/$workoutId/edit',
  component: EditWorkoutScreen,
})

/**
 * `/$` — the catch-all: any authenticated path the tree above doesn't
 * match (most notably `/register?invite=…`, the post-registration landing
 * — `AuthGate` renders `RegisterScreen` there while anonymous, but once
 * `RegisterScreen`'s success flips the gate over, `RouterProvider` mounts
 * on that same path and this app has no `/register` screen of its own) is
 * redirected to `/` from `beforeLoad`, before anything unmatched ever
 * renders. A bare `$` path segment is TanStack Router's splat/catch-all —
 * it matches any path, but every route above is strictly more specific, so
 * this only ever wins when nothing else does.
 */
const notFoundRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$',
  beforeLoad: () => {
    // `redirect`'s own `throw: true` (rather than a `throw redirect(...)`
    // statement here) does the throwing from *inside* the call — `redirect`
    // returns a `Response`, not an `Error`, which oxlint's type-aware
    // `only-throw-error` rule (correctly) won't let this file's own code throw.
    redirect({ to: '/', throw: true })
  },
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  timerRoute,
  workoutNewRoute,
  workoutDetailRoute,
  workoutEditRoute,
  accountRoute,
  notFoundRedirectRoute,
])

/**
 * The single router instance for the app, created once at module scope
 * (matching `rpc-client.ts`'s `ServerRpcClient` and `auth-gate.tsx`'s
 * `meAtom`). `context` here is a placeholder only — `RouterProvider` in
 * `app.tsx` overrides it with the real `user`/`onLoggedOut` on every render,
 * which is required because a root route created via
 * `createRootRouteWithContext` demands *some* context at construction time.
 *
 * Deliberately *not* registered as TanStack Router's global `Register`
 * router (its documented "Register your router" step, which needs an
 * `interface` for TypeScript's declaration merging — incompatible with this
 * project's `consistent-type-definitions: type` lint rule, and not worth a
 * project-wide carve-out for one file's route-level typing). `Link`'s `to`
 * therefore accepts any string rather than only known paths, and
 * `accountRoute`'s `useRouteContext()` above needs its own `as RouterContext`.
 */
export const router = createRouter({
  routeTree,
  context: {
    user: undefined as unknown as User,
    onLoggedOut: () => undefined,
  },
})
