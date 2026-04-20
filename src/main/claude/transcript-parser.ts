import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { TranscriptBlock, TranscriptMessage, TranscriptPayload } from '../../shared/types'
import { encodePath } from './jsonl-watcher'

/**
 * Parses a Claude Code session JSONL file into a typed transcript that a
 * renderer can display as a chat. Mirrors the JSONL shape emitted by the
 * Claude CLI:
 *
 *   { "type": "user" | "assistant" | "system", "message": {...}, "uuid": "...",
 *     "parentUuid": "...", "timestamp": "ISO-8601", ... }
 *
 * Each line's `message.content` is either a string or an array of content
 * blocks (`text`, `thinking`, `tool_use`, `tool_result`). We flatten those
 * into a `TranscriptBlock[]` so the UI doesn't have to replicate the
 * normalisation logic.
 */

interface RawContentBlock {
  type?: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
  [k: string]: unknown
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Best-effort string rendering for tool_result.content (string | blocks). */
function renderToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const raw of content) {
    const block = asObject(raw)
    if (!block) continue
    if (block['type'] === 'text' && typeof block['text'] === 'string') {
      parts.push(block['text'] as string)
    } else if (block['type'] === 'image') {
      parts.push('[image]')
    }
  }
  return parts.join('\n').trim()
}

function blocksFromContent(content: unknown): TranscriptBlock[] {
  // Plain-string content → single text block. Common for user messages.
  if (typeof content === 'string') {
    const text = content.trim()
    return text.length > 0 ? [{ kind: 'text', text }] : []
  }
  if (!Array.isArray(content)) return []

  const out: TranscriptBlock[] = []
  for (const raw of content) {
    const block = raw as RawContentBlock | null
    if (!block || typeof block !== 'object') continue
    const t = block.type
    if (t === 'text' && typeof block.text === 'string') {
      out.push({ kind: 'text', text: block.text })
    } else if (t === 'thinking' && typeof block.text === 'string') {
      out.push({ kind: 'thinking', text: block.text })
    } else if (t === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      out.push({
        kind: 'tool_use',
        id: block.id,
        name: block.name,
        input:
          block.input && typeof block.input === 'object'
            ? (block.input as Record<string, unknown>)
            : {}
      })
    } else if (t === 'tool_result' && typeof block.tool_use_id === 'string') {
      out.push({
        kind: 'tool_result',
        toolUseId: block.tool_use_id,
        text: renderToolResult(block.content),
        isError: block.is_error === true
      })
    }
  }
  return out
}

function parseLine(line: string, index: number): TranscriptMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  const obj = asObject(parsed)
  if (!obj) return null
  const type = obj['type']
  if (type !== 'user' && type !== 'assistant' && type !== 'system') return null

  const messageObj = asObject(obj['message'])
  const content = messageObj ? messageObj['content'] : obj['content']
  const blocks = blocksFromContent(content)
  if (blocks.length === 0 && type !== 'system') return null

  const msg: TranscriptMessage = {
    index,
    role: type,
    blocks,
    timestamp: asString(obj['timestamp'])
  }

  const uuid = asString(obj['uuid'])
  if (uuid) msg.uuid = uuid
  const parentUuid = asString(obj['parentUuid'])
  if (parentUuid) msg.parentUuid = parentUuid

  if (messageObj) {
    const model = asString(messageObj['model'])
    if (model) msg.model = model
    const usageObj = asObject(messageObj['usage'])
    if (usageObj) {
      msg.usage = {
        inputTokens: asNumber(usageObj['input_tokens']) ?? 0,
        outputTokens: asNumber(usageObj['output_tokens']) ?? 0,
        cacheCreationTokens: asNumber(usageObj['cache_creation_input_tokens']) ?? 0,
        cacheReadTokens: asNumber(usageObj['cache_read_input_tokens']) ?? 0
      }
    }
  }

  return msg
}

export function parseTranscriptText(text: string): TranscriptMessage[] {
  const out: TranscriptMessage[] = []
  let idx = 0
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    const msg = parseLine(line, idx)
    if (msg) {
      out.push(msg)
      idx++
    }
  }
  return out
}

/**
 * Find the most-recently-modified `.jsonl` inside `<claudeConfigDir>/projects/<encoded-cwd>/`.
 * Returns null if the directory or any jsonl file doesn't exist yet (fresh session).
 */
export async function findSessionJsonl(
  claudeConfigDir: string,
  cwd: string
): Promise<string | null> {
  const dir = join(claudeConfigDir, 'projects', encodePath(cwd))
  if (!existsSync(dir)) return null
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return null
  }
  let newest: string | null = null
  let newestMtime = -Infinity
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue
    const full = join(dir, name)
    try {
      const st = await stat(full)
      if (st.mtimeMs > newestMtime) {
        newestMtime = st.mtimeMs
        newest = full
      }
    } catch {
      // transient stat failure — skip
    }
  }
  return newest
}

/**
 * Read + parse the session's JSONL transcript. Safe to call on a cold session
 * (returns `{ path: null, messages: [] }` until claude writes the first line).
 */
export async function readTranscript(opts: {
  sessionId: string
  claudeConfigDir: string
  cwd: string
}): Promise<TranscriptPayload> {
  const path = await findSessionJsonl(opts.claudeConfigDir, opts.cwd)
  if (!path) {
    return { sessionId: opts.sessionId, path: null, messages: [] }
  }
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return { sessionId: opts.sessionId, path, messages: [] }
  }
  return {
    sessionId: opts.sessionId,
    path,
    messages: parseTranscriptText(text)
  }
}
