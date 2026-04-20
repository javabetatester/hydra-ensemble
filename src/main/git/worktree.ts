import { spawn, type SpawnOptions } from 'node:child_process'
import { mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { Worktree, ChangedFile, GitOpResult } from '../../shared/types'

/** Path component that identifies Hydra Ensemble-managed worktrees. */
const MANAGED_SUBPATH = `${path.sep}.hydra-ensemble${path.sep}worktrees${path.sep}`

interface SpawnResult {
  code: number
  stdout: string
  stderr: string
}

/** Manages git worktrees for isolated parallel sessions. */
export class WorktreeService {
  /** Resolve the git repository root for an arbitrary directory. */
  async repoRoot(cwd: string): Promise<string | null> {
    const res = await this.runGit(['-C', cwd, 'rev-parse', '--show-toplevel'])
    if (res.code !== 0) return null
    const out = res.stdout.trim()
    // git emits forward-slashes on Windows; normalise to the platform separator
    // so downstream equality checks against fs.realpath / path.resolve agree.
    return out.length > 0 ? path.resolve(out) : null
  }

  /** Get the current branch (HEAD) for a directory. */
  async currentBranch(cwd: string): Promise<string | null> {
    const res = await this.runGit(['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'])
    if (res.code !== 0) return null
    const out = res.stdout.trim()
    return out.length > 0 ? out : null
  }

  /** List all worktrees. First worktree returned by git is the main one. */
  async listWorktrees(cwd: string): Promise<GitOpResult<Worktree[]>> {
    const res = await this.runGit(['-C', cwd, 'worktree', 'list', '--porcelain'])
    if (res.code !== 0) {
      return { ok: false, error: res.stderr.trim() || 'git worktree list failed' }
    }
    const list = await this.parseWorktreePorcelain(res.stdout)
    return { ok: true, value: list }
  }

  /**
   * Create a new worktree at `<repoRoot>/.hydra-ensemble/worktrees/<name>`.
   * Creates the branch if needed; if the branch already exists, retries
   * checking it out without `-b`.
   */
  async createWorktree(
    repoRoot: string,
    name: string,
    baseBranch?: string
  ): Promise<GitOpResult<Worktree>> {
    const base = path.join(repoRoot, '.hydra-ensemble', 'worktrees')
    try {
      await mkdir(base, { recursive: true })
    } catch (err) {
      return { ok: false, error: `failed to create worktrees dir: ${(err as Error).message}` }
    }

    const worktreePath = path.join(base, name)
    const resolvedBase =
      baseBranch && baseBranch.length > 0
        ? baseBranch
        : (await this.detectDefaultBranch(repoRoot)) ?? 'main'

    const first = await this.runGit(
      ['worktree', 'add', '-b', name, worktreePath, resolvedBase],
      { cwd: repoRoot }
    )

    if (first.code !== 0) {
      const errMsg = first.stderr.trim() || 'unknown error'
      // If branch already exists, retry without -b (check it out instead).
      if (errMsg.includes('already exists')) {
        const second = await this.runGit(
          ['-C', repoRoot, 'worktree', 'add', worktreePath, name]
        )
        if (second.code !== 0) {
          return { ok: false, error: second.stderr.trim() || errMsg }
        }
      } else {
        return { ok: false, error: errMsg }
      }
    }

    // Build the Worktree value by listing and finding the new entry.
    const list = await this.listWorktrees(repoRoot)
    if (list.ok) {
      const target = await this.canonicalize(worktreePath)
      const found = await this.findByPath(list.value, target)
      if (found) return { ok: true, value: found }
    }
    return {
      ok: true,
      value: {
        path: worktreePath,
        branch: name,
        head: '',
        isBare: false,
        isManaged: true,
        isMain: false,
      },
    }
  }

  /**
   * Remove a worktree. We pass the worktree's name (last path component) to
   * git, matching the Swift implementation — this sidesteps stale admin
   * entries with mismatched paths. On failure, attempt `git branch -D <name>`
   * to clean up the dangling branch.
   */
  async removeWorktree(repoRoot: string, worktreePath: string): Promise<GitOpResult> {
    const name = path.basename(worktreePath)
    const res = await this.runGit(
      ['-C', repoRoot, 'worktree', 'remove', '--force', name],
      { cwd: repoRoot }
    )
    if (res.code !== 0) {
      // Best-effort: clean up the branch so it doesn't linger in the UI.
      await this.runGit(['-C', repoRoot, 'branch', '-D', name], { cwd: repoRoot })
      return {
        ok: false,
        error: res.stderr.trim() || `git worktree remove failed for ${name}`,
      }
    }
    // Worktree gone — also delete the matching branch so it doesn't linger.
    // Best-effort: ignore failures (branch may already be gone or in use).
    await this.runGit(['-C', repoRoot, 'branch', '-D', name], { cwd: repoRoot })
    return { ok: true, value: undefined }
  }

  /** List changed files via `git status --porcelain=v1 -uall`. */
  async listChangedFiles(cwd: string): Promise<GitOpResult<ChangedFile[]>> {
    const res = await this.runGit(['-C', cwd, 'status', '--porcelain=v1', '-uall'])
    if (res.code !== 0) {
      return { ok: false, error: res.stderr.trim() || 'git status failed' }
    }
    const files: ChangedFile[] = []
    for (const rawLine of res.stdout.split('\n')) {
      if (rawLine.length < 3) continue
      const code = rawLine.slice(0, 2)
      const rest = rawLine.slice(3)
      const status = mapStatusCode(code)
      if (!status) continue
      // Renames look like "old -> new"; keep just the new path.
      const arrow = rest.indexOf(' -> ')
      const filePath = arrow >= 0 ? rest.slice(arrow + 4) : rest
      // `staged` reflects column 1 of the porcelain code: any non-space,
      // non-'?' char means the change is in the index. Untracked files
      // can never be staged until `git add` runs.
      const idx = code[0] ?? ' '
      const staged = idx !== ' ' && idx !== '?'
      files.push({ path: filePath, status, staged })
    }
    return { ok: true, value: files }
  }

  /**
   * Unified diff for one file (or the whole worktree if path omitted).
   * `staged: true` pulls from the index (HEAD..index); `staged: false`
   * pulls worktree changes (index..worktree). Untracked files return a
   * synthetic "added" diff so the UI can show them before staging.
   *
   * Diffs are truncated server-side at DIFF_SIZE_LIMIT chars — package-lock
   * style monsters (5-20MB) used to cross the IPC bridge and lock the
   * renderer. Callers see a short trailing marker when this trips.
   */
  async getDiff(
    cwd: string,
    filePath?: string,
    staged: boolean = false
  ): Promise<GitOpResult<string>> {
    const args = ['-C', cwd, 'diff', '--no-color']
    if (staged) args.push('--cached')
    if (filePath !== undefined && filePath.length > 0) {
      args.push('--', filePath)
    }
    const res = await this.runGit(args)
    if (res.code !== 0) {
      return { ok: false, error: res.stderr.trim() || 'git diff failed' }
    }
    // Untracked + no staged diff: synthesise by showing the file content
    // against /dev/null so the UI can still render a preview.
    if (!staged && res.stdout.length === 0 && filePath !== undefined) {
      const ls = await this.runGit(['-C', cwd, 'ls-files', '--others', '--exclude-standard', '--', filePath])
      if (ls.code === 0 && ls.stdout.trim().length > 0) {
        const show = await this.runGit(['-C', cwd, 'diff', '--no-color', '--no-index', '/dev/null', filePath])
        // --no-index always returns 1 on differences; treat that as success.
        if (show.stdout.length > 0) {
          return { ok: true, value: cap(show.stdout) }
        }
      }
    }
    return { ok: true, value: cap(res.stdout) }
  }

  /** `git add -- <path>...` — stages the given files (or the whole tree if empty). */
  async stageFiles(cwd: string, paths: string[]): Promise<GitOpResult> {
    const args = ['-C', cwd, 'add', '--']
    if (paths.length === 0) {
      args.pop()
      args.push('-A')
    } else {
      args.push(...paths)
    }
    const res = await this.runGit(args)
    if (res.code !== 0) {
      return { ok: false, error: res.stderr.trim() || 'git add failed' }
    }
    return { ok: true, value: undefined }
  }

  /** `git reset HEAD -- <path>...` — unstages the given files. */
  async unstageFiles(cwd: string, paths: string[]): Promise<GitOpResult> {
    const args = ['-C', cwd, 'reset', 'HEAD', '--', ...paths]
    const res = await this.runGit(args)
    if (res.code !== 0) {
      return { ok: false, error: res.stderr.trim() || 'git reset failed' }
    }
    return { ok: true, value: undefined }
  }

  /**
   * `git commit -m <message>`. Pipes the message via stdin (using `-F -`)
   * so multi-line / quote-heavy messages can't break the shell.
   */
  async commit(cwd: string, message: string): Promise<GitOpResult<{ sha: string }>> {
    if (message.trim().length === 0) {
      return { ok: false, error: 'commit message cannot be empty' }
    }
    const res = await this.runGit(['-C', cwd, 'commit', '-F', '-'], { stdin: message })
    if (res.code !== 0) {
      return { ok: false, error: res.stderr.trim() || res.stdout.trim() || 'git commit failed' }
    }
    const sha = await this.runGit(['-C', cwd, 'rev-parse', 'HEAD'])
    return { ok: true, value: { sha: sha.stdout.trim() } }
  }

  // --------------------------------------------------------------------- //
  // Internals
  // --------------------------------------------------------------------- //

  private async detectDefaultBranch(repoRoot: string): Promise<string | null> {
    const res = await this.runGit(
      ['-C', repoRoot, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']
    )
    if (res.code !== 0) return null
    const out = res.stdout.trim()
    if (out.length === 0) return null
    // Strip leading "origin/" if present.
    return out.startsWith('origin/') ? out.slice('origin/'.length) : out
  }

  private async parseWorktreePorcelain(output: string): Promise<Worktree[]> {
    const result: Worktree[] = []
    let curPath = ''
    let curBranch = ''
    let curHead = ''
    let curBare = false

    const flush = async (isFirst: boolean): Promise<void> => {
      if (curPath.length === 0) return
      result.push({
        path: curPath,
        branch: curBranch,
        head: curHead,
        isBare: curBare,
        isManaged: await isManagedPath(curPath),
        isMain: isFirst,
      })
    }

    let isFirst = true
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        await flush(isFirst)
        if (curPath.length > 0) isFirst = false
        curPath = line.slice('worktree '.length)
        curBranch = ''
        curHead = ''
        curBare = false
      } else if (line.startsWith('HEAD ')) {
        curHead = line.slice('HEAD '.length)
      } else if (line.startsWith('branch ')) {
        const full = line.slice('branch '.length)
        curBranch = full.startsWith('refs/heads/')
          ? full.slice('refs/heads/'.length)
          : full
      } else if (line === 'bare') {
        curBare = true
      }
    }
    await flush(isFirst)
    return result
  }

  private async findByPath(list: Worktree[], target: string): Promise<Worktree | null> {
    for (const wt of list) {
      const resolved = await this.canonicalize(wt.path)
      if (resolved === target) return wt
    }
    return null
  }

  private async canonicalize(p: string): Promise<string> {
    try {
      return await realpath(p)
    } catch {
      return p
    }
  }

  /**
   * Spawn `git` with the given args. Scrubs `GIT_*` env vars so an inherited
   * `GIT_DIR` / `GIT_WORK_TREE` doesn't redirect git to the wrong repo.
   */
  private runGit(
    args: string[],
    opts: { cwd?: string; stdin?: string } = {}
  ): Promise<SpawnResult> {
    return new Promise((resolve) => {
      const env: NodeJS.ProcessEnv = {}
      for (const [k, v] of Object.entries(process.env)) {
        if (k.startsWith('GIT_')) continue
        if (v !== undefined) env[k] = v
      }
      // Neutralise anything that makes git go interactive or spawns
      // persistent grandchildren we can't easily clean up:
      //   pagers  → GIT_PAGER/PAGER=cat           (prevents `less` stdin waits)
      //   prompts → GIT_TERMINAL_PROMPT=0         (no credential dialog)
      //   locks   → GIT_OPTIONAL_LOCKS=0          (don't fight a concurrent git)
      //   fsmon   → core.fsmonitor/useBuiltinFSMonitor=false (no daemon fork)
      env['GIT_PAGER'] = 'cat'
      env['PAGER'] = 'cat'
      env['GIT_TERMINAL_PROMPT'] = '0'
      env['GIT_OPTIONAL_LOCKS'] = '0'
      const hasStdin = typeof opts.stdin === 'string'
      const spawnOpts: SpawnOptions = {
        env,
        stdio: [hasStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // Run in its own process group so we can SIGTERM the whole tree
        // on timeout — otherwise an fsmonitor / credential daemon spawned
        // by git survives long after git itself exited.
        detached: process.platform !== 'win32',
      }
      if (opts.cwd) spawnOpts.cwd = opts.cwd

      // --no-pager + -c disables for THIS invocation, no global mutation.
      const finalArgs = [
        '--no-pager',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.useBuiltinFSMonitor=false',
        '-c',
        'credential.helper=',
        ...args,
      ]

      const child = spawn('git', finalArgs, spawnOpts)
      if (spawnOpts.detached) child.unref()

      let stdout = ''
      let stderr = ''
      let settled = false

      const cleanup = (): void => {
        // Tear pipes down explicitly — some fds linger otherwise and pile
        // up across many invocations, eventually hitting the OS fd ceiling.
        try {
          child.stdout?.destroy()
        } catch {
          /* already closed */
        }
        try {
          child.stderr?.destroy()
        } catch {
          /* already closed */
        }
      }

      const settle = (result: SpawnResult): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      }

      const timer = setTimeout(() => {
        // Kill the whole process group — covers the helper daemons.
        try {
          if (spawnOpts.detached && typeof child.pid === 'number') {
            process.kill(-child.pid, 'SIGTERM')
          } else {
            child.kill('SIGTERM')
          }
        } catch {
          /* already dead */
        }
        settle({
          code: -1,
          stdout,
          stderr: stderr || `git ${finalArgs[finalArgs.length - args.length] ?? ''} timed out after 20s`,
        })
      }, 20_000)

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8')
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8')
      })
      child.on('error', (err) => {
        clearTimeout(timer)
        settle({ code: -1, stdout, stderr: stderr || err.message })
      })
      // 'exit' fires when the child process dies; 'close' waits for stdio
      // pipes to also close, which can hang forever when a grandchild
      // helper (fsmonitor daemon, credential-cache, gpg-agent) inherits
      // our pipes and keeps holding them open after git itself exits.
      child.on('exit', (code) => {
        clearTimeout(timer)
        settle({ code: code ?? -1, stdout, stderr })
      })
      if (hasStdin && child.stdin) {
        child.stdin.write(opts.stdin!)
        child.stdin.end()
      }
    })
  }
}

/** Anything past this is dropped with a footer so the renderer never has
 *  to parse / paint a multi-megabyte diff blob (package-lock.json staged
 *  changes alone can hit 15MB and freeze Electron's IPC serializer). */
const DIFF_SIZE_LIMIT = 512 * 1024 // 512 KB

function cap(diff: string): string {
  if (diff.length <= DIFF_SIZE_LIMIT) return diff
  const kept = diff.slice(0, DIFF_SIZE_LIMIT)
  const droppedBytes = diff.length - DIFF_SIZE_LIMIT
  return (
    kept +
    `\n\n[diff truncated — ${droppedBytes.toLocaleString()} more bytes hidden ` +
    `to keep the UI responsive; open the file directly to see the full contents]\n`
  )
}

async function isManagedPath(p: string): Promise<boolean> {
  // Resolve symlinks before matching so the check survives .hydra-ensemble links.
  let resolved = p
  try {
    resolved = await realpath(p)
  } catch {
    // Fall back to the raw path.
  }
  // Normalize using path.sep so the marker matches on Windows too.
  const normalized = resolved.split('/').join(path.sep)
  return normalized.includes(MANAGED_SUBPATH)
}

function mapStatusCode(code: string): ChangedFile['status'] | null {
  if (code === '??') return 'untracked'
  // Renames: either index or worktree slot is 'R'.
  if (code.includes('R')) return 'renamed'
  // Deleted: 'D' in either slot.
  if (code.includes('D')) return 'deleted'
  // Added: 'A' in index.
  if (code.includes('A')) return 'added'
  // Modified: anything else with 'M' in either slot.
  if (code.includes('M')) return 'modified'
  return null
}
