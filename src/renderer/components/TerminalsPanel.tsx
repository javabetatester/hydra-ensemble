import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import {
  ArrowDownToLine,
  ArrowRightToLine,
  Check,
  Clipboard,
  ClipboardPaste,
  Info,
  MoreHorizontal,
  Plus,
  Terminal as TermIcon,
  X
} from 'lucide-react'
import { useShells, type Shell } from '../state/shells'
import { useProjects } from '../state/projects'
import { useSessions } from '../state/sessions'
import { useTerminalsPanel, type TerminalsPosition } from '../state/panels'
import { isBoundEvent } from '../state/keybinds'

interface Props {
  open: boolean
  onClose: () => void
}

// Registry keyed by shell.id so the header toolbar can read the
// selection state and issue copy/paste against the currently active
// xterm without threading refs through React props.
const termRegistry = new Map<string, Terminal>()

export default function TerminalsPanel({ open, onClose }: Props) {
  const shells = useShells((s) => s.shells)
  const activeId = useShells((s) => s.activeId)
  const setActive = useShells((s) => s.setActive)
  const spawn = useShells((s) => s.spawn)
  const destroy = useShells((s) => s.destroy)
  const currentProject = useProjects((s) => s.projects.find((p) => p.path === s.currentPath))
  const activeSession = useSessions((s) => s.sessions.find((x) => x.id === s.activeId))
  const [showExplainer, setShowExplainer] = useState(false)
  // Re-render tick bumped on selection change so the Copy button's
  // disabled state tracks the live xterm selection.
  const [selTick, setSelTick] = useState(0)
  const [canPaste, setCanPaste] = useState(false)
  // Floating context menu position for the terminal area. `null` = closed.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  // View menu (three-dot) anchor rect. `null` = closed.
  const [viewMenu, setViewMenu] = useState<{
    left: number
    top: number
  } | null>(null)
  const viewBtnRef = useRef<HTMLButtonElement>(null)
  const position = useTerminalsPanel((s) => s.position)
  const setPosition = useTerminalsPanel((s) => s.setPosition)

  const activeTerm = activeId ? termRegistry.get(activeId) ?? null : null
  const hasSelection = !!activeTerm && activeTerm.hasSelection()
  void selTick

  // Poll clipboard readability so Paste disables when empty. We can't
  // subscribe to clipboard events from the renderer reliably, so this
  // runs while the panel is open and when focus returns.
  useEffect(() => {
    if (!open) return
    let alive = true
    const refresh = async (): Promise<void> => {
      try {
        const txt = await navigator.clipboard.readText()
        if (alive) setCanPaste(!!txt)
      } catch {
        if (alive) setCanPaste(false)
      }
    }
    void refresh()
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      window.removeEventListener('focus', onFocus)
    }
  }, [open, activeId])

  const doCopy = async (): Promise<void> => {
    if (!activeTerm || !activeTerm.hasSelection()) return
    const sel = activeTerm.getSelection()
    if (!sel) return
    try {
      await navigator.clipboard.writeText(sel)
    } catch {
      // noop
    }
  }

  const doPaste = async (): Promise<void> => {
    if (!activeId) return
    try {
      const txt = await navigator.clipboard.readText()
      if (!txt) return
      await window.api.pty.write(activeId, txt)
    } catch {
      // noop
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Close context menu on outside click / scroll / resize / Escape.
  useEffect(() => {
    if (!ctxMenu) return
    const onDown = (): void => setCtxMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setCtxMenu(null)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('wheel', onDown, { passive: true })
    window.addEventListener('resize', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('wheel', onDown)
      window.removeEventListener('resize', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

  // Close view menu on outside click / scroll / resize / Escape.
  useEffect(() => {
    if (!viewMenu) return
    const dismiss = (): void => setViewMenu(null)
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node | null
      if (t && viewBtnRef.current?.contains(t)) return
      setViewMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setViewMenu(null)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('wheel', dismiss, { passive: true })
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('wheel', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', onKey)
    }
  }, [viewMenu])

  const openViewMenu = (): void => {
    const r = viewBtnRef.current?.getBoundingClientRect()
    if (!r) return
    // Menu is ~180px wide; anchor its RIGHT edge to the button's right edge
    // so it opens inward from the header's top-right corner.
    const left = Math.max(8, r.right - 180)
    setViewMenu({ left, top: r.bottom + 4 })
  }

  const newShell = async (): Promise<void> => {
    const cwd =
      activeSession?.worktreePath ??
      activeSession?.cwd ??
      currentProject?.path ??
      ''
    if (!cwd) return
    await spawn(cwd)
  }

  return (
    <div
      className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-bg-2"
      style={{ display: open ? 'flex' : 'none' }}
      aria-hidden={!open}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border-soft bg-bg-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <TermIcon size={14} strokeWidth={1.75} className="text-accent-400" />
          <span className="font-semibold text-text-1">terminals</span>
          <span className="font-mono text-[10px] text-text-4">
            · {shells.length} {shells.length === 1 ? 'shell' : 'shells'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowExplainer((v) => !v)}
            className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-[10px] text-text-4 hover:bg-bg-3 hover:text-text-1"
            title="what is this?"
          >
            <Info size={11} strokeWidth={1.75} />
            what?
          </button>
          <button
            type="button"
            onClick={() => void newShell()}
            disabled={!activeSession && !currentProject}
            className="flex items-center gap-1 rounded-sm border border-border-soft bg-bg-3 px-2 py-1 text-[11px] text-text-2 hover:bg-bg-4 disabled:cursor-not-allowed disabled:opacity-40"
            title="new shell"
          >
            <Plus size={11} strokeWidth={1.75} />
            new
          </button>
          <button
            ref={viewBtnRef}
            type="button"
            onClick={() => (viewMenu ? setViewMenu(null) : openViewMenu())}
            className={`rounded-sm p-1.5 hover:bg-bg-3 hover:text-text-1 ${
              viewMenu ? 'bg-bg-3 text-text-1' : 'text-text-3'
            }`}
            aria-label="view options"
            aria-haspopup="menu"
            aria-expanded={!!viewMenu}
            title="view options"
          >
            <MoreHorizontal size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1.5 text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="close"
            title="Esc"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {showExplainer ? (
        <div className="border-b border-border-soft bg-bg-1 px-4 py-3 text-[11px] leading-relaxed text-text-3">
          <p className="mb-1.5">
            <strong className="text-text-2">Terminals</strong> — plain shells you can run beside
            your Claude agents. Use them for <code className="rounded-sm bg-bg-3 px-1 font-mono">npm run dev</code>,{' '}
            <code className="rounded-sm bg-bg-3 px-1 font-mono">tail -f log</code>,{' '}
            <code className="rounded-sm bg-bg-3 px-1 font-mono">htop</code>, or any side process
            you want to monitor.
          </p>
          <p>
            Each tab is an independent PTY tied to the current project's cwd. Multiple shells
            mean you can serve frontend + backend + watch tests in parallel without losing your
            agent terminal.
          </p>
        </div>
      ) : null}

      {/* tabs */}
      <div
        data-tour-id="terminals-tabs"
        className="df-scroll flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border-soft bg-bg-1 px-2 pt-1.5"
      >
        {shells.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-text-4">no shells — click "new"</div>
        ) : null}
        {shells.map((sh) => {
          const active = sh.id === activeId
          return (
            <div
              key={sh.id}
              className={`group flex items-center gap-2 rounded-t-sm px-2.5 py-1 text-[11px] ${
                active
                  ? '-mb-px border-t-2 border-accent-500 bg-bg-1 text-text-1'
                  : 'mt-0.5 border-t-2 border-transparent bg-bg-3 text-text-3 hover:bg-bg-4 hover:text-text-2'
              }`}
            >
              <button
                type="button"
                onClick={() => setActive(sh.id)}
                className="max-w-[10rem] truncate text-left font-mono"
                title={`${sh.name} — ${sh.cwd}`}
              >
                {sh.name}
              </button>
              <button
                type="button"
                onClick={() => void destroy(sh.id)}
                className={`rounded-sm p-0.5 text-text-4 hover:bg-bg-4 hover:text-status-attention ${
                  active ? '' : 'df-hover-reveal group-hover:opacity-100'
                }`}
                aria-label="close shell"
              >
                <X size={11} strokeWidth={2} />
              </button>
            </div>
          )
        })}
      </div>

      <div
        className="relative min-h-0 flex-1 overflow-hidden bg-bg-1"
        onContextMenu={(e) => {
          if (shells.length === 0) return
          e.preventDefault()
          setCtxMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {shells.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <TermIcon size={32} strokeWidth={1.25} className="text-text-4" />
            <div className="text-sm text-text-2">no shell yet</div>
            <div className="max-w-xs text-xs text-text-4">
              spawn a plain shell to run dev servers, tests, log tails, anything.
            </div>
            <button
              type="button"
              onClick={() => void newShell()}
              disabled={!activeSession && !currentProject}
              className="mt-2 flex items-center gap-1.5 rounded-sm bg-accent-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600 disabled:opacity-40"
            >
              <Plus size={13} strokeWidth={2} />
              new shell
            </button>
          </div>
        ) : (
          shells.map((sh) => (
            <div
              key={sh.id}
              className="absolute inset-0"
              style={{ display: sh.id === activeId ? 'block' : 'none' }}
            >
              <ShellPane
                shell={sh}
                visible={sh.id === activeId}
                onSelectionChange={() => setSelTick((n) => n + 1)}
              />
            </div>
          ))
        )}
      </div>

      {ctxMenu
        ? createPortal(
            <TerminalCtxMenu
              x={ctxMenu.x}
              y={ctxMenu.y}
              canCopy={hasSelection}
              canPaste={!!activeId && canPaste}
              onCopy={() => {
                void doCopy()
                setCtxMenu(null)
              }}
              onPaste={() => {
                void doPaste()
                setCtxMenu(null)
              }}
            />,
            document.body
          )
        : null}

      {viewMenu
        ? createPortal(
            <ViewMenu
              left={viewMenu.left}
              top={viewMenu.top}
              position={position}
              onPick={(p) => {
                setPosition(p)
                setViewMenu(null)
              }}
            />,
            document.body
          )
        : null}
    </div>
  )
}

interface ViewMenuProps {
  left: number
  top: number
  position: TerminalsPosition
  onPick: (p: TerminalsPosition) => void
}

function ViewMenu({ left, top, position, onPick }: ViewMenuProps) {
  return (
    <div
      className="fixed z-50 min-w-[180px] overflow-hidden rounded-md border border-border-mid bg-bg-2 py-1 text-xs text-text-2 shadow-xl shadow-black/40"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
      role="menu"
    >
      <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-4">
        view
      </div>
      <ViewMenuItem
        label="Dock bottom"
        hint="below chat"
        icon={<ArrowDownToLine size={12} strokeWidth={1.75} />}
        selected={position === 'bottom'}
        onClick={() => onPick('bottom')}
      />
      <ViewMenuItem
        label="Dock right"
        hint="side panel"
        icon={<ArrowRightToLine size={12} strokeWidth={1.75} />}
        selected={position === 'side'}
        onClick={() => onPick('side')}
      />
    </div>
  )
}

function ViewMenuItem({
  label,
  hint,
  icon,
  selected,
  onClick
}: {
  label: string
  hint: string
  icon: ReactNode
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-3"
    >
      <span className="text-text-3">{icon}</span>
      <span className="flex-1">
        <span className="text-text-1">{label}</span>
        <span className="ml-2 text-[10px] text-text-4">{hint}</span>
      </span>
      {selected ? (
        <Check size={12} strokeWidth={2} className="text-accent-400" />
      ) : (
        <span className="w-3" />
      )}
    </button>
  )
}

interface TerminalCtxMenuProps {
  x: number
  y: number
  canCopy: boolean
  canPaste: boolean
  onCopy: () => void
  onPaste: () => void
}

function TerminalCtxMenu({ x, y, canCopy, canPaste, onCopy, onPaste }: TerminalCtxMenuProps) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.min(x, vw - 170)
  const top = Math.min(y, vh - 90)
  return (
    <div
      className="fixed z-50 min-w-[160px] overflow-hidden rounded-md border border-border-mid bg-bg-2 py-1 text-xs text-text-2 shadow-xl shadow-black/40"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
      role="menu"
    >
      <button
        type="button"
        role="menuitem"
        onClick={onCopy}
        disabled={!canCopy}
        title={canCopy ? undefined : 'select text first'}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-3 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Clipboard size={12} strokeWidth={1.75} />
        <span>Copy</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onPaste}
        disabled={!canPaste}
        title={canPaste ? undefined : 'clipboard is empty'}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-3 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ClipboardPaste size={12} strokeWidth={1.75} />
        <span>Paste</span>
      </button>
    </div>
  )
}

function ShellPane({
  shell,
  visible,
  onSelectionChange
}: {
  shell: Shell
  visible: boolean
  onSelectionChange?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const selCbRef = useRef(onSelectionChange)
  selCbRef.current = onSelectionChange

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily:
        'JetBrains Mono Variable, "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      theme: {
        background: '#0e0e10',
        foreground: '#f5f5f2',
        cursor: '#ff6b4d'
      },
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10_000
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(container)
    // Swallow bound global shortcuts so they don't leak as literal input
    // into the shell. App.tsx still dispatches the action via a window
    // capture listener.
    term.attachCustomKeyEventHandler((e) => !isBoundEvent(e))
    termRef.current = term
    fitRef.current = fit
    termRegistry.set(shell.id, term)
    const selSub = term.onSelectionChange(() => {
      selCbRef.current?.()
    })

    const offData = window.api.pty.onData((evt) => {
      if (evt.sessionId === shell.id) term.write(evt.data)
    })
    const onInput = term.onData((data) => {
      void window.api.pty.write(shell.id, data)
    })
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w < 100 || h < 50) return
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        try {
          fit.fit()
          const cols = Math.max(20, term.cols)
          const rows = Math.max(5, term.rows)
          void window.api.pty.resize(shell.id, cols, rows)
        } catch {
          // noop
        }
      }, 80)
    })
    ro.observe(container)

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      ro.disconnect()
      offData()
      onInput.dispose()
      selSub.dispose()
      termRegistry.delete(shell.id)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [shell.id])

  useEffect(() => {
    if (!visible) return
    const id = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
        termRef.current?.focus()
      } catch {
        // noop
      }
    })
    return () => cancelAnimationFrame(id)
  }, [visible])

  return <div ref={containerRef} className="h-full w-full" />
}
