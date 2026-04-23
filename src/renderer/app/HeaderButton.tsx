import * as React from 'react'

export interface HeaderButtonProps {
  icon: React.ReactNode
  label: string
  shortcut?: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  /** Anchor value for guided tours (src/renderer/app/tour). */
  dataTourId?: string
}

/** Icon + label header button used across App.tsx's top chrome. Kept
 *  as its own module so the shell isn't carrying helper declarations
 *  inline. Retains the exact visual grammar of the previous inline
 *  copy — no behavioural change. */
export default function HeaderButton({
  icon,
  label,
  shortcut,
  onClick,
  disabled,
  active,
  dataTourId
}: HeaderButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-tour-id={dataTourId}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`group flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-3 ${
        active
          ? 'border-accent-500/40 bg-accent-500/10 text-accent-200'
          : 'border-transparent text-text-3 hover:border-border-soft hover:bg-bg-3 hover:text-text-1'
      }`}
    >
      {icon}
      <span className="font-mono">{label}</span>
      {shortcut ? (
        <span
          aria-hidden
          className="hidden rounded-sm bg-bg-3 px-1 py-px font-mono text-[9px] text-text-4 group-hover:text-text-2 lg:inline"
        >
          {shortcut}
        </span>
      ) : null}
    </button>
  )
}
