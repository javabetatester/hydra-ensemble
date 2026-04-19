import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

/**
 * Minimal terminal shell rendered by the quick-term BrowserWindow
 * (`?mode=quick`). The PTY is spawned by the main process when the
 * window first becomes visible (`QuickTermService.show`); this
 * component only attaches an xterm view to the well-known PTY id.
 */
const QUICK_PTY_ID = 'quick-term'

export default function QuickTerminalApp() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily:
        'ui-monospace, "JetBrains Mono", "IBM Plex Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#0d0d0f',
        foreground: '#e6e6e6',
        cursor: '#7aa2f7',
        selectionBackground: '#33415540'
      },
      cursorBlink: true,
      scrollback: 5000
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)

    const offData = window.api.pty.onData((evt) => {
      if (evt.sessionId === QUICK_PTY_ID) term.write(evt.data)
    })
    const offExit = window.api.pty.onExit((evt) => {
      if (evt.sessionId === QUICK_PTY_ID) {
        term.writeln('\r\n\x1b[33m[conductor] quick term pty exited\x1b[0m')
      }
    })

    const onInput = term.onData((data) => {
      void window.api.pty.write(QUICK_PTY_ID, data)
    })

    const fitSafely = (): void => {
      try {
        fit.fit()
        void window.api.pty.resize(QUICK_PTY_ID, term.cols, term.rows)
      } catch {
        // not sized yet
      }
    }
    const ro = new ResizeObserver(fitSafely)
    ro.observe(container)

    fitSafely()
    term.focus()

    return () => {
      ro.disconnect()
      offData()
      offExit()
      onInput.dispose()
      term.dispose()
    }
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col bg-[#0d0d0f]">
      <div
        className="flex h-6 items-center justify-between border-b border-white/10 bg-[#16161a] px-3 text-[10px] text-white/50"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="font-mono tracking-wider">QUICK TERMINAL</span>
        <span className="text-white/30">esc to dismiss</span>
      </div>
      <div ref={containerRef} className="flex-1 p-2" />
    </div>
  )
}
