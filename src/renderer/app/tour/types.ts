/**
 * Declarative tour schema.
 *
 * Each tour is a named sequence of steps. A step points at a
 * `data-tour-id` attribute somewhere in the DOM and renders a card
 * explaining that surface. Optional `before` and `skipIf` hooks let
 * tours orchestrate prerequisites (open the drawer before pointing at
 * a button inside it) or short-circuit steps that don't apply to the
 * current state (skip the 'Spawn first session' step when the user
 * already has sessions running).
 */

export type Placement = 'top' | 'bottom' | 'left' | 'right' | 'center'

export interface TourStep {
  /** Value of the `data-tour-id` attribute on the element to highlight.
   *  Use `null` for centered steps (intros, outros) that have no anchor. */
  anchor: string | null
  /** Short, imperative title. "Spawn a session", not "Session spawning". */
  title: string
  /** One to three sentences of copy. Keep it tight; the user should
   *  read and move on, not study. */
  body: string
  /** Where to place the card relative to the anchor. Default auto-picks
   *  whichever side has more room. Centered steps ignore this. */
  placement?: Placement
  /** Optional async hook that runs before the step is shown — e.g. open
   *  a drawer so its contents are visible before we highlight them. */
  before?: () => void | Promise<void>
  /** Runs AFTER the user advances past this step (leaving). Useful for
   *  closing a drawer we opened with `before`. */
  after?: () => void | Promise<void>
  /** Skip the step when this returns true. Prevents broken highlights
   *  when the anchor legitimately isn't present (e.g. Orchestra closed). */
  skipIf?: () => boolean
}

export interface Tour {
  id: string
  label: string
  description: string
  steps: ReadonlyArray<TourStep>
}
