import * as nodePty from 'node-pty'
import type { IPty } from 'node-pty'
import type { BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute } from 'node:path'
import type { PtySpawnOptions, PtySpawnResult } from '../../shared/types'

export type PtyDataListener = (data: string) => void

export class PtyManager {
  private sessions = new Map<string, IPty>()
  private window: BrowserWindow | null = null
  private dataListeners = new Map<string, Set<PtyDataListener>>()

  attachWindow(win: BrowserWindow): void {
    this.window = win
  }

  /** Subscribe to PTY data for a specific session. Returns unsubscribe. */
  onData(sessionId: string, listener: PtyDataListener): () => void {
    let set = this.dataListeners.get(sessionId)
    if (!set) {
      set = new Set()
      this.dataListeners.set(sessionId, set)
    }
    set.add(listener)
    return () => {
      this.dataListeners.get(sessionId)?.delete(listener)
    }
  }

  spawn(opts: PtySpawnOptions): PtySpawnResult {
    if (this.sessions.has(opts.sessionId)) {
      return { ok: false, error: `Session ${opts.sessionId} already exists` }
    }

    const shell = opts.shell ?? this.defaultShell()
    const args = opts.args ?? this.defaultArgs()
    const override = opts.env ?? {}
    const baseEnv = { ...process.env, ...override } as Record<string, string>
    const env: Record<string, string> = {
      ...baseEnv,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor'
    }
    // Strip any inherited CLAUDE_CONFIG_DIR so claude reads the host
    // ~/.claude by default. Session-level overrides (fresh-config mode)
    // are re-applied afterwards so they survive this wipe.
    delete env['CLAUDE_CONFIG_DIR']
    if (override['CLAUDE_CONFIG_DIR']) {
      env['CLAUDE_CONFIG_DIR'] = override['CLAUDE_CONFIG_DIR']
    }
    const cwd = this.resolveCwd(opts.cwd)

    const spawnAt = Date.now()
    let p: IPty
    try {
      // eslint-disable-next-line no-console
      console.log('[pty] spawn', {
        sessionId: opts.sessionId,
        shell,
        args,
        cwd,
        cols: opts.cols,
        rows: opts.rows,
        envClaudeConfigDir: env['CLAUDE_CONFIG_DIR'] ?? '<unset>',
        inheritedClaudeConfigDir: process.env['CLAUDE_CONFIG_DIR'] ?? '<unset>'
      })
      p = nodePty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: Math.max(opts.cols, 1),
        rows: Math.max(opts.rows, 1),
        cwd,
        env,
        useConpty: process.platform === 'win32'
      })
    } catch (err) {
      console.error('[pty] spawn failed:', (err as Error).message)
      return { ok: false, error: (err as Error).message }
    }

    let totalBytes = 0
    let firstByteAt: number | null = null
    p.onData((data) => {
      if (firstByteAt === null) {
        firstByteAt = Date.now()
        // eslint-disable-next-line no-console
        console.log('[pty] first-byte', {
          sessionId: opts.sessionId,
          delayMs: firstByteAt - spawnAt
        })
      }
      totalBytes += data.length
      this.window?.webContents.send('pty:data', { sessionId: opts.sessionId, data })
      const listeners = this.dataListeners.get(opts.sessionId)
      if (listeners) {
        for (const l of listeners) {
          try {
            l(data)
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[pty] data listener threw:', (err as Error).message)
          }
        }
      }
    })
    p.onExit(({ exitCode, signal }) => {
      // eslint-disable-next-line no-console
      console.log('[pty] exit', {
        sessionId: opts.sessionId,
        exitCode,
        signal,
        totalBytes,
        livedMs: Date.now() - spawnAt,
        firstByteMs: firstByteAt ? firstByteAt - spawnAt : null
      })
      this.window?.webContents.send('pty:exit', {
        sessionId: opts.sessionId,
        exitCode,
        signal
      })
      this.sessions.delete(opts.sessionId)
      this.dataListeners.delete(opts.sessionId)
    })

    this.sessions.set(opts.sessionId, p)
    return { ok: true }
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    // Clamp to a sane minimum so a transient layout collapse never tells
    // the PTY cols=1 (which makes claude wrap text one char per line).
    const safeCols = Math.max(20, Math.floor(cols))
    const safeRows = Math.max(5, Math.floor(rows))
    try {
      this.sessions.get(sessionId)?.resize(safeCols, safeRows)
    } catch {
      // session may have just exited; ignore
    }
  }

  kill(sessionId: string): void {
    const p = this.sessions.get(sessionId)
    if (!p) return
    // eslint-disable-next-line no-console
    console.log('[pty] kill', { sessionId, callsite: new Error().stack?.split('\n')[2]?.trim() })
    try {
      p.kill()
    } catch {
      // already dead
    }
    this.sessions.delete(sessionId)
    this.dataListeners.delete(sessionId)
  }

  killAll(): void {
    for (const [id, p] of this.sessions) {
      try {
        p.kill()
      } catch {
        // noop
      }
      this.sessions.delete(id)
    }
    this.dataListeners.clear()
  }

  private defaultShell(): string {
    if (process.platform === 'win32') {
      return process.env['COMSPEC'] ?? 'cmd.exe'
    }
    return process.env['SHELL'] ?? '/bin/bash'
  }

  private defaultArgs(): string[] {
    // Empty args: shells run interactively when stdin is a PTY.
    // Avoid `--login` since some user profiles abort on non-tty checks.
    return []
  }

  private resolveCwd(requested: string | undefined): string {
    if (requested && isAbsolute(requested) && existsSync(requested)) return requested
    return homedir()
  }
}
