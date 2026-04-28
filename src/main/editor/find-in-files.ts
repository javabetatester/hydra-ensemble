import { spawn, type SpawnOptions } from 'node:child_process'
import { homedir } from 'node:os'
import { isAbsolute, sep } from 'node:path'
import { realpath } from 'node:fs/promises'

export interface FindOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
  /**
   * Additional roots that are considered safe (besides the user's home).
   * Populated from the registered project list — a folder the user picked
   * via the OS dialog is treated as consented territory.
   */
  extraRoots?: readonly string[]
}

export interface FindMatch {
  /** Absolute file path. */
  file: string
  /** 1-based line number. */
  line: number
  /** Matched line, trimmed to a reasonable length for the UI. */
  text: string
}

export interface FindResult {
  matches: FindMatch[]
  /** True when the backend stopped early because we hit MAX_MATCHES. */
  truncated: boolean
  /** Which tool actually ran (useful for troubleshooting). */
  tool: 'git grep' | 'grep'
}

/** Absolute ceiling on returned matches — keeps the IPC payload bounded
 *  and the UI responsive even on huge projects. */
const MAX_MATCHES = 2000

/** Per-line truncation — a pathological minified file can have 100 KB
 *  lines that are useless to render. */
const MAX_LINE_CHARS = 400

/**
 * Search for `query` across `cwd`. Uses `git grep` inside a repo (honours
 * .gitignore) and falls back to plain `grep -rn` elsewhere. Either way,
 * the result is capped at MAX_MATCHES; the caller sees a `truncated` flag.
 */
export async function findInFiles(
  cwd: string,
  query: string,
  opts: FindOptions = {}
): Promise<{ ok: true; value: FindResult } | { ok: false; error: string }> {
  if (!isAbsolute(cwd)) return { ok: false, error: 'cwd must be absolute' }
  // Safety — keep searches within the user's home or any project root
  // they explicitly registered. Same policy as the editor fs bridge.
  try {
    const resolved = await realpath(cwd)
    const allowed = await isUnderAllowedRoot(resolved, opts.extraRoots ?? [])
    if (!allowed) {
      return { ok: false, error: 'cwd outside of allowed roots' }
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }

  const trimmed = query.trim()
  if (trimmed.length === 0) {
    return { ok: true, value: { matches: [], truncated: false, tool: 'grep' } }
  }

  const isRepo = await hasGit(cwd)
  const useGitGrep = isRepo

  const args: string[] = useGitGrep
    ? [
        '--no-pager',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'credential.helper=',
        'grep',
        '-n', // line numbers
        '-I', // skip binaries
        '--untracked', // include worktree-local untracked (honours .gitignore)
      ]
    : ['-rnI', '--binary-files=without-match']

  if (!opts.caseSensitive) args.push('-i')
  if (opts.wholeWord) args.push('-w')
  if (opts.regex) {
    if (useGitGrep) args.push('-E')
    // plain grep uses BRE by default; -E for ERE
    else args.push('-E')
  } else {
    args.push('-F') // fixed string (no regex escaping surprises)
  }

  // Separator so a query starting with '-' isn't read as a flag.
  args.push('-e', trimmed)
  if (!useGitGrep) args.push(cwd)

  const bin = useGitGrep ? 'git' : 'grep'
  const env: NodeJS.ProcessEnv = { ...process.env }
  // Matches WorktreeService.runGit's posture.
  delete env['GIT_DIR']
  delete env['GIT_WORK_TREE']
  env['GIT_PAGER'] = 'cat'
  env['PAGER'] = 'cat'
  env['GIT_TERMINAL_PROMPT'] = '0'

  const spawnOpts: SpawnOptions = {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  }

  return new Promise((resolve) => {
    const child = spawn(bin, args, spawnOpts)
    if (spawnOpts.detached) child.unref()

    let stdout = ''
    let stderr = ''
    let killedForCap = false
    let settled = false

    const settle = (res: { ok: true; value: FindResult } | { ok: false; error: string }): void => {
      if (settled) return
      settled = true
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
      resolve(res)
    }

    const timer = setTimeout(() => {
      try {
        if (spawnOpts.detached && typeof child.pid === 'number') {
          process.kill(-child.pid, 'SIGTERM')
        } else {
          child.kill('SIGTERM')
        }
      } catch {
        /* already dead */
      }
      settle({ ok: false, error: `${bin} timed out after 15s` })
    }, 15_000)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
      // Early exit if we've already collected enough — we can't know
      // line count without parsing, so approximate by scanning newlines.
      if (!killedForCap) {
        let count = 0
        for (let i = 0; i < stdout.length; i++) if (stdout.charCodeAt(i) === 10) count++
        if (count > MAX_MATCHES + 100) {
          killedForCap = true
          try {
            if (spawnOpts.detached && typeof child.pid === 'number') {
              process.kill(-child.pid, 'SIGTERM')
            } else {
              child.kill('SIGTERM')
            }
          } catch {
            /* ignore */
          }
        }
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      settle({ ok: false, error: err.message })
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      // grep exits 1 when there are no matches — treat as success.
      if (code !== 0 && code !== 1 && !killedForCap) {
        settle({ ok: false, error: stderr.trim() || `${bin} exited with code ${code}` })
        return
      }
      settle({ ok: true, value: parseMatches(stdout, cwd, useGitGrep, killedForCap) })
    })
  })
}

async function hasGit(cwd: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn('git', ['-C', cwd, 'rev-parse', '--is-inside-work-tree'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    let out = ''
    child.stdout?.on('data', (c: Buffer) => {
      out += c.toString('utf-8')
    })
    child.on('error', () => resolve(false))
    child.on('exit', (code) => resolve(code === 0 && out.trim() === 'true'))
  })
}

function parseMatches(
  raw: string,
  cwd: string,
  gitRelative: boolean,
  truncated: boolean
): FindResult {
  const matches: FindMatch[] = []
  for (const line of raw.split('\n')) {
    if (matches.length >= MAX_MATCHES) {
      truncated = true
      break
    }
    // Format: <path>:<line>:<text>
    const firstColon = line.indexOf(':')
    if (firstColon < 0) continue
    const secondColon = line.indexOf(':', firstColon + 1)
    if (secondColon < 0) continue
    const path = line.slice(0, firstColon)
    const lineNumStr = line.slice(firstColon + 1, secondColon)
    const lineNum = Number.parseInt(lineNumStr, 10)
    if (!Number.isFinite(lineNum)) continue
    const text = line.slice(secondColon + 1)
    const trimmed = text.length > MAX_LINE_CHARS ? text.slice(0, MAX_LINE_CHARS) + '…' : text
    // `git grep` already returns paths relative to cwd. Plain grep also
    // does when we pass `cwd` as the root arg. Canonicalise to absolute
    // so the UI can open the file via the existing editor bridge.
    const abs =
      gitRelative || !isAbsolute(path) ? joinCwd(cwd, path) : path
    matches.push({ file: abs, line: lineNum, text: trimmed })
  }
  return { matches, truncated, tool: gitRelative ? 'git grep' : 'grep' }
}

function joinCwd(cwd: string, rel: string): string {
  // Avoid path.join's platform quirks — we stay POSIX-ish since fs-bridge
  // also does. Handles the two forms grep emits.
  if (rel.startsWith('./')) rel = rel.slice(2)
  return cwd.endsWith('/') ? cwd + rel : cwd + '/' + rel
}

async function isUnderAllowedRoot(
  resolved: string,
  extraRoots: readonly string[]
): Promise<boolean> {
  if (containsPath(homedir(), resolved)) return true
  for (const root of extraRoots) {
    if (!isAbsolute(root)) continue
    let canonical: string
    try {
      canonical = await realpath(root)
    } catch {
      canonical = root
    }
    if (containsPath(canonical, resolved)) return true
  }
  return false
}

function containsPath(root: string, candidate: string): boolean {
  if (candidate === root) return true
  const norm = root.endsWith(sep) ? root : root + sep
  return candidate.startsWith(norm)
}
