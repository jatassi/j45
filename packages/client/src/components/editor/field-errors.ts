import type { DraftFieldError } from '@/lib/workout-draft'

/**
 * The decode-failure field errors surfaced by `decodeDraftDetailed`, threaded
 * into the editor sections so each control can render its own message in the
 * kit's `FieldError` slot — no page-level banner. Paths are the pinned
 * dot-joined ParseResult paths (e.g. `pods.0.stations.1.name`).
 */
export type FieldErrors = readonly DraftFieldError[]

/** First message pinned to `path`, or `undefined` when that field decodes. */
export const errorAt = (errors: FieldErrors, path: string): string | undefined =>
  errors.find((error) => error.path === path)?.message
