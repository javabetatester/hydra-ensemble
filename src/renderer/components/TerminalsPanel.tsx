import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { Info, Plus, Terminal as TermIcon, X } from 'lucide-react'
import { useShells, type Shell } from '../state/shells'
import { useProjects } from '../state/projects'
import { isBoundEvent } from '../state/keybinds'

interface Props {
  open: boolean
  onClose: () => void
}

export default function TerminalsPanel({ open, onClose }: Props) {
  const shells = useShells((s) => s.shells)
  const activeId = useShells((s) => s.activeId)
  const setActive = useShells((s) => s.setActive)
  const spawn = useShells((s) => s.spawn)
  const destroy = useShells((s) => s.destroy)
  const currentProject = useProjects((s) => s.projects.find((p) => p.path === s.currentPath))
  const [showExplainer, setShowExplainer] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const newShell = async (): Promise<void> => {
    const cwd = currentProject?.path ?? ''
    if (!cwd) return
    await spawn(cwd)
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-bg-2">
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
            disabled={!currentProject}
            className="flex items-center gap-1 rounded-sm border border-border-soft bg-bg-3 px-2 py-1 text-[11px] text-text-2 hover:bg-bg-4 disabled:cursor-not-allowed disabled:opacity-40"
            title="new shell"
          >
            <Plus size={11} strokeWidth={1.75} />
            new
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
      <div className="df-scroll flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border-soft bg-bg-1 px-2 pt-1.5">
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
                  active ? '' : 'opacity-0 group-hover:opacity-100'
                }`}
                aria-label="close shell"
              >
                <X size={11} strokeWidth={2} />
              </button>
            </div>
          )
        })}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-bg-1">
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
              disabled={!currentProject}
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
              <ShellPane shell={sh} visible={sh.id === activeId} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function ShellPane({ shell, visible }: { shell: Shell; visible: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

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
