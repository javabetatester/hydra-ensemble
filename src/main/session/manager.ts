import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import type { BrowserWindow } from 'electron'
import type { PtyManager } from '../pty/manager'
import type { AnalyzerManager } from '../pty/analyzer-manager'
import type { JsonlManager } from '../claude/jsonl-manager'
import type { KeyVault } from '../keys/vault'
import { resolveBinaryPath } from '../claude/resolve'
import { safeSend } from '../lib/safeSend'
import {
  createIsolatedSession,
  destroyIsolatedSession,
  getHostClaudeDir,
  getSessionEnvOverrides,
  type IsolatedSession
} from './config-isolation'
import { getStore, patchStore } from '../store'
import {
  PROVIDER_SPECS,
  type Provider,
  type SessionCreateOptions,
  type SessionCreateResult,
  type SessionMeta,
  type SessionUpdate
} from '../../shared/types'

/**
 * POSIX-safe single-quoted shell escape. Wraps the input in single quotes
 * and escapes any embedded single quote with the standard `'\''` dance.
 * Good enough for env-var values we're piping through `export FOO=...`
 * inside the bash launch line. Not used on Windows (no PTY launch path
 * for the new providers there yet — they fall back to the not-found
 * branch).
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

/** Defense-in-depth UUID check before splicing a session id into the
 *  shell launch command. The IPC layer validates too, but anything
 *  reaching `--resume` must be a plain uuid even if we add another
 *  caller later. */
const RESUME_UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

export interface SessionManagerDeps {
  pty: PtyManager
  analyzer?: AnalyzerManager
  jsonl?: JsonlManager
  /** Optional — when present, sessions can refer to keys by id and the
   *  manager re-reveals the plaintext from disk at spawn time. */
  keyVault?: KeyVault
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
    const provider: Provider = opts.provider ?? 'claude'
    const spec = PROVIDER_SPECS[provider]
    // Model is resolved purely from the provider spec — Hydra no longer
    // exposes a picker. Codex / Copilot manage model selection inside
    // their own TUI; Claude stays pinned to Opus 4.7 via spec.defaultModel.
    const model = spec.defaultModel

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
        { freshConfig: opts.freshConfig === true, provider }
      )
    } catch (err) {
      return { ok: false, error: `failed to create isolated config: ${(err as Error).message}` }
    }

    // Resolve an optional vault-stored key. We persist `apiKeyId` on the
    // session meta so a restart / rehydrate can re-reveal the same key,
    // but the plaintext stays purely in the spawn env.
    let resolvedKey: string | undefined = opts.apiKey
    if (!resolvedKey && opts.apiKeyId && this.deps.keyVault) {
      const fromVault = this.deps.keyVault.reveal(opts.apiKeyId)
      if (fromVault) {
        resolvedKey = fromVault
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `[session] vault key ${opts.apiKeyId} could not be revealed — spawning without env var`
        )
      }
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
      isFreshConfig: isolated.isFreshConfig,
      provider,
      providerModel: model,
      ...(opts.apiKeyId ? { apiKeyId: opts.apiKeyId } : {})
    }

    const spawn = this.spawnFor(meta, {
      cols: opts.cols,
      rows: opts.rows,
      shellOnly: opts.shellOnly,
      apiKey: resolvedKey,
      resumeId: opts.resumeId
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
    let apiKey: string | undefined
    if (meta.apiKeyId && this.deps.keyVault) {
      const revealed = this.deps.keyVault.reveal(meta.apiKeyId)
      if (revealed) {
        apiKey = revealed
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `[session] vault key ${meta.apiKeyId} no longer available — restarting ${meta.id} without env var`
        )
      }
    }
    const result = this.spawnFor(meta, { cols: 120, rows: 30, apiKey })
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
    // If the session was created against a vault key, re-reveal it now so
    // the respawn re-exports the env var. If reveal fails (key was
    // deleted between launches) we warn but still respawn — the binary
    // will fall back to ambient auth instead of the session crashing.
    let apiKey: string | undefined
    if (meta.apiKeyId && this.deps.keyVault) {
      const revealed = this.deps.keyVault.reveal(meta.apiKeyId)
      if (revealed) {
        apiKey = revealed
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `[session] vault key ${meta.apiKeyId} no longer available — respawning ${meta.id} without env var`
        )
      }
    }
    const spawn = this.spawnFor(meta, {
      cols: 120,
      rows: 30,
      shellOnly: false,
      apiKey
    })
    if (!spawn.ok) {
      throw new Error(spawn.error)
    }
    meta.state = 'idle'
    meta.ptyId = meta.id
  }

  private spawnFor(
    meta: SessionMeta,
    opts: {
      cols: number
      rows: number
      shellOnly?: boolean
      apiKey?: string
      /** When set on a `claude` session, splice `--resume <id>` into the
       *  launch command so the spawned CLI continues an existing
       *  conversation instead of opening a new one. */
      resumeId?: string
    }
  ): { ok: true } | { ok: false; error: string } {
    const ptyId = meta.id
    const env = getSessionEnvOverrides({
      sessionId: meta.id
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
    })
    this.unsubscribers.set(ptyId, offData)

    // The JSONL watcher only understands Claude's transcript format. For
    // codex / copilot it's a no-op — those sessions still spawn fine,
    // they just don't surface tokens/cost (em-dashes in SessionCard,
    // which already handles that case).
    const provider: Provider = meta.provider ?? 'claude'
    if (provider === 'claude') {
      this.deps.jsonl?.start({
        id: ptyId,
        claudeConfigDir: meta.claudeConfigDir,
        cwd: meta.cwd,
        createdAt: meta.createdAt
      })
    }

    if (!opts.shellOnly) {
      const spec = PROVIDER_SPECS[provider]
      const binPath = resolveBinaryPath(spec.binary)
      // Host-shared sessions `unset` the provider's config-dir env var
      // to defeat any re-export done by the user's .bashrc / .zshrc
      // after the shell sources its rc files. Fresh-config sessions
      // instead `export` the isolated dir so the shell's rc file can't
      // silently yank them back to the host login.
      //
      // No `exec` on purpose: when the agent exits (intended /quit,
      // OAuth browser flow, crash) the bash stays alive, prints the
      // prompt, and the user can either re-enter or use the restart
      // overlay.
      const envParts: string[] = []
      if (meta.isFreshConfig === true) {
        envParts.push(`export ${spec.configDirEnv}="${meta.claudeConfigDir}"`)
      } else {
        envParts.push(`unset ${spec.configDirEnv}`)
      }
      // API key is plumbed through opts (not in meta) — it's set on the
      // spawn only, never persisted. Quote-escape so embedded special
      // characters can't break out of the export.
      if (opts.apiKey && spec.apiKeyEnv) {
        envParts.push(`export ${spec.apiKeyEnv}=${shellQuote(opts.apiKey)}`)
      }
      // Pin Claude to Opus 4.7 by default. Hydra is an orchestrator for
      // deep-reasoning work, so spawning every claude session on Opus
      // is the intended UX — the CLI's account default sometimes
      // resolves to Sonnet/Opus 4.6 depending on the profile, and we
      // don't want that drift. Users can still flip mid-session via
      // `/model` inside the chat. For other providers, model resolves
      // from the spec default.
      // `--model` flag only when the spec declares a default. Codex
      // and Copilot omit it (they pick their default internally).
      const model = meta.providerModel ?? spec.defaultModel
      const modelFlag = model ? ` --model ${shellQuote(model)}` : ''
      // --resume is Claude-only and requires a sane UUID. We re-validate
      // here because this method is the last hop before the id reaches
      // a shell command — any mistake upstream is contained.
      let resumeFlag = ''
      if (opts.resumeId && provider === 'claude') {
        if (!RESUME_UUID_RE.test(opts.resumeId)) {
          return { ok: false, error: `invalid resume session id: ${opts.resumeId}` }
        }
        resumeFlag = ` --resume ${shellQuote(opts.resumeId)}`
      }
      const launch = binPath
        ? `${envParts.join('; ')}; clear && "${binPath}"${resumeFlag}${modelFlag}\r`
        : `clear && echo "[hydra] ${spec.binary} binary not found in PATH"\r`
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
    this.deps.pty.kill(meta.ptyId)
  }

  private persist(): void {
    patchStore({ sessions: this.list() })
  }

  private notifyChange(): void {
    safeSend(this.window, 'session:changed', this.list())
  }
}
