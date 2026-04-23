import * as React from 'react'
import { ChevronDown, Check } from 'lucide-react'

export interface DropdownOption<V extends string = string> {
  value: V
  label: React.ReactNode
  description?: React.ReactNode
  disabled?: boolean
}

interface DropdownProps<V extends string> {
  options: ReadonlyArray<DropdownOption<V>>
  value: V
  onChange: (next: V) => void
  placeholder?: React.ReactNode
  className?: string
  ariaLabel?: string
  /** Menu alignment relative to the trigger. */
  align?: 'start' | 'end'
}

/** Dropdown — controlled select-like menu with richer option content
 *  than a native <select>. Used by TeamSwitcher, SafeMode cycler,
 *  session context menu triggers. Keeps keyboard (Esc closes, Enter
 *  selects focused option) and click-outside semantics identical
 *  across every consumer. */
export default function Dropdown<V extends string>(props: DropdownProps<V>) {
  const { options, value, onChange, placeholder, className, ariaLabel, align = 'start' } = props
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  const current = options.find((o) => o.value === value)

  React.useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (!rootRef.current) return
      if (e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className={`relative inline-block ${className ?? ''}`}>
      <button
        type="button"
        aria-label={ariaLabel ?? 'dropdown'}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 items-center gap-1.5 rounded-sm border border-border-mid bg-bg-2 px-2 text-xs text-text-1 hover:bg-bg-3 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
      >
        <span className="truncate">{current?.label ?? placeholder ?? 'select'}</span>
        <ChevronDown size={12} strokeWidth={1.75} className="text-text-3" />
      </button>
      {open ? (
        <div
          role="listbox"
          className={`absolute z-[70] mt-1 min-w-[10rem] overflow-hidden rounded-md border border-border-mid bg-bg-1 py-1 shadow-pop df-fade-in ${
            align === 'end' ? 'right-0' : 'left-0'
          }`}
        >
          {options.map((opt) => {
            const selected = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={opt.disabled}
                onClick={() => {
                  if (opt.disabled) return
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-xs transition-colors ${
                  selected
                    ? 'bg-accent-500/10 text-accent-200'
                    : 'text-text-2 hover:bg-bg-3 hover:text-text-1'
                } ${opt.disabled ? 'cursor-not-allowed opacity-40' : ''}`}
              >
                <span className="mt-0.5 h-3 w-3 shrink-0">
                  {selected ? <Check size={12} strokeWidth={2} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-text-1">{opt.label}</span>
                  {opt.description ? (
                    <span className="block truncate font-mono text-[10px] text-text-4">
                      {opt.description}
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
