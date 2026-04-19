import { useEffect } from 'react'
import { Keyboard, X } from 'lucide-react'
import { fmtShortcut, isMac } from '../lib/platform'

interface Props {
  open: boolean
  onClose: () => void
}

interface Shortcut {
  keys: string
  label: string
}

interface Group {
  title: string
  items: Shortcut[]
}

export default function HelpOverlay({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const mod = isMac() ? '⌘' : 'Ctrl+'
  const shift = isMac() ? '⇧' : 'Shift+'

  const groups: Group[] = [
    {
      title: 'Sessions',
      items: [
        { keys: fmtShortcut('N'), label: 'new Claude session (picker)' },
        { keys: `${mod}${shift}N`, label: 'quick-spawn session (active cwd)' },
        { keys: fmtShortcut('W'), label: 'close active session' },
        { keys: fmtShortcut('1..9'), label: 'jump to session N' },
        { keys: `${mod}[`, label: 'previous session' },
        { keys: `${mod}]`, label: 'next session' },
        { keys: 'double-click name', label: 'rename session' },
        { keys: 'right-click card', label: 'edit agent dialog' }
      ]
    },
    {
      title: 'Panels',
      items: [
        { keys: fmtShortcut('K'), label: 'command palette' },
        { keys: fmtShortcut('T'), label: 'terminals panel' },
        { keys: fmtShortcut('P'), label: 'projects drawer' },
        { keys: fmtShortcut('D'), label: 'dashboard' },
        { keys: fmtShortcut('E'), label: 'code editor' },
        { keys: fmtShortcut('`'), label: 'terminals (alias)' },
        { keys: `${mod}${shift}P`, label: 'PR inspector' },
        { keys: `${mod}${shift}W`, label: 'watchdogs' },
        { keys: `${mod}${shift}V`, label: 'voice dictation' }
      ]
    },
    {
      title: 'Editor',
      items: [
        { keys: fmtShortcut('S'), label: 'save active file' },
        { keys: 'Esc', label: 'close editor' }
      ]
    },
    {
      title: 'Help',
      items: [
        { keys: '?', label: 'toggle this overlay' },
        { keys: 'Esc', label: 'dismiss overlay / dialog' }
      ]
    }
  ]

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-bg-0/85 px-4 backdrop-blur-md df-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-xl overflow-hidden border border-border-mid bg-bg-2 shadow-pop"
        style={{ borderRadius: 'var(--radius-lg)' }}
      >
        <header className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Keyboard size={14} strokeWidth={1.75} className="text-accent-400" />
            <span className="df-label">keyboard shortcuts</span>
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

        <div className="grid max-h-[70vh] grid-cols-2 gap-4 overflow-y-auto p-4 df-scroll">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="df-label mb-2 text-accent-400">{g.title}</div>
              <div className="flex flex-col gap-1">
                {g.items.map((it, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 rounded-sm px-1 py-0.5 text-[11px]"
                  >
                    <span className="text-text-2">{it.label}</span>
                    <span className="shrink-0 rounded-sm border border-border-soft bg-bg-3 px-1.5 py-0.5 font-mono text-[10px] text-text-3">
                      {it.keys}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <footer className="flex items-center justify-center border-t border-border-soft bg-bg-1 px-4 py-2 font-mono text-[10px] text-text-4">
          press <kbd className="mx-1 rounded-sm bg-bg-3 px-1 text-text-3">?</kbd> any time ·{' '}
          <kbd className="mx-1 rounded-sm bg-bg-3 px-1 text-text-3">Esc</kbd> to close
        </footer>
      </div>
    </div>
  )
}
