/**
 * CoachMarks — first-time contextual tooltips inside the Orchestra view.
 *
 * Four-step tour pointing at the four primary regions of the layout:
 *   0. Team rail        [data-coach="team-rail"]
 *   1. Canvas           [data-coach="canvas"]
 *   2. Inspector        [data-coach="inspector"]
 *   3. Task bar         [data-coach="task-bar"]
 *
 * The tour mounts only when Orchestra is open AND the user hasn't
 * completed/skipped it yet. Positioning is resolved at render time by
 * querying the DOM for `[data-coach="..."]` — those attributes are added
 * by the owning components (TeamRail / Canvas / Inspector / TaskBar) in
 * a separate integration task. If a target is missing (e.g. a collapsed
 * sidebar), we fall back to a centered tooltip instead of crashing.
 *
 * See PRD.md §13 (empty states & onboarding).
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useDiscovery } from './state/discovery'

interface Props {
  open: boolean
}

interface CoachStep {
  target: string
  title: string
  body: string
  /** Preferred placement relative to the target. */
  placement: 'right' | 'left' | 'above' | 'below'
}

const STEPS: ReadonlyArray<CoachStep> = [
  {
    target: 'team-rail',
    title: 'Your teams live here',
    body: 'Switch between teams or create a new one from this rail.',
    placement: 'right'
  },
  {
    target: 'canvas',
    title: 'Drop agents on the canvas',
    body: 'Drag agents in, wire reporting edges, and watch activity flow live.',
    placement: 'below'
  },
  {
    target: 'inspector',
    title: 'Inspector shows the selected agent',
    body: 'Click any agent to see its transcript, prompts, and recent routes.',
    placement: 'left'
  },
  {
    target: 'task-bar',
    title: 'Submit tasks here',
    body: 'Type a task, pick a team, and watch the router assign it in real time.',
    placement: 'above'
  }
]

const TOOLTIP_WIDTH = 280
const TOOLTIP_GAP = 12
const RESIZE_DEBOUNCE_MS = 100

/** Subset of a DOMRect we actually need — keeps the fallback path trivial
 *  (no need to synthesise a full DOMRect when the target is missing). */
interface Rect {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

const rectFrom = (el: Element): Rect => {
  const r = el.getBoundingClientRect()
  return {
    top: r.top,
    left: r.left,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height
  }
}

/** Convert a target rect + placement into tooltip `{top,left}` in
 *  viewport pixels. Clamps to the viewport so a tooltip never renders
 *  off-screen even if the target is flush against an edge. */
function positionFor(rect: Rect, placement: CoachStep['placement']): {
  top: number
  left: number
} {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let top = 0
  let left = 0

  switch (placement) {
    case 'right':
      top = rect.top + rect.height / 2 - 40
      left = rect.right + TOOLTIP_GAP
      break
    case 'left':
      top = rect.top + rect.height / 2 - 40
      left = rect.left - TOOLTIP_WIDTH - TOOLTIP_GAP
      break
    case 'above':
      top = rect.top - TOOLTIP_GAP - 110
      left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2
      break
    case 'below':
      top = rect.bottom + TOOLTIP_GAP
      left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2
      break
  }

  // Clamp to viewport with an 8px safe margin.
  const margin = 8
  left = Math.min(Math.max(margin, left), vw - TOOLTIP_WIDTH - margin)
  top = Math.min(Math.max(margin, top), vh - 140 - margin)
  return { top, left }
}

export default function CoachMarks({ open }: Props): ReactElement | null {
  const completed = useDiscovery((s) => s.coachMarksCompleted)
  const step = useDiscovery((s) => s.currentCoachStep)
  const startCoachMarks = useDiscovery((s) => s.startCoachMarks)
  const advanceCoachStep = useDiscovery((s) => s.advanceCoachStep)
  const completeCoachMarks = useDiscovery((s) => s.completeCoachMarks)

  const active = open && !completed
  // `STEPS[step]` can be `undefined` under `noUncheckedIndexedAccess`; coerce
  // to `null` so the downstream nullability is explicit.
  const current: CoachStep | null =
    active && step < STEPS.length ? (STEPS[step] ?? null) : null

  // Resolved tooltip position recomputed on mount, step change, and resize.
  const [pos, setPos] = useState<{ top: number; left: number; centered: boolean }>({
    top: 0,
    left: 0,
    centered: false
  })

  const recompute = useCallback(() => {
    if (!current) return
    const el = document.querySelector(`[data-coach="${current.target}"]`)
    if (!el) {
      if (import.meta.env?.DEV) {
        // Debug-only breadcrumb; the production build silently falls back
        // to a centered tooltip so the tour still makes progress.
        console.warn(
          `[CoachMarks] target [data-coach="${current.target}"] not found — rendering centered`
        )
      }
      const vw = window.innerWidth
      const vh = window.innerHeight
      setPos({
        top: vh / 2 - 70,
        left: vw / 2 - TOOLTIP_WIDTH / 2,
        centered: true
      })
      return
    }
    const rect = rectFrom(el)
    const { top, left } = positionFor(rect, current.placement)
    setPos({ top, left, centered: false })
  }, [current])

  // Kick the tour on first mount while active.
  useEffect(() => {
    if (!active) return
    startCoachMarks()
    // `startCoachMarks` is stable from zustand; no dep churn.
  }, [active, startCoachMarks])

  // Resolve position on step change.
  useEffect(() => {
    if (!current) return
    // Defer to next frame so any layout from step-triggered DOM changes
    // has committed before we measure.
    const raf = window.requestAnimationFrame(recompute)
    return () => window.cancelAnimationFrame(raf)
  }, [current, recompute])

  // Resize listener (debounced) keeps tooltips glued to their targets
  // when the user drags the window or a resizable panel.
  useEffect(() => {
    if (!current) return
    let timer: number | null = null
    const onResize = (): void => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(recompute, RESIZE_DEBOUNCE_MS)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [current, recompute])

  // Esc skips the tour entirely.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        completeCoachMarks()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, completeCoachMarks])

  const isLast = useMemo(() => step >= STEPS.length - 1, [step])

  if (!active || !current) return null

  const handleNext = (): void => {
    if (isLast) {
      completeCoachMarks()
    } else {
      advanceCoachStep()
    }
  }

  const handleSkip = (): void => {
    completeCoachMarks()
  }

  return (
    <>
      {/* Backdrop — clicking advances. No hole-punch in MVP; the dimming
          is subtle enough that the target remains visible. */}
      <div
        onClick={handleNext}
        aria-hidden
        className="fixed inset-0 z-[70] bg-bg-0/40"
      />

      {/* Tooltip card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="coach-title"
        className="df-fade-in fixed z-[71] border bg-bg-2 shadow-pop border-border-mid"
        style={{
          top: pos.top,
          left: pos.left,
          width: TOOLTIP_WIDTH,
          borderRadius: 'var(--radius-md)'
        }}
      >
        <div className="px-3 pt-3">
          <div id="coach-title" className="text-sm font-semibold text-text-1">
            {current.title}
          </div>
          <div className="mt-1 text-[12px] leading-snug text-text-3">
            {current.body}
          </div>
          {pos.centered ? (
            <div className="mt-1 text-[10px] italic text-text-4">
              (target not visible — tooltip centered)
            </div>
          ) : null}
        </div>
        <div className="mt-3 flex items-center justify-between px-3 pb-2.5">
          <span className="text-[11px] text-text-4">
            {step + 1} / {STEPS.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSkip}
              className="rounded px-2 py-1 text-[12px] text-text-2 hover:text-text-1"
            >
              Skip tour
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="rounded border border-border-mid bg-bg-3 px-2.5 py-1 text-[12px] font-medium text-text-1 hover:bg-bg-1"
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
