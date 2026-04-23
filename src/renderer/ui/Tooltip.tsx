import * as React from 'react'

interface TooltipProps {
  label: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** ms before showing after hover/focus. Prevents jitter on quick
   *  passes. Default 400. */
  delay?: number
  children: React.ReactElement
}

/** Minimal tooltip — no portal, no collision detection. The native
 *  `title` attribute works great for chrome elements and we reach for
 *  this primitive only when we need richer content (JSX). Keep it
 *  lean until we have a real need for Radix-scale behaviour. */
export default function Tooltip({ label, side = 'top', delay = 400, children }: TooltipProps) {
  const [open, setOpen] = React.useState(false)
  const timer = React.useRef<number | null>(null)

  const show = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(true), delay)
  }
  const hide = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    setOpen(false)
  }

  React.useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  const position = POSITION[side]

  // Clone the child and attach listeners; avoids wrapping it in an
  // extra div that'd shift layout.
  const child = React.cloneElement(children, {
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
  } as React.HTMLAttributes<HTMLElement>)

  return (
    <span className="relative inline-flex">
      {child}
      {open ? (
        <span
          role="tooltip"
          className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-sm border border-border-mid bg-bg-3 px-1.5 py-0.5 font-mono text-[10px] text-text-1 shadow-pop ${position}`}
        >
          {label}
        </span>
      ) : null}
    </span>
  )
}

const POSITION: Record<NonNullable<TooltipProps['side']>, string> = {
  top: 'bottom-full left-1/2 mb-1 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-1 -translate-x-1/2',
  left: 'right-full top-1/2 mr-1 -translate-y-1/2',
  right: 'left-full top-1/2 ml-1 -translate-y-1/2',
}
