/**
 * Splitter — 4px draggable gutter between two panels.
 *
 * Pure presentational: all state (size, dragging flag, mousedown handler)
 * lives in {@link useSplitter}. This component only paints the gutter,
 * its 2px center line, a hover/active accent highlight, and — while
 * dragging — a fixed overlay that covers the whole viewport with the
 * same resize cursor.
 *
 * Why the overlay: Hydra hosts webviews / iframes inside its panels.
 * Once the native mouse crosses into one of those, the parent window
 * stops getting `mousemove` events and the drag "sticks". A top-level
 * overlay with `pointer-events: auto` intercepts every move back to the
 * renderer until the user releases.
 */
import type React from 'react'

interface Props {
  /** Axis of the SPLIT (not the gutter). `horizontal` = side-by-side
   *  panels with a vertical gutter dragged on X. */
  orientation: 'horizontal' | 'vertical'
  onMouseDown: (e: React.MouseEvent) => void
  dragging: boolean
}

export default function Splitter({ orientation, onMouseDown, dragging }: Props) {
  const isHorizontal = orientation === 'horizontal'
  const cursor = isHorizontal ? 'col-resize' : 'row-resize'

  // Gutter geometry:
  //   horizontal split → 4px wide, full height, center line is 2px wide
  //   vertical split   → 4px tall, full width, center line is 2px tall
  const gutterClass = isHorizontal
    ? 'relative h-full w-1 shrink-0'
    : 'relative w-full h-1 shrink-0'

  // Hover + active highlight. While dragging we hold the accent so the
  // gutter stays visible even when the cursor wanders off the 4px strip.
  const bgClass = dragging
    ? 'bg-accent-500/60'
    : 'bg-transparent hover:bg-accent-500/30 active:bg-accent-500/60'

  // Center line: 2px thick, dimmer than the hover accent, perpendicular
  // to the drag axis so it reads as a "rail".
  const lineClass = isHorizontal
    ? 'pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-border-mid/70'
    : 'pointer-events-none absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-border-mid/70'

  return (
    <>
      <div
        role="separator"
        aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
        onMouseDown={onMouseDown}
        style={{ cursor }}
        className={`${gutterClass} ${bgClass} z-20 transition-colors select-none`}
        data-dragging={dragging || undefined}
      >
        <div className={lineClass} />
      </div>

      {dragging && (
        <div
          aria-hidden="true"
          style={{ cursor }}
          className="fixed inset-0 z-[9999] select-none"
        />
      )}
    </>
  )
}
