import { useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, PlayCircle, Search, X } from 'lucide-react'
import { ACTIONS, allBindings, useKeybinds } from '../state/keybinds'
import { formatCombo } from '../lib/keybind'

interface Props {
  open: boolean
  onClose: () => void
}

interface Row {
  label: string
  combo: string
  /**
   * Optional action id. When set, the row represents a dynamic keybind from
   * ACTIONS and will reflect user overrides. Static rows leave this empty.
   */
  actionId?: string
}

interface Section {
  title: string
  rows: Row[]
}

/**
 * Section order shown in the overlay. We keep a fixed taxonomy so the user
 * always finds the same bucket in the same spot regardless of which rows
 * matched the current search query.
 */
const GROUP_ORDER = [
  'Navigation',
  'Sessions',
  'Orchestra',
  'Editor',
  'Chat / Session Pane'
] as const

type Group = (typeof GROUP_ORDER)[number]

/**
 * Which static section should host each dynamic action id. When an action
 * lives in ACTIONS (so the user may rebind it) we want to render it under
 * the discoverable section header rather than in a generic "Panels" bucket.
 * Every action listed in the task's "Required additions" maps into one of
 * the five sections below.
 */
const ACTION_TO_GROUP: Record<string, Group> = {
  'palette.open': 'Navigation',
  'panel.dashboard': 'Navigation',
  'panel.editor': 'Navigation',
  'panel.watchdogs': 'Navigation',
  'panel.pr': 'Navigation',
  'panel.terminals': 'Navigation',
  'drawer.projects': 'Navigation',
  'orchestra.open': 'Navigation',

  'session.new': 'Sessions',
  'session.quickSpawn': 'Sessions',
  'session.close': 'Sessions',
  'session.prev': 'Sessions',
  'session.next': 'Sessions'
}

/**
 * Static rows per section. These fill in shortcuts that aren't registered
 * in the ACTIONS registry (either handled deep inside a module like the
 * editor / chat composer, or hardcoded globals such as `?` and `Esc`).
 *
 * The `ensureCovered` helper below merges these with the dynamic ACTIONS
 * set so user-overridden combos always show the current bound value while
 * the hardcoded ones remain visible and discoverable.
 */
const STATIC_SECTIONS: Record<Group, Row[]> = {
  // Labels here intentionally mirror the `label` strings in ACTIONS
  // (state/keybinds.ts) for rows that have a matching action id — the
  // merge step keys off label equality (case-insensitive) so keeping
  // them aligned prevents the dynamic override row from appearing as a
  // near-duplicate of the static row.
  Navigation: [
    { label: 'Command palette', combo: 'mod+k' },
    { label: 'Spotlight search', combo: 'mod+shift+p' },
    { label: 'Dashboard', combo: 'mod+d' },
    { label: 'Code editor', combo: 'mod+e' },
    { label: 'Watchdogs', combo: 'mod+shift+w' },
    { label: 'PR inspector', combo: 'mod+shift+p' },
    { label: 'Terminals panel', combo: 'mod+backquote' },
    { label: 'Projects drawer', combo: 'mod+t' },
    { label: 'Open Orchestra', combo: 'mod+shift+a' }
  ],
  Sessions: [
    { label: 'New session (picker)', combo: 'mod+n' },
    { label: 'Quick-spawn (active cwd)', combo: 'mod+shift+n' },
    { label: 'Close active session', combo: 'mod+w' },
    { label: 'Previous session', combo: 'mod+[' },
    { label: 'Next session', combo: 'mod+]' },
    { label: 'Jump to session 1', combo: 'mod+1' },
    { label: 'Jump to session 2', combo: 'mod+2' },
    { label: 'Jump to session 3', combo: 'mod+3' },
    { label: 'Jump to session 4', combo: 'mod+4' },
    { label: 'Jump to session 5', combo: 'mod+5' },
    { label: 'Jump to session 6', combo: 'mod+6' },
    { label: 'Jump to session 7', combo: 'mod+7' },
    { label: 'Jump to session 8', combo: 'mod+8' },
    { label: 'Jump to session 9', combo: 'mod+9' }
  ],
  Orchestra: [
    { label: 'New agent at canvas', combo: 'a' },
    { label: 'Remove selected agent', combo: 'delete' },
    { label: 'Fit to screen', combo: 'mod+0' },
    { label: 'Focus task creation', combo: '/' },
    { label: 'Agent wizard', combo: 'mod+shift+k' },
    { label: 'New task', combo: 'mod+shift+n' },
    { label: 'Orchestra settings', combo: 'mod+,' },
    { label: 'Team health', combo: 'mod+b' },
    { label: 'Orchestra help', combo: '?' }
  ],
  Editor: [
    { label: 'Find in file', combo: 'mod+f' },
    { label: 'Find in project', combo: 'mod+shift+f' },
    { label: 'Replace', combo: 'mod+h' },
    { label: 'Save', combo: 'mod+s' },
    { label: 'Open file', combo: 'mod+p' }
  ],
  'Chat / Session Pane': [
    { label: 'Send', combo: 'enter' },
    { label: 'Newline', combo: 'shift+enter' },
    { label: 'Toggle thinking', combo: 'alt+t' },
    { label: 'Focus composer', combo: 'mod+/' },
    { label: 'Stop streaming', combo: 'escape' }
  ]
}

/**
 * Merge a dynamic binding into the section rows. If an entry with the
 * same (case-insensitive) label already exists we overwrite its combo so
 * the table always shows the user's current bound key. Otherwise we
 * append the dynamic row to the section so newly registered actions still
 * surface in the cheatsheet even if we forgot to list them in the static
 * block above.
 */
function mergeDynamic(rows: Row[], label: string, combo: string, actionId: string): Row[] {
  const idx = rows.findIndex((r) => r.label.toLowerCase() === label.toLowerCase())
  if (idx >= 0) {
    const next = rows.slice()
    const base = next[idx]
    if (!base) return next
    next[idx] = { ...base, combo, actionId }
    return next
  }
  return [...rows, { label, combo, actionId }]
}

export default function KeyboardCheatsheet({ open, onClose }: Props) {
  const overrides = useKeybinds((s) => s.overrides)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (open) {
      setQuery('')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const sections: Section[] = useMemo(() => {
    // Start from a deep copy of the static catalogue so we can safely mutate.
    const bucket = new Map<Group, Row[]>()
    for (const title of GROUP_ORDER) {
      bucket.set(title, STATIC_SECTIONS[title].map((r) => ({ ...r })))
    }

    // Overlay dynamic ACTIONS onto the appropriate section. This is how
    // user-overridden combos show the current value — the static row for
    // the same label gets its combo replaced with the live binding.
    for (const { action, combo } of allBindings(overrides)) {
      const group = ACTION_TO_GROUP[action.id]
      if (!group) continue
      const existing = bucket.get(group) ?? []
      bucket.set(group, mergeDynamic(existing, action.label, combo, action.id))
    }

    // Also surface any ACTIONS that slipped past the mapping (future-proofing:
    // if someone adds a new action without touching this file it still shows
    // up rather than disappearing silently).
    const mappedIds = new Set(Object.keys(ACTION_TO_GROUP))
    const overflow: Row[] = []
    for (const { action, combo } of allBindings(overrides)) {
      if (mappedIds.has(action.id)) continue
      overflow.push({ label: action.label, combo, actionId: action.id })
    }

    const needle = query.trim().toLowerCase()
    const filter = (rows: Row[]): Row[] => {
      if (!needle) return rows
      return rows.filter((r) => {
        const pretty = formatCombo(r.combo).toLowerCase()
        return (
          r.label.toLowerCase().includes(needle) ||
          r.combo.toLowerCase().includes(needle) ||
          pretty.includes(needle)
        )
      })
    }

    const ordered: Section[] = GROUP_ORDER.map((title) => ({
      title,
      rows: filter(bucket.get(title) ?? [])
    }))

    if (overflow.length > 0) {
      const filtered = filter(overflow)
      if (filtered.length > 0) ordered.push({ title: 'Other', rows: filtered })
    }

    return ordered.filter((s) => s.rows.length > 0)
  }, [overrides, query])

  const totalVisible = sections.reduce((n, s) => n + s.rows.length, 0)

  const handleTour = (): void => {
    window.dispatchEvent(new CustomEvent('app:open-tour', { detail: { id: 'classic-overview' } }))
    onClose()
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-bg-0/85 px-4 backdrop-blur-md df-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex w-full max-w-5xl flex-col overflow-hidden border border-border-mid bg-bg-2 shadow-pop"
        style={{ borderRadius: 'var(--radius-lg)' }}
      >
        <header className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Keyboard size={14} strokeWidth={1.75} className="text-accent-400" />
            <span className="df-label">keyboard cheatsheet</span>
            <span className="font-mono text-[10px] text-text-4">
              · {totalVisible} shortcut{totalVisible === 1 ? '' : 's'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="close"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </header>

        <div className="border-b border-border-soft bg-bg-1 px-4 py-2">
          <div className="flex items-center gap-2 rounded-sm border border-border-soft bg-bg-2 px-2 py-1.5 focus-within:border-accent-500/50">
            <Search size={12} strokeWidth={1.75} className="text-text-4" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="filter by action or key…"
              className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-text-1 placeholder:text-text-4 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="rounded-sm p-0.5 text-text-4 hover:bg-bg-3 hover:text-text-1"
                aria-label="clear filter"
              >
                <X size={10} strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>

        <div className="df-scroll max-h-[70vh] overflow-y-auto p-4">
          {sections.length === 0 ? (
            <div className="py-10 text-center font-mono text-[11px] text-text-4">
              no shortcuts match <span className="text-text-2">"{query}"</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-6 gap-y-5 lg:grid-cols-2">
              {sections.map((section) => (
                <div key={section.title}>
                  <div className="df-label mb-2 text-accent-400">{section.title}</div>
                  <table className="w-full border-collapse">
                    <tbody>
                      {section.rows.map((row, i) => (
                        <tr
                          key={`${section.title}-${i}-${row.label}`}
                          className="group border-b border-border-soft/40 last:border-b-0 hover:bg-bg-3/50"
                        >
                          <td className="py-1 pr-2 text-[11px] text-text-2">{row.label}</td>
                          <td className="py-1 pl-2 text-right align-middle">
                            {row.combo ? (
                              <ComboChips combo={row.combo} />
                            ) : (
                              <span className="font-mono text-[10px] text-text-4">unbound</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border-soft bg-bg-1 px-4 py-2 font-mono text-[10px] text-text-4">
          <button
            type="button"
            onClick={handleTour}
            className="inline-flex items-center gap-1.5 rounded-sm border border-border-soft bg-bg-2 px-2 py-1 text-[10px] text-text-2 hover:border-accent-500/50 hover:bg-bg-3 hover:text-text-1"
          >
            <PlayCircle size={12} strokeWidth={1.75} className="text-accent-400" />
            view tour
          </button>
          <span>
            press <kbd className="mx-1 rounded-sm bg-bg-3 px-1 text-text-3">?</kbd> or{' '}
            <kbd className="mx-1 rounded-sm bg-bg-3 px-1 text-text-3">Esc</kbd> to close
          </span>
        </footer>
      </div>
    </div>
  )
}

/** Render a combo string as a row of individual <kbd> pills. */
function ComboChips({ combo }: { combo: string }) {
  // formatCombo returns a pretty string with `+` separators on non-mac
  // platforms and bare symbols on mac. Splitting on `+` keeps the chip
  // density readable on both.
  const pretty = formatCombo(combo)
  const tokens = pretty.includes('+') ? pretty.split('+') : [pretty]
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-0.5">
      {tokens.map((t, i) => (
        <kbd
          key={`${t}-${i}`}
          className="rounded-sm border border-border-mid bg-bg-3 px-1 py-0.5 font-mono text-[10px] text-text-2"
        >
          {t}
        </kbd>
      ))}
    </span>
  )
}
