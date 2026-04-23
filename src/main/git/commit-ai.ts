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

  async generate(cwd: string, rules?: string): Promise<GitOpResult<string>> {
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

    // Budget: keep the prompt under ~60k chars to stay well inside any
    // model's input window. Truncate with a marker so the model knows
    // the diff is partial.
    const MAX = 60_000
    const truncated = diff.length > MAX
    const diffForPrompt = truncated ? diff.slice(0, MAX) + '\n\n[diff truncated]' : diff

    // Roughly count the distinct files in the diff so we can push the
    // model toward a bulleted body when the commit spans many files —
    // Haiku tends to compress everything into one short paragraph
    // otherwise.
    const fileCount = (diff.match(/^diff --git /gm) ?? []).length
    const multiFile = fileCount >= 3

    const userRules = (rules ?? '').trim()
    // Always emit one raw commit message, no chatter. The user's own rules
    // take precedence over any defaults — when they're present, we drop the
    // built-in subject-length/format rules so they can't contradict.
    const promptLines = [
      'Task: produce exactly one git commit message for the diff below.',
      'Output contract: raw message text only. No code fences, no preamble,',
      'no "Here is…", no explanation around it.',
    ]
    if (userRules.length > 0) {
      promptLines.push(
        '',
        '=== USER COMMIT RULES (HIGHEST PRIORITY — FOLLOW EXACTLY) ===',
        userRules,
        '=== END USER COMMIT RULES ===',
        '',
        'Every constraint above (format, scopes, types, subject length, body',
        'line width, language) is mandatory. If a scope is not in the allowed',
        'list, pick the closest one that IS allowed. Do not invent new scopes.',
        'Re-read the rules before answering and double-check the output matches.'
      )
    } else {
      promptLines.push(
        '',
        'Defaults (no user rules supplied):',
        '- one-line subject, imperative mood, ≤72 chars, no trailing period',
        '- body explaining WHY (multiple lines OK)'
      )
    }
    promptLines.push(
      '',
      `Body guidance (this diff touches ${fileCount} file${fileCount === 1 ? '' : 's'}):`,
      '- Write a body. Do NOT leave it blank unless the change is a true one-liner.',
      multiFile
        ? '- Use a bulleted list ("- …" one per line) enumerating EVERY meaningful change group. One bullet per distinct concern, not one per file. Aim for 3–8 bullets when the diff warrants it.'
        : '- 1–3 lines covering WHAT changed and WHY.',
      '- Ground every statement in the diff — do not invent behaviour that is not there.',
      '- Keep the subject short; put the detail in the body.'
    )
    promptLines.push('', '--- DIFF ---', diffForPrompt)
    const prompt = promptLines.join('\n')

    return new Promise<GitOpResult<string>>((resolve) => {
      // Strip CLAUDE_CONFIG_DIR so the spawned claude reads the host's
      // config (same pattern as pty/manager.ts and orchestra/agent-host.ts).
      // Setting it to '' would make claude treat '' as the config path.
      const env = { ...process.env }
      delete env.CLAUDE_CONFIG_DIR
      // Haiku for tiny one-file tweaks (cheap + fast); Sonnet once the diff
      // spans multiple files or gets large — Haiku starts compressing everything
      // into a one-line body when there's a lot to describe, and the user's
      // commit-rules language/format requirements benefit from the stronger
      // model too.
      const useSonnet = multiFile || diff.length > 4_000
      const model = useSonnet ? 'sonnet' : 'haiku'
      const child = spawn(claude, ['-p', '--model', model, '--output-format', 'text'], {
        cwd,
        env,
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
          // claude frequently writes its errors to stdout in -p mode (the
          // output-format controls normal output only). Surface whichever
          // stream actually has content, capped so the toast stays readable.
          const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join(' | ')
          const capped = detail.length > 500 ? detail.slice(0, 500) + '…' : detail
          settle({
            ok: false,
            error: capped
              ? `claude exited with code ${code}: ${capped}`
              : `claude exited with code ${code} (no output on stderr/stdout — bin=${claude})`,
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
