import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { RotateCw, AlertTriangle, Trash2, Loader2 } from 'lucide-react'
import type { SessionMeta } from '../../shared/types'
import { useSessions } from '../state/sessions'
import { isBoundEvent } from '../state/keybinds'
import { isMac } from '../lib/platform'
import ChatView from './chat/ChatView'

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
  // Last (cols, rows) we shipped to the PTY. Both the ResizeObserver
  // and the visibility-change effect dedup against these — Claude
  // redraws its TUI on every SIGWINCH, so without dedup, every panel
  // toggle that ends back at the same size still re-renders the
  // welcome banner and pollutes the buffer.
  const lastSentColsRef = useRef(-1)
  const lastSentRowsRef = useRef(-1)
  const [exited, setExited] = useState<ExitInfo | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [starting, setStarting] = useState(true)
  /** Flipped to true by the 4s watchdog so the overlay degrades from a
   *  generic spinner into an actionable "stuck?" card with a force-open
   *  button. 12s auto-flips `starting=false` regardless. */
  const [startSlow, setStartSlow] = useState(false)
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

    const ptyId = session.ptyId

    // Clipboard shortcuts.
    //   macOS:  ⌘C copies, ⌘V pastes (standard mac terminal).
    //   Linux/Win: Ctrl+Shift+C / Ctrl+Shift+V — Ctrl+C alone has to
    //     stay reserved for SIGINT so the shell can interrupt.
    // Returning false from the handler tells xterm "don't forward this
    // keystroke to the PTY", so `C` doesn't leak into the prompt.
    const onKeyEvent = (e: KeyboardEvent): boolean => {
      // Global keybinds still win.
      if (isBoundEvent(e)) return false
      if (e.type !== 'keydown') return true
      const mac = isMac()
      const copyCombo = mac
        ? e.metaKey && !e.shiftKey && !e.ctrlKey && e.key.toLowerCase() === 'c'
        : e.ctrlKey && e.shiftKey && !e.metaKey && e.key.toLowerCase() === 'c'
      // Text paste: Cmd+V on macOS, Ctrl+Shift+V on Linux/Windows.
      // On Linux, Ctrl+V (without shift) passes through as \x16 so
      // CLI tools like Claude Code can handle image paste natively
      // via the system clipboard (xclip / wl-paste).
      const textPasteCombo = mac
        ? e.metaKey && !e.shiftKey && !e.ctrlKey && e.key.toLowerCase() === 'v'
        : e.ctrlKey && e.shiftKey && !e.metaKey && e.key.toLowerCase() === 'v'
      if (copyCombo) {
        const sel = term.getSelection()
        if (sel && sel.length > 0) {
          e.preventDefault()
          void navigator.clipboard.writeText(sel).catch(() => undefined)
        }
        return false
      }
      if (textPasteCombo) {
        e.preventDefault()
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (text) void window.api.pty.write(ptyId, text)
          })
          .catch(() => undefined)
        return false
      }
      // Shift+Enter inserts a newline instead of submitting the prompt.
      if (e.shiftKey && e.key === 'Enter') {
        e.preventDefault()
        void window.api.pty.write(ptyId, '\n')
        return false
      }
      return true
    }
    term.attachCustomKeyEventHandler(onKeyEvent)

    // Auto-copy on mouse selection — Linux "primary selection" vibe,
    // but routed through the regular system clipboard so Electron +
    // the WM agree. Skipped silently when the page isn't focused
    // (clipboard API throws a DOMException in that state).
    const selectionSub = term.onSelectionChange(() => {
      const sel = term.getSelection()
      if (!sel || sel.length === 0) return
      void navigator.clipboard.writeText(sel).catch(() => undefined)
    })
    termRef.current = term
    fitRef.current = fit

    const fitSafely = (): void => {
      try {
        fit.fit()
      } catch {
        // container may not be sized yet
      }
    }

    setStarting(true)
    setStartSlow(false)
    setExited(null)
    // Two-stage watchdog.
    //   4s: flip `startSlow=true` so the overlay says "taking longer than
    //        usual" with an escape hatch button instead of a generic spinner.
    //   12s: force-hide the overlay regardless. PTY data may have raced an
    //        HMR remount — the listener registered late and missed the
    //        first-byte broadcast (webContents.send doesn't buffer). The
    //        xterm surface stays interactive; the user can type and resume.
    const slowTimer = setTimeout(() => setStartSlow(true), 4000)
    const escapeTimer = setTimeout(() => setStarting(false), 12000)

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
      // Optimistic state flip the moment the user submits a prompt:
      // CR or LF in the byte stream means "Enter pressed, agent is
      // about to work". Flip the card to 'thinking' instantly and
      // sync the analyzer's internal cache via IPC so when its next
      // frame analysis computes 'generating' or 'userInput' the diff
      // fires correctly (without the sync the analyzer stayed at
      // 'userInput' and never emitted the correction).
      if (data.includes('\r') || data.includes('\n')) {
        useSessions.getState().patchSession(session.id, { state: 'thinking' })
        void window.api.session.syncState(session.id, 'thinking')
      }
    })

    // Resize observer: debounced PAST the longest panel-toggle animation
    // (editor/dashboard slide-pane and Ctrl+Q sessions are 520ms,
    // Ctrl+T drawer is 520ms) so the ResizeObserver doesn't fire
    // mid-animation and trigger an xterm refit that visually "flicks"
    // the terminal as it adjusts to intermediate sizes.
    //
    // Crucially: only ship the PTY resize when cols/rows ACTUALLY
    // changed. Claude Code redraws its TUI on every SIGWINCH — without
    // this dedup, opening + closing a panel back to the same width
    // still produces a SIGWINCH at settle time, Claude redraws the
    // welcome banner, and the buffer ends up with N stacked copies of
    // the welcome screen. The xterm-internal `fit.fit()` is a
    // local-only resize and is always cheap to call; the PTY round
    // trip is what we gate.
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
        if (
          cols === lastSentColsRef.current &&
          rows === lastSentRowsRef.current
        ) {
          return
        }
        lastSentColsRef.current = cols
        lastSentRowsRef.current = rows
        void window.api.pty.resize(ptyId, cols, rows)
      }, 560)
    })
    ro.observe(container)

    return () => {
      clearTimeout(slowTimer)
      clearTimeout(escapeTimer)
      if (resizeTimer) clearTimeout(resizeTimer)
      ro.disconnect()
      offData()
      offExit()
      onInput.dispose()
      selectionSub.dispose()
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
        // Same dedup as the ResizeObserver — re-showing a pane at the
        // same size shouldn't trigger another SIGWINCH redraw.
        if (
          cols !== lastSentColsRef.current ||
          rows !== lastSentRowsRef.current
        ) {
          lastSentColsRef.current = cols
          lastSentRowsRef.current = rows
          void window.api.pty.resize(session.ptyId, cols, rows)
        }
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

  const viewMode = session.viewMode ?? 'cli'
  const isVisual = viewMode === 'visual'

  return (
    <div className="relative h-full w-full">
      {/* xterm container — always mounted so PTY output keeps flowing
          to the analyzer even when the visual view is the one on top.
          Visibility toggled instead of unmount so remounting doesn't
          drop terminal state every time the user switches. */}
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{
          visibility: isVisual ? 'hidden' : 'visible',
          pointerEvents: isVisual ? 'none' : 'auto'
        }}
      />

      {isVisual ? (
        <div className="absolute inset-0">
          <ChatView session={session} visible={visible} />
        </div>
      ) : null}

      {starting && !exited ? (
        /* pointer-events: while hot, the overlay is non-interactive so it
           doesn't block clicks if data arrives milliseconds later. Once
           `startSlow` flips, the inner card becomes clickable so the user
           can force-open the terminal or restart the PTY. */
        <div
          className={`absolute inset-0 flex items-center justify-center bg-bg-1/60 backdrop-blur-[2px] ${startSlow ? '' : 'pointer-events-none'}`}
        >
          {startSlow ? (
            <div className="flex w-72 flex-col gap-2 border border-border-mid bg-bg-2 px-3 py-2.5 font-mono text-[11px] text-text-2 shadow-pop df-fade-in" style={{ borderRadius: 'var(--radius-md)' }}>
              <div className="flex items-center gap-2">
                <Loader2 size={12} strokeWidth={2} className="animate-spin text-status-thinking" />
                <span className="text-text-1">taking longer than usual…</span>
              </div>
              <p className="leading-snug text-text-3">
                No PTY output yet. This can happen after a hot-reload —
                the listener sometimes races the first byte. Opening the
                terminal manually is safe; it's live underneath.
              </p>
              <div className="flex items-center gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => setStarting(false)}
                  className="flex-1 rounded-sm border border-border-mid bg-bg-3 px-2 py-1 text-[10px] text-text-1 hover:bg-bg-4"
                >
                  open terminal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStarting(false)
                    void restart()
                  }}
                  className="flex-1 rounded-sm border border-accent-500/40 bg-accent-500/10 px-2 py-1 text-[10px] text-accent-200 hover:bg-accent-500/20"
                >
                  restart PTY
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-sm border border-border-soft bg-bg-3/90 px-3 py-2 font-mono text-[11px] text-text-3 shadow-pop df-fade-in">
              <Loader2 size={12} strokeWidth={2} className="animate-spin text-accent-400" />
              <span>warming up agent…</span>
            </div>
          )}
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
