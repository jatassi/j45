# packages/client

Conventions for anyone working in the React client. Keep these when adding or
changing screens and components.

## Domain labels — never render literals raw

Vocabulary values (`Modality`, `Intensity`, `MuscleGroup`, `Equipment`,
`Focus`, `FlowType`) are `Schema.Literal` strings. Never put those raw ids in
the UI.

Import the exhaustive label maps from `@j45/domain` and render the label:

- `modalityLabel`
- `intensityLabel`
- `muscleGroupLabel`
- `equipmentLabel`
- `focusLabel`
- `flowTypeLabel`

Example: `modalityLabel[exercise.modality]`, not `exercise.modality`. A generic
humanizer (title-case, replace hyphens, etc.) is never a substitute — labels
live in the domain so the vocabulary stays consistent everywhere.

## Base UI, not Radix

Primitives come from `@base-ui/react`, composed through the `ui/` kit at
`packages/client/src/components/ui/`. Screens and feature components import from
`ui/` (or re-exports that sit on top of it). Never import Radix packages
directly.

## Tokens and variants

Use the design tokens in `src/index.css` and the variants on `ui/` components.
Do not hand-style raw form elements with one-off Tailwind when a kit piece
exists.

Sport-coded semantic hues (meaning, not decoration):

- `--hue-cardio`
- `--hue-strength`
- `--hue-hybrid`
- `--hue-work`
- `--hue-rest`

Exposed via Tailwind theme (`text-hue-cardio`, etc.) for focus badges, phase
identity, and chart accents.

### Feedback-state standard

Apply on every screen:

| Situation          | Pattern                                     |
| ------------------ | ------------------------------------------- |
| Query loading      | `skeleton`                                  |
| Empty result       | `empty` with a CTA                          |
| Query failure      | inline `alert` + retry button               |
| Command failure    | `sonner` toast (nothing silently swallowed) |
| Server-pushed news | `sonner` toast, no sound (see below)        |
| Landing notice     | dismissible inline `alert` (see below)      |
| Destructive action | `alert-dialog` confirm                      |
| Reaches others     | `alert-dialog` confirm, counted (see below) |

Loading and failure must never look the same. Success stays quiet unless the
outcome is otherwise invisible on-screen.

A "landing notice" is the narrow case where a screen sends the user to
another screen and that screen must say why they are there. Today only one
does it: a session that ends sends its Participants home. It travels as a
search parameter the destination route validates, so a reload does not lose
it. It is an inline alert, not a toast: the user did not ask to be moved, so
the message must wait for them to read it, and it must be dismissible.

"Reaches others" is the narrow case where a write on the caller's own
content changes what other people see right now: today only a save into, or
a delete of, a workout that live sessions run. The confirm must state how
many sessions it reaches, and a delete must say that those sessions stop and
that there is no undo. Take the count from data the client already holds —
the lobby rows of `WatchActiveSessions` carry their `WorkoutId`. A write that
reaches nobody must not prompt, and a cosmetic write (a rename) must not
prompt at all.

This count is the one query failure the table above does not apply to. A
feed that has not answered, or one that failed, counts as nobody: the prompt
exists to stop a surprise, and it must never become the reason the owner
cannot write to their own content. Read the count live while the prompt is
open, so a late answer strengthens the wording rather than leaving a stale
zero on screen. Once a prompt states a count, the live read can only raise
it. The save prompt keeps the count it opened with. Its title says the
workout is live, so a session that ends while the host reads must not turn
that count into nobody.

"Server-pushed news" is the narrow case where the server changes something
under the user without them asking: today only a plan change reaching a live
session. Raise it from a monotonic counter on the snapshot, never by
comparing one snapshot with the next — a snapshot is republished for reasons
that are not news. The player adds no sound to it: every beep it makes
carries timing meaning.

The table above governs screens. Chrome — the tab bar, the headers — is the
second case it does not apply to. Chrome shows a live count only when there
is a count to show: no rows renders nothing, and a feed that has not
answered or that failed renders nothing as well. It shows no skeleton and no
alert. The user did not ask chrome for anything, so chrome must never report
a background failure to them, and it must never take space for news it does
not have. The tab bar's live-session count is the one piece of chrome that
does this today. It is an indicator, not a control: it carries an accessible
label that names what it counts, and the only route out of it goes to the
screen that owns the data.

## Glass: positioned wrapper gotcha

`.glass-surface` sets `position: relative` on the element it is applied to.
Tailwind positioning utilities on that **same** element (`absolute`, `fixed`,
`inset-*`, etc.) lose to it.

Put positioning on a wrapper; put `.glass-surface` (or `GlassCard`) on the
inner surface:

```tsx
// good
<div className="absolute inset-x-0 bottom-0">
  <div className="glass-surface ...">{/* chrome */}</div>
</div>

// bad — absolute is overridden by .glass-surface's position: relative
<div className="glass-surface absolute inset-x-0 bottom-0">...</div>
```
