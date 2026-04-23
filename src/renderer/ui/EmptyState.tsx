import * as React from 'react'
import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  body?: React.ReactNode
  action?: React.ReactNode
  /** Compact inline variant — used inside panels / cards. Default is
   *  the full-height centred variant. */
  compact?: boolean
  className?: string
}

/** EmptyState — unified zero-data illustration + copy + CTA. Replaces
 *  the ~8 ad-hoc "no sessions yet" / "no tasks" / "no worktrees"
 *  screens scattered across the app. */
export default function EmptyState(props: EmptyStateProps) {
  const { icon: Icon, title, body, action, compact, className } = props
  if (compact) {
    return (
      <div
        className={`flex flex-col items-center gap-1.5 rounded-md border border-dashed border-border-soft bg-bg-1 px-3 py-4 text-center ${className ?? ''}`}
      >
        {Icon ? <Icon size={18} strokeWidth={1.5} className="text-text-4" /> : null}
        <div className="text-[11px] text-text-2">{title}</div>
        {body ? <div className="text-[10px] text-text-4">{body}</div> : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    )
  }
  return (
    <div
      className={`flex h-full flex-col items-center justify-center gap-3 px-6 text-center ${className ?? ''}`}
    >
      {Icon ? (
        <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-md bg-bg-3 text-text-3">
          <Icon size={22} strokeWidth={1.5} />
        </div>
      ) : null}
      <div className="text-sm text-text-1">{title}</div>
      {body ? <div className="max-w-sm text-xs text-text-3">{body}</div> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  )
}
