import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import type { BrowserWindow } from 'electron'
import type { PtyManager } from '../pty/manager'
import type { AnalyzerManager } from '../pty/analyzer-manager'
import type { JsonlManager } from '../claude/jsonl-manager'
import { resolveClaudePath } from '../claude/resolve'
import {
  createIsolatedSession,
  destroyIsolatedSession,
  getSessionEnvOverrides,
  type IsolatedSession
} from '../claude/config-isolation'
import { getStore, patchStore } from '../store'
import type {
  SessionCreateOptions,
  SessionCreateResult,
  SessionMeta
} from '../../shared/types'

export interface SessionManagerDeps {
  pty: PtyManager
  analyzer?: AnalyzerManager
  jsonl?: JsonlManager
  /** Called for each chunk of PTY data per session — used by the watchdog. */
  onSessionData?: (sessionId: string, data: string) => void
  /** Called when a session is destroyed — used by the watchdog to forget it. */
  onSessionDestroyed?: (sessionId: string) => void
}

export class SessionManager {
  private window: BrowserWindow | null = null
  private sessions = new Map<string, SessionMeta>()
  private unsubscribers = new Map<string, () => void>()
  private rehydrated = false

  constructor(private deps: SessionManagerDeps) {
    // Load persisted metas into memory without spawning — PTYs don't survive
    // restart, but the isolated CLAUDE_CONFIG_DIR does. rehydrate() respawns
    // PTYs inside the existing config dirs so Claude picks up the same
    // projects/JSONL history and shared credentials.
    for (const meta of getStore().sessions) {
      if (!existsSync(meta.claudeConfigDir)) continue
      this.sessions.set(meta.id, { ...meta, state: 'idle', ptyId: meta.id })
    }
  }

  attachWindow(win: BrowserWindow): void {
    this.window = win
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()]
  }

  /**
   * Respawn PTYs for all persisted sessions. Safe to call more than once;
   * subsequent calls are no-ops. Call after the renderer has mounted and
   * subscribed to IPC events so early output isn't lost.
   */
  async rehydrate(): Promise<void> {
    if (this.rehydrated) return
    this.rehydrated = true

    const metas = [...this.sessions.values()]
    for (const meta of metas) {
      if (!existsSync(meta.claudeConfigDir)) {
        this.sessions.delete(meta.id)
        continue
      }
      try {
        this.respawn(meta)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[session] rehydrate failed for', meta.id, (err as Error).message)
        this.sessions.delete(meta.id)
        await destroyIsolatedSession(meta.id).catch(() => {})
      }
    }

    this.persist()
    this.notifyChange()
  }

  async create(opts: SessionCreateOptions): Promise<SessionCreateResult> {
    const id = randomUUID()
    const ptyId = id
    const cwd = opts.cwd ?? opts.worktreePath ?? homedir()
    const name = opts.name?.trim() || `session-${this.sessions.size + 1}`

    let isolated: IsolatedSession
    try {
      isolated = await createIsolatedSession(id, {
        name,
        cwd,
        worktreePath: opts.worktreePath,
        branch: opts.branch
      })
    } catch (err) {
      return { ok: false, error: `failed to create isolated config: ${(err as Error).message}` }
    }

    const meta: SessionMeta = {
      id,
      name,
      cwd,
      worktreePath: opts.worktreePath,
      branch: opts.branch,
      claudeConfigDir: isolated.configDir,
      createdAt: new Date().toISOString(),
      ptyId,
      state: 'idle'
    }

    const spawn = this.spawnFor(meta, {
      cols: opts.cols,
      rows: opts.rows,
      shellOnly: opts.shellOnly
    })
    if (!spawn.ok) {
      await destroyIsolatedSession(id).catch(() => {})
      return { ok: false, error: spawn.error }
    }

    this.sessions.set(id, meta)
    this.persist()
    this.notifyChange()

    return { ok: true, session: meta }
  }

  async destroy(id: string): Promise<void> {
    const meta = this.sessions.get(id)
    if (!meta) return
    this.teardown(meta, { removeIsolatedDir: true })
    this.sessions.delete(id)
    await destroyIsolatedSession(id).catch(() => {})
    this.persist()
    this.notifyChange()
  }

  /**
   * Kill PTYs for all sessions but **keep** their isolated config dirs so
   * they can be rehydrated next boot. Used on app quit / window-all-closed.
   */
  shutdown(): void {
    for (const [, meta] of this.sessions) {
      this.teardown(meta, { removeIsolatedDir: false })
    }
    this.persist()
  }

  /** Legacy name — nukes sessions and their config dirs. Kept for explicit user intent only. */
  async destroyAll(): Promise<void> {
    const ids = [...this.sessions.keys()]
    for (const id of ids) {
      await this.destroy(id)
    }
  }

  rename(id: string, name: string): void {
    const meta = this.sessions.get(id)
    if (!meta) return
    const trimmed = name.trim()
    if (!trimmed) return
    meta.name = trimmed
    this.persist()
    this.notifyChange()
  }

  /** Patch a session's live fields (state, cost, tokens, model). */
  patchLive(
    sessionId: string,
    patch: Partial<
      Pick<SessionMeta, 'state' | 'cost' | 'tokensIn' | 'tokensOut' | 'model' | 'latestAssistantText'>
    >
  ): void {
    const meta = this.sessions.get(sessionId)
    if (!meta) return
    Object.assign(meta, patch)
    this.persist()
    this.notifyChange()
  }

  // --- private ----------------------------------------------------------

  private respawn(meta: SessionMeta): void {
    const spawn = this.spawnFor(meta, { cols: 120, rows: 30, shellOnly: false })
    if (!spawn.ok) {
      throw new Error(spawn.error)
    }
    meta.state = 'idle'
    meta.ptyId = meta.id
  }

  private spawnFor(
    meta: SessionMeta,
    opts: { cols: number; rows: number; shellOnly?: boolean }
  ): { ok: true } | { ok: false; error: string } {
    const ptyId = meta.id
    const env = getSessionEnvOverrides({
      sessionId: meta.id,
      rootDir: `${homedir()}/.hydra-ensemble/sessions/${meta.id}`,
      configDir: meta.claudeConfigDir,
      metaPath: `${homedir()}/.hydra-ensemble/sessions/${meta.id}/meta.json`
    })

    const result = this.deps.pty.spawn({
      sessionId: ptyId,
      cwd: meta.cwd,
      cols: opts.cols,
      rows: opts.rows,
      env
    })

    if (!result.ok) return result

    const analyzerInstance = this.deps.analyzer?.forSession(ptyId)
    const offData = this.deps.pty.onData(ptyId, (data) => {
      analyzerInstance?.feed(data)
      this.deps.onSessionData?.(ptyId, data)
    })
    this.unsubscribers.set(ptyId, offData)

    this.deps.jsonl?.start({
      id: ptyId,
      claudeConfigDir: meta.claudeConfigDir,
      cwd: meta.cwd
    })

    if (!opts.shellOnly) {
      const claudePath = resolveClaudePath()
      const launch = claudePath
        ? `clear && exec "${claudePath}"\r`
        : `clear && echo "[hydra-ensemble] claude binary not found in PATH"\r`
      setTimeout(() => {
        this.deps.pty.write(ptyId, launch)
      }, 350)
    }

    return { ok: true }
  }

  private teardown(meta: SessionMeta, opts: { removeIsolatedDir: boolean }): void {
    this.unsubscribers.get(meta.ptyId)?.()
    this.unsubscribers.delete(meta.ptyId)
    this.deps.jsonl?.stop(meta.ptyId)
    this.deps.analyzer?.dispose(meta.ptyId)
    this.deps.onSessionDestroyed?.(meta.ptyId)
    this.deps.pty.kill(meta.ptyId)
    // The caller is responsible for removing the isolated dir when appropriate;
    // shutdown() preserves it for rehydration, destroy() nukes it.
    void opts
  }

  private persist(): void {
    patchStore({ sessions: this.list() })
  }

  private notifyChange(): void {
    this.window?.webContents.send('session:changed', this.list())
  }
}
