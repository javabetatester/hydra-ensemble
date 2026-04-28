import { existsSync, statSync } from 'node:fs'
import { readdir, readFile, stat, open as fsOpen } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, normalize } from 'node:path'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import type { ClaudeSessionSummary } from '../../shared/types'

/** Validate the UUID component of a JSONL filename. Used both as a safety
 *  filter on disk listings and as defense-in-depth before splicing the id
 *  into a shell command. */
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

/** Encode a directory path the way Claude Code does: every non-alphanumeric
 *  becomes `-`. `/home/luancomputacao/.claude` → `-home-luancomputacao--claude`.
 *  Note this differs from `jsonl-watcher.ts:encodePath`, which only replaces
 *  `/`. That one's correct for paths without dots/special chars but misses
 *  hidden dirs and dotfile-style segments. */
export function encodeProjectPath(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '-')
}

/** Title length cap — keeps the sidebar tidy. The full first message is
 *  available in the JSONL itself if the user wants more. */
const MAX_TITLE_LEN = 80

/** Bytes to read from the tail of the JSONL to find the last
 *  `custom-title` / `agent-name`. Claude appends these lines whenever
 *  the session is renamed — the LAST one in the file is the current name.
 *  64 KB is generous: each title line is ~100-200 bytes. */
const TAIL_READ_BYTES = 64 * 1024

/** Cap for the head scan (branch + first user message fallback). */
const HEAD_SCAN_BYTES = 128 * 1024

interface JsonlMeta {
  title: string
  gitBranch?: string
  messageCount: number
}

function extractTextBlock(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string' && text.trim()) return text
    }
  }
  return undefined
}

function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return flat.slice(0, max - 1) + '…'
}

function stripQuotes(s: string): string {
  return s.replace(/^"|"$/g, '').trim()
}

/**
 * Read the last `custom-title` or `agent-name` from the JSONL by reading
 * the tail of the file. This is O(TAIL_READ_BYTES) regardless of file size.
 * Returns the best name found (customTitle takes priority over agentName).
 */
async function readTailName(filePath: string, fileSize: number): Promise<string> {
  const start = Math.max(0, fileSize - TAIL_READ_BYTES)
  const fh = await fsOpen(filePath, 'r')
  try {
    const buf = Buffer.alloc(Math.min(TAIL_READ_BYTES, fileSize))
    await fh.read(buf, 0, buf.length, start)
    const text = buf.toString('utf8')
    // Split into lines — the first line may be partial (we started mid-line),
    // but we only care about complete JSON lines containing title/name.
    const lines = text.split('\n')

    let bestTitle = ''
    let bestAgent = ''
    for (const line of lines) {
      if (!line.trim()) continue
      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      if (obj['type'] === 'custom-title') {
        const ct = obj['customTitle']
        if (typeof ct === 'string' && ct.trim()) bestTitle = stripQuotes(ct)
      }
      if (obj['type'] === 'agent-name') {
        const an = obj['agentName']
        if (typeof an === 'string' && an.trim()) bestAgent = stripQuotes(an)
      }
    }
    return bestTitle || bestAgent
  } finally {
    await fh.close()
  }
}

/**
 * Scan the head of the JSONL for the first user message (fallback title),
 * git branch, and a rough message count (capped at 50 for perf).
 */
async function readHeadMeta(
  filePath: string
): Promise<{ firstUserMessage: string; gitBranch?: string; messageCount: number }> {
  let firstUserMessage = ''
  let gitBranch: string | undefined
  let messageCount = 0
  let bytesScanned = 0

  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  try {
    for await (const line of rl) {
      bytesScanned += Buffer.byteLength(line, 'utf8') + 1
      if (!line.trim()) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }
      if (!parsed || typeof parsed !== 'object') continue
      const obj = parsed as Record<string, unknown>
      const type = obj['type']

      if (type === 'user' || type === 'assistant') {
        messageCount += 1
        if (!firstUserMessage && type === 'user') {
          const message = obj['message'] as { content?: unknown } | undefined
          const text = extractTextBlock(message?.content)
          if (text) {
            firstUserMessage = truncate(text, MAX_TITLE_LEN)
            const branch = obj['gitBranch']
            if (typeof branch === 'string' && branch) gitBranch = branch
          }
        }
      }

      if (messageCount >= 50) break
      if (bytesScanned >= HEAD_SCAN_BYTES && firstUserMessage) break
    }
  } finally {
    rl.close()
    stream.destroy()
  }

  return { firstUserMessage, gitBranch, messageCount }
}

/**
 * Two-phase read:
 *  1. Tail — read last 64 KB for the most recent custom-title / agent-name.
 *  2. Head — read first lines for branch, first user message (fallback), msg count.
 */
async function readJsonlMeta(filePath: string, fileSize: number): Promise<JsonlMeta> {
  // Phase 1: tail scan for session name
  const tailName = fileSize > 0 ? await readTailName(filePath, fileSize) : ''

  // Phase 2: head scan for branch + fallback title + message count
  const head = await readHeadMeta(filePath)

  return {
    title: tailName || head.firstUserMessage,
    gitBranch: head.gitBranch,
    messageCount: head.messageCount
  }
}

/**
 * Reader over `~/.claude/projects/<encoded-cwd>/*.jsonl` — Claude's session
 * archive for a given project root. Pure on-demand; nothing cached, nothing
 * persisted by Hydra. The Claude CLI is the source of truth.
 */
export class ClaudeSessionsReader {
  private readonly claudeRoot: string

  constructor(opts?: { claudeRoot?: string }) {
    this.claudeRoot = opts?.claudeRoot ?? join(homedir(), '.claude')
  }

  /** Sessions for `projectPath`, sorted recency-first. Shows all sessions
   *  on disk — no active-process filtering, matching the behavior of
   *  Claude's own `/resume` command. */
  async listForProject(projectPath: string): Promise<ClaudeSessionSummary[]> {
    const dir = join(this.claudeRoot, 'projects', encodeProjectPath(projectPath))
    if (!existsSync(dir)) return []
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return []
    }
    const candidates = entries.filter((name) => {
      if (!name.endsWith('.jsonl')) return false
      const id = name.slice(0, -'.jsonl'.length)
      return UUID_RE.test(id)
    })
    if (candidates.length === 0) return []

    const summaries = await Promise.all(
      candidates.map(async (name): Promise<ClaudeSessionSummary | null> => {
        const sessionId = name.slice(0, -'.jsonl'.length)
        const filePath = join(dir, name)
        let mtimeMs: number
        let fileSize: number
        try {
          const st = await stat(filePath)
          mtimeMs = st.mtimeMs
          fileSize = st.size
        } catch {
          return null
        }
        let meta: JsonlMeta
        try {
          meta = await readJsonlMeta(filePath, fileSize)
        } catch {
          meta = { title: '', messageCount: 0 }
        }
        return {
          sessionId,
          title: meta.title,
          mtime: new Date(mtimeMs).toISOString(),
          gitBranch: meta.gitBranch,
          messageCount: meta.messageCount
        }
      })
    )

    return summaries
      .filter((s): s is ClaudeSessionSummary => s !== null)
      .sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0))
  }

  /**
   * Set of Claude session UUIDs that are currently being driven by some
   * live `claude` process whose cwd matches `projectPath`. Read from
   * `~/.claude/sessions/<pid>.json`, skipping records whose PID is no
   * longer alive (orphaned crash/stale files).
   */
  async getActiveSessionIds(projectPath: string): Promise<Set<string>> {
    const dir = join(this.claudeRoot, 'sessions')
    if (!existsSync(dir)) return new Set()
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return new Set()
    }
    const wantedCwd = normalize(projectPath)
    const out = new Set<string>()
    await Promise.all(
      entries.map(async (name) => {
        if (!name.endsWith('.json')) return
        const pidStr = basename(name, '.json')
        const pid = Number.parseInt(pidStr, 10)
        if (!Number.isFinite(pid) || pid <= 0) return
        if (!isPidAlive(pid)) return
        let raw: string
        try {
          raw = await readFile(join(dir, name), 'utf8')
        } catch {
          return
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          return
        }
        if (!parsed || typeof parsed !== 'object') return
        const obj = parsed as { sessionId?: unknown; cwd?: unknown }
        if (typeof obj.sessionId !== 'string' || typeof obj.cwd !== 'string') return
        if (!UUID_RE.test(obj.sessionId)) return
        if (normalize(obj.cwd) !== wantedCwd) return
        out.add(obj.sessionId)
      })
    )
    return out
  }
}

function isPidAlive(pid: number): boolean {
  try {
    // Signal 0 — kernel only checks permission/existence, doesn't deliver.
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // EPERM means the process exists but we can't signal it (different uid).
    // For our purposes "still running" is the right answer.
    return code === 'EPERM'
  }
}

export { UUID_RE as CLAUDE_SESSION_ID_RE }
