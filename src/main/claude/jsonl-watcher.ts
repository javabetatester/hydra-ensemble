import { existsSync, statSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { JsonlUpdate } from '../../shared/types'

// =============================================================================
// Pricing — derived from per-1M-token rates (mirrors Swift ModelPricing).
// =============================================================================

interface ModelPricing {
  inputPerToken: number
  outputPerToken: number
  cacheCreationPerToken: number // 1.25x input
  cacheReadPerToken: number // 0.1x input
}

function makePricing(inputPerMillion: number, outputPerMillion: number): ModelPricing {
  return {
    inputPerToken: inputPerMillion / 1_000_000,
    outputPerToken: outputPerMillion / 1_000_000,
    cacheCreationPerToken: (inputPerMillion * 1.25) / 1_000_000,
    cacheReadPerToken: (inputPerMillion * 0.1) / 1_000_000
  }
}

const PRICING: Record<string, ModelPricing> = {
  opus: makePricing(15, 75),
  sonnet: makePricing(3, 15),
  haiku: makePricing(0.25, 1.25)
}

// =============================================================================
// Public options
// =============================================================================

export interface JsonlWatcherOptions {
  sessionId: string
  claudeConfigDir: string
  cwd: string
  /** ISO-8601 moment our SessionMeta was created. Used to ignore JSONL
   *  files that predate this session (claude groups by cwd, not by our
   *  session id, so a prior session in the same cwd left a file behind). */
  sessionCreatedAt?: string
  onUpdate: (update: JsonlUpdate) => void
}

// =============================================================================
// Helpers (static-equivalents of the Swift helpers, exported for tests).
// =============================================================================

/**
 * Encode a directory path the way Claude Code does: replace `/` with `-`,
 * prepend `-`. Mirrors `SessionJSONLWatcher.encodePath`.
 */
export function encodePath(path: string): string {
  return '-' + path.slice(1).replace(/\//g, '-')
}

/**
 * Convert a full model identifier (e.g. "claude-opus-4-6") to the short name
 * used for pricing lookup. Falls back to the lowercased identifier.
 */
export function shortModelName(model: string): string {
  const lower = model.toLowerCase()
  if (lower.includes('opus')) return 'opus'
  if (lower.includes('haiku')) return 'haiku'
  if (lower.includes('sonnet')) return 'sonnet'
  return lower
}

type ContentBlock = { type?: string; text?: string; [k: string]: unknown }

interface SubStatus {
  status: string
  target?: string
}

const TOOL_VERB: Record<string, string> = {
  Read: 'reading',
  Write: 'writing',
  Edit: 'editing',
  Update: 'editing',
  MultiEdit: 'editing',
  NotebookEdit: 'editing',
  Bash: 'running',
  Grep: 'searching',
  Glob: 'finding',
  Task: 'delegating',
  WebFetch: 'fetching',
  WebSearch: 'searching',
  TodoWrite: 'planning'
}

function shortenTarget(s: string, max = 48): string {
  const trimmed = s.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max - 1) + '…'
}

function targetFromInput(name: string, input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined
  const pickStr = (k: string): string | undefined => {
    const v = input[k]
    return typeof v === 'string' && v.length > 0 ? v : undefined
  }
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'Update':
    case 'MultiEdit':
    case 'NotebookEdit':
      return pickStr('file_path') ?? pickStr('path') ?? pickStr('notebook_path')
    case 'Bash':
      return pickStr('command') ? shortenTarget(pickStr('command') as string) : undefined
    case 'Grep':
    case 'Glob':
      return pickStr('pattern') ?? pickStr('query')
    case 'Task':
      return pickStr('description') ? shortenTarget(pickStr('description') as string) : undefined
    case 'WebFetch':
      return pickStr('url')
    case 'WebSearch':
      return pickStr('query')
    case 'TodoWrite': {
      const todos = input['todos']
      return Array.isArray(todos) ? `${todos.length} item${todos.length === 1 ? '' : 's'}` : undefined
    }
    default:
      return undefined
  }
}

/**
 * Inspect a content array for the latest `tool_use` block and return the
 * verb + target snapshot suitable for rendering as the agent's substatus.
 */
export function extractSubStatus(content: unknown): SubStatus | null {
  if (!Array.isArray(content)) return null
  for (let i = content.length - 1; i >= 0; i--) {
    const raw = content[i]
    if (!raw || typeof raw !== 'object') continue
    const block = raw as ContentBlock
    if (block['type'] !== 'tool_use') continue
    const name = typeof block['name'] === 'string' ? (block['name'] as string) : ''
    if (!name) continue
    const verb = TOOL_VERB[name] ?? name.toLowerCase()
    const input =
      block['input'] && typeof block['input'] === 'object'
        ? (block['input'] as Record<string, unknown>)
        : undefined
    const target = targetFromInput(name, input)
    return target ? { status: verb, target } : { status: verb }
  }
  return null
}

/**
 * Extract concatenated text from a JSONL `content` field. The field can be
 * either a plain string (rare) or an array of `{"type": "text", ...}` blocks
 * interleaved with tool_use / tool_result blocks — only text blocks are kept.
 */
export function extractText(content: unknown): string | null {
  if (typeof content === 'string') {
    const trimmed = content.trim()
    return trimmed.length === 0 ? null : trimmed
  }
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const raw of content) {
    if (raw === null || typeof raw !== 'object') continue
    const block = raw as ContentBlock
    if (block.type !== 'text') continue
    if (typeof block.text === 'string') parts.push(block.text)
  }
  const joined = parts.join('\n').trim()
  return joined.length === 0 ? null : joined
}

// =============================================================================
// Watcher
// =============================================================================

const RESOLVE_POLL_MS = 3000
const TAIL_POLL_MS = 5000

/**
 * Watches a Claude Code JSONL session log and accumulates token usage / cost.
 *
 * Differs from the Swift implementation in two ways:
 *   1. Watches `<claudeConfigDir>/projects/<encoded-cwd>/` (the Electron
 *      version isolates `CLAUDE_CONFIG_DIR` per session) instead of
 *      `~/.claude/projects/...`.
 *   2. Uses Node's `fs.watch` (rename + change events) plus a periodic
 *      `fs.stat`-based poll as fallback, instead of DispatchSource + timer.
 */
export class JsonlWatcher {
  static readonly encodePath = encodePath
  static readonly extractText = extractText
  static readonly shortModelName = shortModelName

  private readonly sessionId: string
  private readonly onUpdate: (u: JsonlUpdate) => void
  private latestSubStatus: string | undefined
  private latestSubTarget: string | undefined
  private readonly projectDir: string
  /** Session start timestamp (ms). Any JSONL born before this minus a
   *  small margin is from a previous session in the same cwd. */
  private readonly createdAfterMs: number

  private totalCost = 0
  private totalTokensIn = 0
  private totalTokensOut = 0
  /** Snapshot of the MOST-RECENT assistant turn's input tokens
   *  (input + cache_creation + cache_read). Unlike totalTokensIn this
   *  is the model's current-context footprint — what the renderer
   *  needs to show a "context window % used" meter. */
  private latestContextTokens = 0
  private latestModel = 'sonnet'
  private latestAssistantText: string | undefined
  private latestAssistantAt: string | undefined

  private fileOffset = 0
  private watchedPath: string | null = null
  private fileWatcher: FSWatcher | null = null
  private dirWatcher: FSWatcher | null = null
  private resolveTimer: NodeJS.Timeout | null = null
  private tailTimer: NodeJS.Timeout | null = null
  private resolved = false
  private stopped = false

  // Single-flight guard: process events serially so concurrent writes don't
  // race on the shared offset.
  private processing = false
  private pendingProcess = false

  constructor(opts: JsonlWatcherOptions) {
    this.sessionId = opts.sessionId
    this.onUpdate = opts.onUpdate
    this.projectDir = join(opts.claudeConfigDir, 'projects', encodePath(opts.cwd))
    // 2000ms matches the transcript parser's margin — keep in sync so
    // both subsystems agree on which JSONL is "ours".
    this.createdAfterMs = opts.sessionCreatedAt
      ? new Date(opts.sessionCreatedAt).getTime() - 2000
      : -Infinity
    void this.resolveAndWatch()
  }

  stop(): void {
    this.stopped = true
    if (this.resolveTimer) {
      clearInterval(this.resolveTimer)
      this.resolveTimer = null
    }
    if (this.tailTimer) {
      clearInterval(this.tailTimer)
      this.tailTimer = null
    }
    if (this.fileWatcher) {
      try {
        this.fileWatcher.close()
      } catch {
        /* ignore */
      }
      this.fileWatcher = null
    }
    if (this.dirWatcher) {
      try {
        this.dirWatcher.close()
      } catch {
        /* ignore */
      }
      this.dirWatcher = null
    }
  }

  // ---------------------------------------------------------------------------
  // Resolution
  // ---------------------------------------------------------------------------

  private async resolveAndWatch(): Promise<void> {
    const initial = await this.findLatestJsonl()
    if (initial) {
      await this.startWatching(initial)
      return
    }
    this.startResolvePolling()
  }

  private startResolvePolling(): void {
    if (this.stopped || this.resolveTimer) return
    this.resolveTimer = setInterval(() => {
      void (async (): Promise<void> => {
        if (this.stopped || this.resolved) {
          if (this.resolveTimer) {
            clearInterval(this.resolveTimer)
            this.resolveTimer = null
          }
          return
        }
        const path = await this.findLatestJsonl()
        if (path) {
          if (this.resolveTimer) {
            clearInterval(this.resolveTimer)
            this.resolveTimer = null
          }
          await this.startWatching(path)
        }
      })()
    }, RESOLVE_POLL_MS)
  }

  private async findLatestJsonl(): Promise<string | null> {
    if (!existsSync(this.projectDir)) return null
    let entries: string[]
    try {
      entries = await readdir(this.projectDir)
    } catch {
      return null
    }
    let newest: string | null = null
    let newestMtime = -Infinity
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue
      const full = join(this.projectDir, name)
      try {
        const st = await stat(full)
        // Skip JSONL files from previous sessions in this same cwd.
        // birthtimeMs is 0 on filesystems that don't track it — ctimeMs
        // is the reliable fallback on Linux.
        const born = st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs
        if (born < this.createdAfterMs) continue
        const mtime = st.mtimeMs
        if (mtime > newestMtime) {
          newestMtime = mtime
          newest = full
        }
      } catch {
        // skip transient stat failure
      }
    }
    return newest
  }

  // ---------------------------------------------------------------------------
  // File watching
  // ---------------------------------------------------------------------------

  private async startWatching(path: string): Promise<void> {
    if (this.stopped) return
    this.resolved = true
    this.watchedPath = path

    // Process whatever's already on disk.
    await this.processNewData()

    // fs.watch emits 'change' (write/extend) and 'rename' events. Some
    // filesystems coalesce or drop change events under load, so we also
    // poll periodically as a fallback (mirrors the Swift 5s timer).
    try {
      this.fileWatcher = watch(path, () => {
        void this.processNewData()
      })
      this.fileWatcher.on('error', () => {
        // Filesystem watch failures fall through to the poll timer below.
      })
    } catch {
      // Some filesystems can't watch — poll-only mode still works.
    }

    this.tailTimer = setInterval(() => {
      void this.processNewData()
    }, TAIL_POLL_MS)
  }

  private async processNewData(): Promise<void> {
    if (this.stopped || !this.watchedPath) return
    if (this.processing) {
      this.pendingProcess = true
      return
    }
    this.processing = true
    try {
      do {
        this.pendingProcess = false
        await this.readChunk()
      } while (this.pendingProcess && !this.stopped)
    } finally {
      this.processing = false
    }
  }

  private async readChunk(): Promise<void> {
    const path = this.watchedPath
    if (!path) return
    let size: number
    try {
      size = statSync(path).size
    } catch {
      return
    }
    if (size <= this.fileOffset) return

    const handle = await open(path, 'r')
    try {
      const length = size - this.fileOffset
      const buf = Buffer.allocUnsafe(length)
      const { bytesRead } = await handle.read(buf, 0, length, this.fileOffset)
      if (bytesRead <= 0) return
      this.fileOffset += bytesRead
      const text = buf.subarray(0, bytesRead).toString('utf8')
      this.consumeText(text)
    } finally {
      await handle.close()
    }
  }

  private consumeText(text: string): void {
    const lines = text.split('\n')
    let didUpdate = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      if (this.parseAssistantLine(trimmed)) didUpdate = true
    }
    if (didUpdate) this.emit()
  }

  private parseAssistantLine(line: string): boolean {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return false
    }
    if (parsed === null || typeof parsed !== 'object') return false
    const obj = parsed as Record<string, unknown>
    if (obj['type'] !== 'assistant') return false
    const message = obj['message']
    if (message === null || typeof message !== 'object') return false
    const msg = message as Record<string, unknown>
    const usage = msg['usage']
    if (usage === null || typeof usage !== 'object') return false
    const u = usage as Record<string, unknown>

    const inputTokens = numberOr(u['input_tokens'], 0)
    const outputTokens = numberOr(u['output_tokens'], 0)
    const cacheCreationTokens = numberOr(u['cache_creation_input_tokens'], 0)
    const cacheReadTokens = numberOr(u['cache_read_input_tokens'], 0)

    const rawModel = msg['model']
    if (typeof rawModel === 'string') {
      this.latestModel = shortModelName(rawModel)
    }

    const text = extractText(msg['content'])
    if (text !== null) {
      this.latestAssistantText = text
      this.latestAssistantAt = new Date().toISOString()
    }

    const sub = extractSubStatus(msg['content'])
    if (sub) {
      this.latestSubStatus = sub.status
      this.latestSubTarget = sub.target
    }

    this.totalTokensIn += inputTokens + cacheCreationTokens + cacheReadTokens
    this.totalTokensOut += outputTokens
    // Each assistant turn reports the FULL input it saw. Overwriting
    // here (rather than summing) makes this a current-context gauge.
    this.latestContextTokens = inputTokens + cacheCreationTokens + cacheReadTokens

    const pricing = PRICING[this.latestModel] ?? PRICING['sonnet']!
    const inputCost = inputTokens * pricing.inputPerToken
    const cacheCreateCost = cacheCreationTokens * pricing.cacheCreationPerToken
    const cacheReadCost = cacheReadTokens * pricing.cacheReadPerToken
    const outputCost = outputTokens * pricing.outputPerToken
    this.totalCost += inputCost + cacheCreateCost + cacheReadCost + outputCost

    return true
  }

  private emit(): void {
    const update: JsonlUpdate = {
      sessionId: this.sessionId,
      // Round to 6 decimals so IPC payloads stay small and stable.
      cost: Math.round(this.totalCost * 1_000_000) / 1_000_000,
      tokensIn: this.totalTokensIn,
      tokensOut: this.totalTokensOut,
      contextTokens: this.latestContextTokens,
      model: this.latestModel
    }
    if (this.latestAssistantText !== undefined) {
      update.latestAssistantText = this.latestAssistantText
    }
    if (this.latestAssistantAt !== undefined) {
      update.latestAssistantAt = this.latestAssistantAt
    }
    if (this.latestSubStatus !== undefined) {
      update.subStatus = this.latestSubStatus
    }
    if (this.latestSubTarget !== undefined) {
      update.subTarget = this.latestSubTarget
    }
    this.onUpdate(update)
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
