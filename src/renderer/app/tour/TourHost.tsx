import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { useTour } from './store'
import type { Placement, TourStep } from './types'

/**
 * TourHost — the full-screen overlay that renders the active tour.
 *
 * Mounted once in App.tsx. When the store has an `activeId`, it:
 *  1. Resolves the anchor element by `data-tour-id=<anchor>` and
 *     `scrollIntoView`s it if it's offscreen.
 *  2. Paints a 4-rect scrim around the anchor (dark everywhere BUT the
 *     anchor's rect + a small padding). Centered steps paint a single
 *     full-screen scrim.
 *  3. Places a card next to the anchor using an auto-flip placement
 *     algorithm that picks the side with the most room.
 *  4. Wires Esc / ←  / → / Enter keyboard controls so the tour feels
 *     fast, not modal-fiddly.
 *
 * The spotlight cutout is built from 4 absolute-positioned rects
 * instead of an SVG mask — it's one line of CSS per rect, nothing to
 * browser-quirk over, and it animates position changes cleanly.
 */

const CARD_OFFSET = 14
const CARD_W = 340
const CARD_MAX_H = 260
const SPOTLIGHT_PAD = 8
/** How often to re-measure the anchor while the step is active. Cheap
 *  enough on modern machines; covers drawers that slide in on a
 *  transition and grow the anchor rect over ~200ms. */
const REMEASURE_MS = 120

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export default function TourHost() {
  const activeId = useTour((s) => s.activeId)
  const stepIndex = useTour((s) => s.stepIndex)
  const tours = useTour((s) => s.tours)
  const next = useTour((s) => s.next)
  const back = useTour((s) => s.back)
  const stop = useTour((s) => s.stop)

  const tour = activeId ? tours[activeId] : null
  const step: TourStep | null = tour?.steps[stepIndex] ?? null
  const isLast = tour ? stepIndex === tour.steps.length - 1 : false

  // Diagnostic: fires only when the store transitions to a tour id that
  // isn't registered. Happens in dev when a stale persisted activeId
  // references a tour that no longer ships; landing on a recognisable
  // console line makes the 'button did nothing' reports debuggable.
  useEffect(() => {
    if (activeId && !tour) {
      // eslint-disable-next-line no-console
      console.warn(
        `[TourHost] active tour id '${activeId}' is not in the registered ` +
          `tours map. Registered: ${Object.keys(tours).join(', ') || '(none)'}`
      )
    }
  }, [activeId, tour, tours])

  const [anchorRect, setAnchorRect] = useState<Rect | null>(null)

  // Measure the anchor every ~120ms while the step is active. Cheap
  // enough to avoid a ResizeObserver dance that also needs to attach/
  // detach when the anchor element identity changes.
  useEffect(() => {
    if (!step) {
      setAnchorRect(null)
      return
    }
    if (!step.anchor) {
      setAnchorRect(null)
      return
    }
    let cancelled = false
    const measure = (): void => {
      if (cancelled) return
      const el = document.querySelector<HTMLElement>(
        `[data-tour-id="${step.anchor}"]`
      )
      if (!el) {
        // Anchor may not be in the DOM yet (step had a `before` that opens
        // a drawer mid-transition). Try again next tick.
        setAnchorRect(null)
        return
      }
      // One-shot scroll into view if the anchor is meaningfully off-screen.
      const r = el.getBoundingClientRect()
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
      }
      setAnchorRect({ x: r.left, y: r.top, w: r.width, h: r.height })
    }
    measure()
    const timer = window.setInterval(measure, REMEASURE_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [step])

  // Run the step's `before` hook on entry and the PREVIOUS step's
  // `after` hook on exit. Tracks the prior step in a ref so we fire
  // `after` regardless of direction (next OR back) — without this, a
  // before-hook that opened a modal would leave it dangling when the
  // user navigated backwards, making "back" appear to do nothing
  // because the modal was still on screen.
  const prevStepRef = useRef<TourStep | null>(null)
  useEffect(() => {
    const prev = prevStepRef.current
    if (prev && prev !== step) {
      void prev.after?.()
    }
    prevStepRef.current = step
    if (!step) return
    if (step.skipIf?.() === true) {
      next()
      return
    }
    void step.before?.()
  }, [step, next])

  // Keyboard shortcuts. Bind at `capture` so terminals / inputs can't
  // swallow Esc when a tour is running.
  useEffect(() => {
    if (!activeId) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        stop(false)
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        next()
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        back()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [activeId, back, next, stop])

  const onFinish = useCallback(() => stop(true), [stop])

  const placement = useMemo<Placement>(() => {
    if (!step || !anchorRect) return 'center'
    if (step.placement) return step.placement
    return autoPlacement(anchorRect)
  }, [step, anchorRect])

  const cardPos = useMemo(() => {
    if (!anchorRect) return centerCard()
    return positionCard(anchorRect, placement)
  }, [anchorRect, placement])

  // When activeId is set but the tour isn't in the registry (stale
  // persisted state, hot-reload tearing down the module), show a
  // visible error card instead of silently rendering nothing — that
  // silence was the whole reason users reported 'button does nothing'.
  if (activeId && !tour) {
    return createPortal(
      <div className="fixed inset-0 z-[95] flex items-center justify-center bg-bg-0/80 backdrop-blur-sm">
        <div
          className="flex w-80 flex-col gap-3 border border-status-attention/50 bg-bg-2 px-4 py-4 shadow-pop df-fade-in"
          style={{ borderRadius: 'var(--radius-lg)' }}
        >
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-status-attention">
            <X size={12} strokeWidth={2} />
            tour not found
          </div>
          <p className="text-[12px] leading-relaxed text-text-2">
            Tried to start <code className="rounded-sm bg-bg-3 px-1.5 py-0.5 font-mono text-[10px] text-text-1">{activeId}</code> but it's not in the
            registered set. This usually means a release removed a tour
            you had persisted in localStorage. Check DevTools console for
            the registered ids.
          </p>
          <button
            type="button"
            onClick={() => stop(false)}
            className="self-end rounded-sm border border-border-mid bg-bg-3 px-3 py-1 text-[11px] text-text-1 hover:bg-bg-4"
          >
            close
          </button>
        </div>
      </div>,
      document.body
    )
  }

  if (!tour || !step) return null

  // Spotlight strategy:
  //
  //   - With an anchor → ONLY the halo + ring around the anchor; no
  //     scrim rects. The original 4-rect dim was meant to focus the
  //     eye, but it also smothered any modal that the anchor lived
  //     inside (a full app dialog at z-68 ended up under z-95 scrim
  //     rects, looking dim and broken). The pulsing halo alone is
  //     enough visual cue, and the underlying app stays readable.
  //
  //   - Without an anchor (centered step) → light backdrop instead of
  //     the previous heavy /80 + blur. The card has its own border +
  //     shadow so it stands out without darkening the entire UI.
  const scrim = anchorRect ? (
    <div
      className="pointer-events-none fixed rounded-md ring-2 ring-accent-500/70 transition-[top,left,width,height] duration-200 df-pulse"
      style={{
        left: anchorRect.x - SPOTLIGHT_PAD,
        top: anchorRect.y - SPOTLIGHT_PAD,
        width: anchorRect.w + SPOTLIGHT_PAD * 2,
        height: anchorRect.h + SPOTLIGHT_PAD * 2,
        boxShadow: '0 0 40px 4px var(--color-accent-alpha-35)'
      }}
    />
  ) : (
    <div className="pointer-events-none fixed inset-0 bg-bg-0/35" />
  )

  return createPortal(
    <div
      className="fixed inset-0 z-[95]"
      role="dialog"
      aria-modal="true"
      aria-label={`${tour.label} — step ${stepIndex + 1} of ${tour.steps.length}`}
    >
      {scrim}

      {/* Card. Bound to a viewport-relative max height so a step with a
          long body never pushes the footer (back / next / done) below
          the visible fold — that was the "toolkit step is unresponsive"
          bug: the buttons existed but lived past CARD_MAX_H + overflow-
          hidden, so clicks landed nowhere. The body scrolls; the footer
          stays anchored at the bottom of the card. */}
      <div
        style={{
          position: 'fixed',
          top: cardPos.top,
          left: cardPos.left,
          width: CARD_W,
          maxHeight: `min(${CARD_MAX_H}px, calc(100vh - 24px))`
        }}
        className="df-fade-in flex flex-col overflow-hidden border border-accent-500/40 bg-bg-2 shadow-pop"
      >
        <div
          className="flex h-1 w-full bg-border-soft"
          aria-hidden
        >
          <div
            className="h-full bg-accent-500 transition-[width] duration-300"
            style={{
              width: `${((stepIndex + 1) / tour.steps.length) * 100}%`
            }}
          />
        </div>
        <div className="flex items-start justify-between gap-3 px-4 pt-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent-400">
              {tour.label}
            </span>
            <span className="font-mono text-[10px] text-text-4">
              {stepIndex + 1} / {tour.steps.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => stop(false)}
            className="rounded-sm p-1 text-text-4 hover:bg-bg-3 hover:text-text-1"
            aria-label="Close tour"
            title="Esc"
          >
            <X size={12} strokeWidth={1.75} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-3">
          <h3 className="mb-1 text-sm font-semibold text-text-1">{step.title}</h3>
          <p className="text-[12px] leading-relaxed text-text-2">{step.body}</p>
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-border-soft bg-bg-1 px-3 py-2">
          <div className="flex items-center gap-1">
            {tour.steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  i === stepIndex
                    ? 'bg-accent-500'
                    : i < stepIndex
                      ? 'bg-accent-500/40'
                      : 'bg-border-mid'
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={back}
              disabled={stepIndex === 0}
              className="flex items-center gap-1 rounded-sm border border-border-soft bg-bg-2 px-2 py-1 font-mono text-[10px] text-text-2 hover:border-border-mid hover:text-text-1 disabled:opacity-40"
              title="Left arrow"
            >
              <ArrowLeft size={11} strokeWidth={1.75} />
              back
            </button>
            {isLast ? (
              <button
                type="button"
                onClick={onFinish}
                className="flex items-center gap-1 rounded-sm border border-accent-500/50 bg-accent-500/15 px-2.5 py-1 font-mono text-[10px] font-semibold text-accent-200 hover:bg-accent-500/25"
                title="Enter"
              >
                <Check size={11} strokeWidth={2} />
                done
              </button>
            ) : (
              <button
                type="button"
                onClick={next}
                className="flex items-center gap-1 rounded-sm border border-accent-500/50 bg-accent-500/15 px-2.5 py-1 font-mono text-[10px] font-semibold text-accent-200 hover:bg-accent-500/25"
                title="Right arrow / Enter"
              >
                next
                <ArrowRight size={11} strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------------
// placement
// ---------------------------------------------------------------------

function autoPlacement(r: Rect): Placement {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const right = vw - (r.x + r.w)
  const left = r.x
  const top = r.y
  const bottom = vh - (r.y + r.h)
  const max = Math.max(right, left, top, bottom)
  if (max === right) return 'right'
  if (max === left) return 'left'
  if (max === bottom) return 'bottom'
  return 'top'
}

function positionCard(
  r: Rect,
  placement: Placement
): { top: number; left: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const centerX = r.x + r.w / 2
  const centerY = r.y + r.h / 2

  let top = 0
  let left = 0
  if (placement === 'right') {
    left = r.x + r.w + CARD_OFFSET
    top = centerY - CARD_MAX_H / 2
  } else if (placement === 'left') {
    left = r.x - CARD_W - CARD_OFFSET
    top = centerY - CARD_MAX_H / 2
  } else if (placement === 'bottom') {
    top = r.y + r.h + CARD_OFFSET
    left = centerX - CARD_W / 2
  } else if (placement === 'top') {
    top = r.y - CARD_MAX_H - CARD_OFFSET
    left = centerX - CARD_W / 2
  } else {
    return centerCard()
  }
  // Clamp so the card never drifts off-screen (common when the anchor
  // is near the viewport edge).
  const clampedLeft = Math.min(vw - CARD_W - 12, Math.max(12, left))
  const clampedTop = Math.min(vh - CARD_MAX_H - 12, Math.max(12, top))
  return { top: clampedTop, left: clampedLeft }
}

function centerCard(): { top: number; left: number } {
  return {
    top: Math.max(12, window.innerHeight / 2 - CARD_MAX_H / 2),
    left: Math.max(12, window.innerWidth / 2 - CARD_W / 2)
  }
}
