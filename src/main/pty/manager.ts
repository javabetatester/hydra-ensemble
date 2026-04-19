import * as nodePty from 'node-pty'
import type { IPty } from 'node-pty'
import type { BrowserWindow } from 'electron'
import type { PtySpawnOptions, PtySpawnResult } from '../../shared/types'

export class PtyManager {
  private sessions = new Map<string, IPty>()
  private window: BrowserWindow | null = null

  attachWindow(win: BrowserWindow): void {
    this.window = win
  }

  spawn(opts: PtySpawnOptions): PtySpawnResult {
    if (this.sessions.has(opts.sessionId)) {
      return { ok: false, error: `Session ${opts.sessionId} already exists` }
    }

    const shell = opts.shell ?? this.defaultShell()
    const args = opts.args ?? this.defaultArgs()
    const baseEnv = { ...process.env, ...(opts.env ?? {}) } as Record<string, string>
    const env: Record<string, string> = {
      ...baseEnv,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor'
    }

    let p: IPty
    try {
      p = nodePty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: opts.cols,
        rows: opts.rows,
        cwd: opts.cwd,
        env,
        useConpty: process.platform === 'win32'
      })
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }

    p.onData((data) => {
      this.window?.webContents.send('pty:data', { sessionId: opts.sessionId, data })
    })
    p.onExit(({ exitCode, signal }) => {
      this.window?.webContents.send('pty:exit', {
        sessionId: opts.sessionId,
        exitCode,
        signal
      })
      this.sessions.delete(opts.sessionId)
    })

    this.sessions.set(opts.sessionId, p)
    return { ok: true }
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    try {
      this.sessions.get(sessionId)?.resize(cols, rows)
    } catch {
      // session may have just exited; ignore
    }
  }

  kill(sessionId: string): void {
    const p = this.sessions.get(sessionId)
    if (!p) return
    try {
      p.kill()
    } catch {
      // already dead
    }
    this.sessions.delete(sessionId)
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
  }

  private defaultShell(): string {
    if (process.platform === 'win32') {
      return process.env['COMSPEC'] ?? 'cmd.exe'
    }
    return process.env['SHELL'] ?? '/bin/bash'
  }

  private defaultArgs(): string[] {
    if (process.platform === 'win32') return []
    return ['--login']
  }
}
