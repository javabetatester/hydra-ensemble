import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface Props {
  sessionId: string
  cwd?: string
}

export default function TerminalPane({ sessionId, cwd }: Props) {
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
      allowProposedApi: true,
      scrollback: 10_000,
      convertEol: false
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(container)

    let disposed = false

    const fitSafely = (): void => {
      try {
        fit.fit()
      } catch {
        // container may not be sized yet on first paint
      }
    }

    fitSafely()

    const initialCwd = cwd ?? '.'

    void window.api.pty
      .spawn({
        sessionId,
        cwd: initialCwd,
        cols: term.cols,
        rows: term.rows
      })
      .then((res) => {
        if (disposed) return
        if (!res.ok) {
          term.writeln(`\r\n\x1b[31m[hydra-ensemble] failed to spawn pty: ${res.error}\x1b[0m`)
        }
      })

    const offData = window.api.pty.onData((evt) => {
      if (evt.sessionId === sessionId) term.write(evt.data)
    })
    const offExit = window.api.pty.onExit((evt) => {
      if (evt.sessionId === sessionId) {
        term.writeln(
          `\r\n\x1b[33m[hydra-ensemble] pty exited (code=${evt.exitCode}${evt.signal ? `, signal=${evt.signal}` : ''})\x1b[0m`
        )
      }
    })

    const onInputDispose = term.onData((data) => {
      void window.api.pty.write(sessionId, data)
    })

    const ro = new ResizeObserver(() => {
      fitSafely()
      void window.api.pty.resize(sessionId, term.cols, term.rows)
    })
    ro.observe(container)

    return () => {
      disposed = true
      ro.disconnect()
      offData()
      offExit()
      onInputDispose.dispose()
      void window.api.pty.kill(sessionId)
      term.dispose()
    }
  }, [sessionId, cwd])

  return <div ref={containerRef} className="h-full w-full" />
}
