import { spawn } from 'node:child_process'
import type {
  GitOpResult,
  PRCheck,
  PRDetail,
  PRInfo
} from '../../shared/types'

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

const PR_FIELDS = [
  'number',
  'title',
  'state',
  'author',
  'url',
  'headRefName',
  'baseRefName',
  'isDraft',
  'updatedAt'
].join(',')

const PR_DETAIL_FIELDS = [...PR_FIELDS.split(','), 'body'].join(',')

interface RawAuthor {
  login?: string
  name?: string
}

interface RawPR {
  number: number
  title: string
  state: string
  author: RawAuthor | string | null
  url: string
  headRefName: string
  baseRefName: string
  isDraft: boolean
  updatedAt: string
  body?: string
}

/**
 * Wrapper around the `gh` CLI for the PR inspector. Each method runs gh
 * in a given cwd and returns a `GitOpResult` so the renderer can show a
 * specific error (gh missing, not authed, repo has no remote, etc.).
 */
export class GhService {
  async listPRs(cwd: string): Promise<GitOpResult<PRInfo[]>> {
    const res = await this.runGh(
      ['pr', 'list', '--json', PR_FIELDS, '--limit', '50'],
      cwd
    )
    if (res.code !== 0) {
      return { ok: false, error: this.friendlyError(res) }
    }
    let parsed: RawPR[]
    try {
      parsed = JSON.parse(res.stdout) as RawPR[]
    } catch (err) {
      return { ok: false, error: `failed to parse gh output: ${(err as Error).message}` }
    }
    return { ok: true, value: parsed.map((p) => this.mapPR(p)) }
  }

  async getPR(cwd: string, number: number): Promise<GitOpResult<PRDetail>> {
    const view = await this.runGh(
      ['pr', 'view', String(number), '--json', PR_DETAIL_FIELDS],
      cwd
    )
    if (view.code !== 0) {
      return { ok: false, error: this.friendlyError(view) }
    }
    let raw: RawPR
    try {
      raw = JSON.parse(view.stdout) as RawPR
    } catch (err) {
      return { ok: false, error: `failed to parse gh output: ${(err as Error).message}` }
    }

    const [diff, checks] = await Promise.all([
      this.runGh(['pr', 'diff', String(number)], cwd),
      this.runGh(['pr', 'checks', String(number)], cwd)
    ])

    const detail: PRDetail = {
      ...this.mapPR(raw),
      body: raw.body ?? '',
      diff: diff.code === 0 ? diff.stdout : '',
      checks: checks.code === 0 ? this.parseChecks(checks.stdout) : []
    }
    return { ok: true, value: detail }
  }

  /**
   * Submit a review. `approve` and `comment` may omit the body; `request-changes`
   * requires a non-empty body (gh itself rejects it otherwise, but we also guard
   * here so the renderer gets a clean error instead of a raw gh message).
   */
  async review(
    cwd: string,
    number: number,
    decision: 'approve' | 'request-changes' | 'comment',
    body?: string
  ): Promise<GitOpResult> {
    if (decision === 'request-changes' && (!body || !body.trim())) {
      return { ok: false, error: 'a comment is required when requesting changes' }
    }
    const flag =
      decision === 'approve'
        ? '--approve'
        : decision === 'request-changes'
          ? '--request-changes'
          : '--comment'
    const args = ['pr', 'review', String(number), flag]
    if (body && body.trim().length > 0) {
      args.push('-b', body)
    }
    const res = await this.runGh(args, cwd)
    if (res.code !== 0) return { ok: false, error: this.friendlyError(res) }
    return { ok: true, value: undefined }
  }

  async comment(cwd: string, number: number, body: string): Promise<GitOpResult> {
    if (!body.trim()) {
      return { ok: false, error: 'comment body cannot be empty' }
    }
    const res = await this.runGh(['pr', 'comment', String(number), '-b', body], cwd)
    if (res.code !== 0) return { ok: false, error: this.friendlyError(res) }
    return { ok: true, value: undefined }
  }

  /** `--auto` queues the merge once checks pass; `--squash` matches the
   *  team default. Error is returned verbatim so the caller can show e.g.
   *  "auto-merge is not allowed for this repository". */
  async merge(cwd: string, number: number): Promise<GitOpResult> {
    const res = await this.runGh(
      ['pr', 'merge', String(number), '--auto', '--squash'],
      cwd
    )
    if (res.code !== 0) return { ok: false, error: this.friendlyError(res) }
    return { ok: true, value: undefined }
  }

  async close(cwd: string, number: number): Promise<GitOpResult> {
    const res = await this.runGh(['pr', 'close', String(number)], cwd)
    if (res.code !== 0) return { ok: false, error: this.friendlyError(res) }
    return { ok: true, value: undefined }
  }

  private mapPR(raw: RawPR): PRInfo {
    const authorLogin =
      typeof raw.author === 'string'
        ? raw.author
        : (raw.author?.login ?? raw.author?.name ?? 'unknown')
    const state = raw.state as PRInfo['state']
    return {
      number: raw.number,
      title: raw.title,
      state: state === 'OPEN' || state === 'CLOSED' || state === 'MERGED' ? state : 'OPEN',
      author: authorLogin,
      url: raw.url,
      headRefName: raw.headRefName,
      baseRefName: raw.baseRefName,
      isDraft: raw.isDraft,
      updatedAt: raw.updatedAt
    }
  }

  /** `gh pr checks` outputs a TSV-ish line per check. Parse loosely. */
  private parseChecks(stdout: string): PRCheck[] {
    const lines = stdout.split('\n').filter((l) => l.trim().length > 0)
    return lines.map((line) => {
      const cols = line.split('\t')
      const name = cols[0]?.trim() ?? 'check'
      const stateRaw = (cols[1] ?? '').trim().toLowerCase()
      const url = cols[3]?.trim() || undefined
      let status: PRCheck['status'] = 'unknown'
      let conclusion: PRCheck['conclusion']
      if (stateRaw === 'pass' || stateRaw === 'success') {
        status = 'completed'
        conclusion = 'success'
      } else if (stateRaw === 'fail' || stateRaw === 'failure') {
        status = 'completed'
        conclusion = 'failure'
      } else if (stateRaw === 'pending' || stateRaw === 'queued') {
        status = 'queued'
      } else if (stateRaw === 'in_progress' || stateRaw === 'running') {
        status = 'in_progress'
      } else if (stateRaw === 'skipping' || stateRaw === 'skipped') {
        status = 'completed'
        conclusion = 'skipped'
      }
      return { name, status, conclusion, url }
    })
  }

  private friendlyError(res: RunResult): string {
    const msg = (res.stderr || res.stdout || '').trim()
    if (/command not found|ENOENT/i.test(msg)) {
      return 'gh CLI is not installed (https://cli.github.com)'
    }
    if (/not authenticated/i.test(msg) || /gh auth login/i.test(msg)) {
      return 'gh CLI is not authenticated — run `gh auth login`'
    }
    return msg || `gh exited with code ${res.code}`
  }

  private runGh(args: string[], cwd: string): Promise<RunResult> {
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      try {
        const child = spawn('gh', args, { cwd })
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf-8')
        })
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf-8')
        })
        child.on('error', (err) => {
          resolve({ code: -1, stdout, stderr: stderr || err.message })
        })
        child.on('close', (code) => {
          resolve({ code: code ?? -1, stdout, stderr })
        })
      } catch (err) {
        resolve({ code: -1, stdout: '', stderr: (err as Error).message })
      }
    })
  }
}
