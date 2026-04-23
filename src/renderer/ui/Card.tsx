import * as React from 'react'

interface CardProps {
  header?: React.ReactNode
  footer?: React.ReactNode
  /** Accent border (left rail). Useful for "result" / selected cards. */
  accent?: boolean
  /** Remove default padding — lets callers set their own on the body. */
  flush?: boolean
  className?: string
  children?: React.ReactNode
  onClick?: () => void
  /** When true, render as button (focusable, keyboard-enter triggers onClick). */
  interactive?: boolean
}

function cx(...parts: Array<string | false | undefined | null>): string {
  return parts.filter(Boolean).join(' ')
}

/** Card — unified shell used for session / team / task / toolkit items.
 *  Standardises the `rounded-md border border-border-soft bg-bg-1` motif
 *  that's repeated dozens of times across the app, with optional
 *  header/footer slots and accent variant. */
export default function Card(props: CardProps) {
  const {
    header,
    footer,
    accent = false,
    flush = false,
    className,
    children,
    onClick,
    interactive,
  } = props

  const outerCls = cx(
    'overflow-hidden rounded-md border bg-bg-1 transition-colors',
    accent ? 'border-accent-500/40' : 'border-border-soft hover:border-border-mid',
    interactive && 'cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500',
    className,
  )

  const body = (
    <>
      {header ? (
        <div className="border-b border-border-soft bg-bg-2 px-3 py-2">
          {header}
        </div>
      ) : null}
      <div className={flush ? '' : 'px-3 py-2.5'}>{children}</div>
      {footer ? (
        <div className="border-t border-border-soft bg-bg-2 px-3 py-2">
          {footer}
        </div>
      ) : null}
    </>
  )

  if (interactive) {
    return (
      <button type="button" onClick={onClick} className={cx('w-full text-left', outerCls)}>
        {body}
      </button>
    )
  }
  return (
    <div onClick={onClick} className={outerCls}>
      {body}
    </div>
  )
}
