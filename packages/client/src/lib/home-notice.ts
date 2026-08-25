/**
 * The explanation home shows somebody who has just been sent there. It
 * travels as the `notice` search parameter of `/`, so it survives the
 * navigation and shows once the new screen paints.
 *
 * - `session-ended` — the session they were in is over: they left it, or it
 *   finished, or everybody else went away.
 * - `plan-deleted` — the host removed the workout, so the session ended
 *   under them. This is not the same thing, and it must not read the same:
 *   a deleted plan will not come back.
 *
 * Anything else in the parameter is not a notice. `homeNotice` returns
 * `undefined` for it, and home shows nothing — a hand-typed or stale url
 * must never make the screen fail to render.
 */
export type HomeNotice = 'session-ended' | 'plan-deleted'

/** The notice a raw search value stands for, or `undefined` if it is none. */
export const homeNotice = (value: unknown): HomeNotice | undefined =>
  value === 'session-ended' || value === 'plan-deleted' ? value : undefined

/** What each notice says, as home reads it out. */
export const HOME_NOTICE_TEXT: Record<HomeNotice, { title: string; description: string }> = {
  'session-ended': {
    title: 'Session ended',
    description: 'The session you were in is over.',
  },
  'plan-deleted': {
    title: 'The plan was deleted',
    description: 'The host removed this workout, so the session ended. Your work was recorded.',
  },
}
