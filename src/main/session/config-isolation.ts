import { existsSync } from 'node:fs'
import { mkdir, writeFile, rm, readdir, lstat, copyFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Provider } from '../../shared/types'
import { PROVIDER_SPECS } from '../../shared/types'

const SESSIONS_ROOT = join(homedir(), '.hydra-ensemble', 'sessions')
const HOST_CLAUDE = join(homedir(), '.claude')

export interface IsolatedSession {
  sessionId: string
  rootDir: string // ~/.hydra-ensemble/sessions/<id>
  /**
   * Pointer to the provider config directory this session reads from.
   *
   * Default: host `~/.claude` (shared login, shared state) for the Claude
   * provider. We used to create a per-session shadow with symlinks back to
   * the host, but Claude writes `.credentials.json` atomically, clobbering
   * the symlink and logging every new session out. Natural segregation
   * comes from the worktree CWD — Claude keys `projects/<encoded-cwd>/*.jsonl`
   * by spawn CWD, so parallel sessions on different worktrees still get
   * distinct history files.
   *
   * For non-Claude providers running in shared mode we leave configDir as
   * the host's `~/.claude` for backward-compat with the legacy field name
   * — the spawn path for those providers does NOT export `CLAUDE_CONFIG_DIR`
   * (it uses the provider's own env var, only when fresh).
   *
   * When the session is created with `freshConfig: true`, this points at a
   * real empty dir under `~/.hydra-ensemble/sessions/<id>/<provider>` and
   * the spawn path exports the provider-specific config-dir env var.
   */
  configDir: string
  metaPath: string
  /** True when configDir is a dedicated isolated dir (not the host). */
  isFreshConfig: boolean
  /** Which provider this isolated dir was prepared for. */
  provider: Provider
}

export interface SessionMetaJson {
  sessionId: string
  name: string
  cwd: string
  worktreePath?: string
  branch?: string
  createdAt: string
  provider: Provider
}

export async function createIsolatedSession(
  sessionId: string,
  meta: Omit<SessionMetaJson, 'sessionId' | 'createdAt' | 'provider'>,
  opts: { freshConfig?: boolean; provider?: Provider } = {}
): Promise<IsolatedSession> {
  const provider: Provider = opts.provider ?? 'claude'
  const rootDir = join(SESSIONS_ROOT, sessionId)
  await mkdir(rootDir, { recursive: true })

  const metaPath = join(rootDir, 'meta.json')
  const metaJson: SessionMetaJson = {
    sessionId,
    createdAt: new Date().toISOString(),
    provider,
    ...meta
  }
  await writeFile(metaPath, JSON.stringify(metaJson, null, 2))

  // Default points at the host claude dir for backward compat with the
  // legacy `claudeConfigDir` field. Non-claude providers in shared mode
  // simply ignore this value at spawn time.
  let configDir = HOST_CLAUDE
  if (opts.freshConfig) {
    // Empty dir → provider sees no credentials, no settings, no state.
    // First launch triggers the provider's login flow from scratch.
    configDir = join(rootDir, provider)
    await mkdir(configDir, { recursive: true })
  }

  return {
    sessionId,
    rootDir,
    configDir,
    metaPath,
    isFreshConfig: opts.freshConfig === true,
    provider
  }
}

export async function destroyIsolatedSession(sessionId: string): Promise<void> {
  const rootDir = join(SESSIONS_ROOT, sessionId)
  await rm(rootDir, { recursive: true, force: true })
}

/**
 * Env vars handed to the PTY. Provider-agnostic in that it only writes
 * the session-id marker. The provider's config-dir env var is exported
 * via the shell launch line in `SessionManager.spawnFor` because it
 * needs to also `unset` the host var when running in shared mode (the
 * user's rc files often re-export it).
 */
export function getSessionEnvOverrides(isolated: {
  sessionId: string
}): Record<string, string> {
  const env: Record<string, string> = {
    HYDRA_ENSEMBLE_SESSION_ID: isolated.sessionId
  }
  return env
}

export function getSessionsRoot(): string {
  return SESSIONS_ROOT
}

export function getHostClaudeDir(): string {
  return HOST_CLAUDE
}

/** Lookup the provider spec from an id, defaulting to 'claude'. */
export function specForProvider(provider: Provider | undefined) {
  return PROVIDER_SPECS[provider ?? 'claude']
}

/**
 * One-time migration for users who logged in under the legacy per-session
 * shadow directory (~/.hydra-ensemble/sessions/<id>/claude/.credentials.json).
 * Those credentials were invisible to new sessions once we switched to
 * sharing the host ~/.claude. Walk the shadow dirs, pick the most recently
 * written credentials file, and copy it to the host.
 *
 * Safe to call on every boot — returns immediately if the host already
 * has a regular (non-symlink) credentials file.
 */
export async function migrateLegacyCredentials(): Promise<void> {
  const hostCreds = join(HOST_CLAUDE, '.credentials.json')

  // If host already has a real creds file, nothing to do.
  if (existsSync(hostCreds)) {
    try {
      const st = await lstat(hostCreds)
      if (!st.isSymbolicLink() && st.size > 0) return
      // If it's a lingering symlink from the old shadow setup, remove it.
      if (st.isSymbolicLink()) await rm(hostCreds).catch(() => {})
    } catch {
      /* proceed with migration */
    }
  }

  if (!existsSync(SESSIONS_ROOT)) return

  let dirs: string[]
  try {
    dirs = await readdir(SESSIONS_ROOT)
  } catch {
    return
  }

  let newest: { path: string; mtime: number } | null = null
  for (const d of dirs) {
    const credPath = join(SESSIONS_ROOT, d, 'claude', '.credentials.json')
    if (!existsSync(credPath)) continue
    try {
      const st = await lstat(credPath)
      if (st.isSymbolicLink()) continue
      if (st.size <= 0) continue
      if (!newest || st.mtimeMs > newest.mtime) {
        newest = { path: credPath, mtime: st.mtimeMs }
      }
    } catch {
      /* skip */
    }
  }

  if (!newest) return

  await mkdir(HOST_CLAUDE, { recursive: true })
  try {
    await copyFile(newest.path, hostCreds)
    // eslint-disable-next-line no-console
    console.log('[credentials] migrated from', newest.path, '->', hostCreds)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[credentials] migrate failed:', (err as Error).message)
  }
}
