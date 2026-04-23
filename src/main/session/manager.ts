import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import type { BrowserWindow } from 'electron'
import type { PtyManager } from '../pty/manager'
import type { AnalyzerManager } from '../pty/analyzer-manager'
import type { JsonlManager } from '../claude/jsonl-manager'
import { resolveClaudePath } from '../claude/resolve'
import { safeSend } from '../lib/safeSend'
import {
  createIsolatedSession,
  destroyIsolatedSession,
  getHostClaudeDir,
  getSessionEnvOverrides,
  type IsolatedSession
} from '../claude/config-isolation'
import { getStore, patchStore } from '../store'
import type {
  SessionCreateOptions,
  SessionCreateResult,
  SessionMeta,
  SessionUpdate
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
    // Load persisted metas into memory without spawning. Host-shared
    // sessions always resolve to ~/.claude (we ignore whatever old shadow
    // path is in storage). Fresh-config sessions keep their dedicated dir
    // since that's where their private login lives.
    const host = getHostClaudeDir()
    for (const meta of getStore().sessions) {
      const isFresh = meta.isFreshConfig === true && existsSync(meta.claudeConfigDir)
      const claudeConfigDir = isFresh ? meta.claudeConfigDir : host
      this.sessions.set(meta.id, {
        ...meta,
        claudeConfigDir,
        isFreshConfig: isFresh,
        state: 'idle',
        ptyId: meta.id
      })
    }
  }

  attachWindow(win: BrowserWindow): void {
    this.window = win
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()]
  }

  findById(id: string): SessionMeta | undefined {
    return this.sessions.get(id)
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
      isolated = await createIsolatedSession(
        id,
        {
          name,
          cwd,
          worktreePath: opts.worktreePath,
          branch: opts.branch
        },
        { freshConfig: opts.freshConfig === true }
      )
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
      state: 'idle',
      avatar: opts.avatar,
      accentColor: opts.accentColor,
      viewMode: opts.viewMode ?? 'cli',
      isFreshConfig: isolated.isFreshConfig
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

  /**
   * Kill the PTY for an existing session and respawn it inside the same
   * isolated CLAUDE_CONFIG_DIR. Used when claude crashes or the user
   * wants a fresh process without losing history.
   */
  restart(id: string): SessionCreateResult {
    const meta = this.sessions.get(id)
    if (!meta) return { ok: false, error: `session ${id} not found` }
    this.teardown(meta, { removeIsolatedDir: false })
    const result = this.spawnFor(meta, { cols: 120, rows: 30 })
    if (!result.ok) {
      return { ok: false, error: result.error }
    }
    meta.state = 'idle'
    meta.subStatus = undefined
    meta.subTarget = undefined
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

  update(id: string, patch: SessionUpdate): void {
    const meta = this.sessions.get(id)
    if (!meta) return
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim()
      if (trimmed) meta.name = trimmed
    }
    if (patch.avatar !== undefined) meta.avatar = patch.avatar
    if (patch.accentColor !== undefined) meta.accentColor = patch.accentColor
    if (patch.description !== undefined) meta.description = patch.description.trim()
    if (patch.viewMode !== undefined) meta.viewMode = patch.viewMode
    this.persist()
    this.notifyChange()
  }

  /** Patch a session's live fields (state, cost, tokens, model, sub-status). */
  patchLive(
    sessionId: string,
    patch: Partial<
      Pick<
        SessionMeta,
        | 'state'
        | 'cost'
        | 'tokensIn'
        | 'tokensOut'
        | 'contextTokens'
        | 'model'
        | 'latestAssistantText'
        | 'subStatus'
        | 'subTarget'
      >
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
      metaPath: `${homedir()}/.hydra-ensemble/sessions/${meta.id}/meta.json`,
      isFreshConfig: meta.isFreshConfig === true
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
      cwd: meta.cwd,
      createdAt: meta.createdAt
    })

    if (!opts.shellOnly) {
      const claudePath = resolveClaudePath()
      // Host-shared sessions `unset CLAUDE_CONFIG_DIR` to defeat any
      // re-export done by the user's .bashrc / .zshrc after the shell
      // sources its rc files. Fresh-config sessions instead `export` the
      // isolated dir so the shell's rc file can't silently yank them
      // back to the host login.
      // No `exec` on purpose: when claude exits (intended /quit, OAuth
      // browser flow, crash) the bash stays alive, prints the prompt,
      // and the user can either type `claude` to re-enter or use the
      // restart overlay.
      // Pin --model claude-opus-4-7: the CLI's own default still resolves
      // to opus 4.6 for some accounts, and Hydra is an orchestrator for
      // deep-reasoning work — if the user wants sonnet/haiku they can
      // switch inside the session via `/model`.
      const claudeEnvPrefix =
        meta.isFreshConfig === true
          ? `export CLAUDE_CONFIG_DIR="${meta.claudeConfigDir}"`
          : `unset CLAUDE_CONFIG_DIR`
      const launch = claudePath
        ? `${claudeEnvPrefix}; clear && "${claudePath}" --model claude-opus-4-7\r`
        : `clear && echo "[hydra] claude binary not found in PATH"\r`
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
    // `forgetSession` also clears the analyzer's generation counter for
    // this id; reserve it for teardowns where the id will never come back.
    // Restart and shutdown both may spawn a fresh analyzer under the same
    // id later, and the counter MUST keep monotonically rising across
    // those spawns or the renderer's high-watermark will drop the new
    // events as stale.
    if (opts.removeIsolatedDir) {
      this.deps.analyzer?.forgetSession(meta.ptyId)
    } else {
      this.deps.analyzer?.dispose(meta.ptyId)
    }
    this.deps.onSessionDestroyed?.(meta.ptyId)
    this.deps.pty.kill(meta.ptyId)
  }

  private persist(): void {
    patchStore({ sessions: this.list() })
  }

  private notifyChange(): void {
    safeSend(this.window, 'session:changed', this.list())
  }
}
