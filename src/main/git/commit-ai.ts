import { spawn } from 'node:child_process'
import { resolveClaudePath } from '../claude/resolve'
import type { GitOpResult } from '../../shared/types'
import type { WorktreeService } from './worktree'

/**
 * Drafts a commit message by spawning `claude -p` with the staged diff as
 * input. Runs completely out-of-band from any active session PTY so the
 * chat view isn't polluted. Falls back to the unstaged diff if nothing
 * is staged yet (makes the button useful even before the user stages).
 */
export class CommitAiService {
  constructor(private readonly worktree: WorktreeService) {}

  async generate(cwd: string): Promise<GitOpResult<string>> {
    const claude = resolveClaudePath()
    if (!claude) {
      return { ok: false, error: 'claude binary not found in PATH' }
    }

    const stagedDiff = await this.worktree.getDiff(cwd, undefined, true)
    if (!stagedDiff.ok) return { ok: false, error: stagedDiff.error }
    let diff = stagedDiff.value
    if (diff.trim().length === 0) {
      const unstaged = await this.worktree.getDiff(cwd, undefined, false)
      if (!unstaged.ok) return { ok: false, error: unstaged.error }
      diff = unstaged.value
    }
    if (diff.trim().length === 0) {
      return { ok: false, error: 'no changes to describe' }
    }

    // Budget: keep the prompt under ~30k chars to stay well inside any
    // model's input window. Truncate with a marker so the model knows
    // the diff is partial.
    const MAX = 30_000
    const truncated = diff.length > MAX
    const diffForPrompt = truncated ? diff.slice(0, MAX) + '\n\n[diff truncated]' : diff

    const prompt = [
      'Write a single conventional-commit message for this diff.',
      'Rules: one-line subject in imperative mood, ≤72 chars, no trailing period.',
      'Optional body: 1-2 short lines explaining WHY if the subject alone is not enough.',
      'Output the raw message only — no code fences, no preamble, no "Here is…".',
      '',
      '--- DIFF ---',
      diffForPrompt,
    ].join('\n')

    return new Promise<GitOpResult<string>>((resolve) => {
      const child = spawn(claude, ['-p', '--output-format', 'text'], {
        cwd,
        env: { ...process.env, CLAUDE_CONFIG_DIR: '' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })

      let stdout = ''
      let stderr = ''
      let settled = false
      const settle = (result: GitOpResult<string>): void => {
        if (settled) return
        settled = true
        resolve(result)
      }

      // Safety timeout — claude should respond well inside 60s, but guard
      // against a hang so the UI doesn't spin forever.
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        settle({ ok: false, error: 'claude timed out generating commit message' })
      }, 60_000)

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8')
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8')
      })
      child.on('error', (err) => {
        clearTimeout(timer)
        settle({ ok: false, error: err.message })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code !== 0) {
          settle({
            ok: false,
            error: stderr.trim() || `claude exited with code ${code}`,
          })
          return
        }
        const message = stripFences(stdout).trim()
        if (message.length === 0) {
          settle({ ok: false, error: 'claude returned an empty message' })
          return
        }
        settle({ ok: true, value: message })
      })

      child.stdin?.write(prompt)
      child.stdin?.end()
    })
  }
}

/** Strip accidental ```…``` fences some models still emit. */
function stripFences(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```')) return text
  const firstNl = trimmed.indexOf('\n')
  if (firstNl < 0) return text
  const inner = trimmed.slice(firstNl + 1)
  const closeIdx = inner.lastIndexOf('```')
  return closeIdx >= 0 ? inner.slice(0, closeIdx) : inner
}
