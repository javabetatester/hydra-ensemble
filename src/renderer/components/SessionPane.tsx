import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { RotateCw, AlertTriangle, Trash2, Loader2 } from 'lucide-react'
import type { SessionMeta } from '../../shared/types'
import { useSessions } from '../state/sessions'

interface Props {
  session: SessionMeta
  visible: boolean
}

interface ExitInfo {
  exitCode: number
  signal?: number
  at: number
}

/**
 * Attaches an xterm.js view to an existing PTY identified by `session.ptyId`.
 * The PTY is owned by the main-process SessionManager — this component only
 * renders the byte stream, forwards input, and surfaces a restart overlay
 * if the PTY exits unexpectedly.
 */
export default function SessionPane({ session, visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [exited, setExited] = useState<ExitInfo | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [starting, setStarting] = useState(true)
  const destroySession = useSessions((s) => s.destroySession)

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
        cursor: '#ff6b4d',
        selectionBackground: '#ff6b4d59'
      },
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10_000,
      convertEol: false
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(container)
    termRef.current = term
    fitRef.current = fit

    const ptyId = session.ptyId

    const fitSafely = (): void => {
      try {
        fit.fit()
      } catch {
        // container may not be sized yet
      }
    }

    setStarting(true)
    setExited(null)
    const startTimeout = setTimeout(() => {
      // If we still haven't received any data after 4s, leave the overlay
      // visible so the user knows something is wrong.
    }, 4000)

    const offData = window.api.pty.onData((evt) => {
      if (evt.sessionId !== ptyId) return
      if (starting) setStarting(false)
      term.write(evt.data)
    })
    const offExit = window.api.pty.onExit((evt) => {
      if (evt.sessionId !== ptyId) return
      setStarting(false)
      setExited({ exitCode: evt.exitCode, signal: evt.signal, at: Date.now() })
      term.writeln(
        `\r\n\x1b[33m[hydra] pty exited (code=${evt.exitCode}${
          evt.signal ? `, signal=${evt.signal}` : ''
        })\x1b[0m`
      )
    })

    const onInput = term.onData((data) => {
      void window.api.pty.write(ptyId, data)
    })

    // Resize observer: debounced so a 300ms slide-in animation doesn't
    // fire dozens of intermediate resizes; clamped so we never tell the
    // PTY "cols=1" when the container is momentarily collapsed (which
    // makes claude wrap one character per line).
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth
      const h = container.clientHeight
      // Skip while hidden or not laid out yet.
      if (w < 100 || h < 50) return
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        fitSafely()
        const cols = Math.max(20, term.cols)
        const rows = Math.max(5, term.rows)
        void window.api.pty.resize(ptyId, cols, rows)
      }, 80)
    })
    ro.observe(container)

    return () => {
      clearTimeout(startTimeout)
      if (resizeTimer) clearTimeout(resizeTimer)
      ro.disconnect()
      offData()
      offExit()
      onInput.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // intentional: starting captured by closure is fine — we only care about
    // the initial value when the effect re-runs on ptyId change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.ptyId])

  // Re-fit when this pane becomes visible (it may have been hidden).
  // The container's clientWidth is briefly 0 right after display:block
  // flips, so wait a frame before fitting to get a real measurement.
  useEffect(() => {
    if (!visible) return
    const id = requestAnimationFrame(() => {
      const fit = fitRef.current
      const term = termRef.current
      const container = containerRef.current
      if (!fit || !term || !container) return
      if (container.clientWidth < 100 || container.clientHeight < 50) return
      try {
        fit.fit()
        const cols = Math.max(20, term.cols)
        const rows = Math.max(5, term.rows)
        void window.api.pty.resize(session.ptyId, cols, rows)
        term.focus()
      } catch {
        // noop
      }
    })
    return () => cancelAnimationFrame(id)
  }, [visible, session.ptyId])

  const restart = async (): Promise<void> => {
    setRestarting(true)
    try {
      const res = await window.api.session.restart(session.id)
      if (res.ok) {
        setExited(null)
        termRef.current?.clear()
      } else {
        // eslint-disable-next-line no-console
        console.error('[session] restart failed:', res.error)
      }
    } finally {
      setRestarting(false)
    }
  }

  const close = (): void => {
    void destroySession(session.id)
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {starting && !exited ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg-1/60 backdrop-blur-[2px]">
          <div className="flex items-center gap-2 rounded-sm border border-border-soft bg-bg-3/90 px-3 py-2 font-mono text-[11px] text-text-3 shadow-pop df-fade-in">
            <Loader2 size={12} strokeWidth={2} className="animate-spin text-accent-400" />
            <span>warming up agent…</span>
          </div>
        </div>
      ) : null}

      {exited ? (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-1/85 backdrop-blur-sm df-fade-in">
          <div
            className="flex w-full max-w-sm flex-col gap-3 border border-border-mid bg-bg-2 p-5 shadow-pop"
            style={{ borderRadius: 'var(--radius-lg)' }}
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-status-attention/15 text-status-attention">
                <AlertTriangle size={16} strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-1">session ended</div>
                <div className="font-mono text-[11px] text-text-3">
                  exit {exited.exitCode}
                  {exited.signal ? ` · signal ${exited.signal}` : ''}
                </div>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-text-3">
              The PTY for{' '}
              <span className="font-mono text-text-2">{session.name}</span> exited.
              Restarting respawns the shell inside the same isolated{' '}
              <code className="rounded-sm bg-bg-3 px-1 py-0.5 text-[10px] text-text-2">
                CLAUDE_CONFIG_DIR
              </code>
              , preserving history and credentials.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void restart()}
                disabled={restarting}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-sm bg-accent-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
              >
                <RotateCw
                  size={12}
                  strokeWidth={2}
                  className={restarting ? 'animate-spin' : ''}
                />
                {restarting ? 'restarting…' : 'restart'}
              </button>
              <button
                type="button"
                onClick={close}
                className="flex items-center justify-center gap-1.5 rounded-sm border border-border-soft px-3 py-1.5 text-xs text-text-2 hover:border-status-attention/50 hover:text-status-attention"
              >
                <Trash2 size={12} strokeWidth={1.75} />
                close
              </button>
            </div>
            <div className="text-center font-mono text-[10px] text-text-4">
              hint: exit 129 = SIGHUP · exit 130 = ctrl-c · exit 137 = SIGKILL
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
