import * as React from 'react'

interface ResizeHandleProps {
  /** Which edge of the container this handle sits on. Affects cursor
   *  and the sign of the delta applied to the controlled value. */
  edge: 'left' | 'right' | 'top' | 'bottom'
  /** Current size in pixels. */
  value: number
  /** Called on each pointermove with a clamped size. */
  onChange: (next: number) => void
  /** Inclusive lower bound. */
  min: number
  /** Inclusive upper bound. */
  max: number
  className?: string
  ariaLabel?: string
}

/** Drag-to-resize handle used by Inspector, terminals strip, slide
 *  panel, editor sidebar. Replaces three near-identical hand-rolled
 *  copies in App.tsx + orchestra/lib/useSplitter. rAF batches so
 *  drags over tens of thousands of pixels don't queue a frame per
 *  mousemove. */
export default function ResizeHandle(props: ResizeHandleProps) {
  const { edge, value, onChange, min, max, className, ariaLabel } = props
  const axis: 'x' | 'y' = edge === 'left' || edge === 'right' ? 'x' : 'y'
  const cursor = axis === 'x' ? 'ew-resize' : 'ns-resize'
  // Left handles on a right-anchored panel AND bottom handles on a
  // top-anchored panel grow the panel when the pointer moves IN,
  // which is the opposite sign of the raw delta. Encoded here so
  // callers don't have to think about it.
  const sign =
    edge === 'left' || edge === 'top' ? -1 : 1

  const onDown = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      const start = axis === 'x' ? e.clientX : e.clientY
      const startValue = value
      let pending: number | null = null
      let raf: number | null = null

      const flush = (): void => {
        if (pending !== null) onChange(pending)
        raf = null
      }

      const onMove = (ev: MouseEvent): void => {
        const here = axis === 'x' ? ev.clientX : ev.clientY
        const delta = (here - start) * sign
        const next = Math.min(max, Math.max(min, startValue + delta))
        pending = next
        if (raf === null) raf = window.requestAnimationFrame(flush)
      }

      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        if (raf !== null) {
          window.cancelAnimationFrame(raf)
          flush()
        }
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = cursor
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [axis, sign, value, onChange, min, max, cursor],
  )

  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={ariaLabel ?? 'resize'}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onMouseDown={onDown}
      style={{ cursor }}
      className={className}
    />
  )
}
