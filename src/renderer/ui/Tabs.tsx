import * as React from 'react'

export interface TabDef<K extends string = string> {
  key: K
  label: React.ReactNode
  disabled?: boolean
}

interface TabsProps<K extends string> {
  tabs: ReadonlyArray<TabDef<K>>
  value: K
  onChange: (key: K) => void
  ariaLabel?: string
  /** When true, the strip scrolls horizontally and vertical mouse
   *  wheel drives scrollLeft (handy for Inspector's 7-tab row). */
  scroll?: boolean
  className?: string
}

/** Tabs — horizontal strip of buttons bound to a controlled `value`.
 *  Used by Inspector (7 tabs), editor file strip, session tabs, team
 *  tabs. Keeps the pill/underline style identical across surfaces. */
export default function Tabs<K extends string>(props: TabsProps<K>) {
  const { tabs, value, onChange, ariaLabel, scroll = false, className } = props
  return (
    <div
      role="tablist"
      aria-label={ariaLabel ?? 'tabs'}
      className={`${scroll ? 'df-scroll overflow-x-auto overflow-y-hidden whitespace-nowrap' : ''} flex items-center gap-0.5 border-b border-border-soft bg-bg-2 px-2 py-1.5 ${className ?? ''}`}
      onWheel={
        scroll
          ? (e) => {
              if (e.currentTarget.scrollWidth > e.currentTarget.clientWidth) {
                e.currentTarget.scrollLeft += e.deltaY
              }
            }
          : undefined
      }
    >
      {tabs.map((t) => {
        const selected = t.key === value
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={t.disabled}
            onClick={() => onChange(t.key)}
            className={`shrink-0 rounded-sm px-2 py-1 text-[11px] font-medium lowercase transition ${
              selected
                ? 'bg-accent-500/15 text-accent-400'
                : 'text-text-3 hover:bg-bg-3 hover:text-text-1'
            } ${t.disabled ? 'cursor-not-allowed opacity-40' : ''}`}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
