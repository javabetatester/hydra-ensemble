/**
 * AgentToolTimeline — compact live feed of tool-call events for one agent.
 *
 * Reads `useOrchestra().messageLog` reactively and shows the most recent
 * entries tied to `agentId` that look like tool calls. We treat two shapes as
 * tool calls:
 *   1. `kind === 'delegation'` — mapped to a synthetic `delegate_task` tool.
 *   2. `content` parses as JSON `{ tool, args }` — our tool-call convention.
 *
 * Duration: if the next (chronologically later) entry from the same agent is a
 * tool_result (JSON `{ tool_result }`, ideally matching `tool`), we render a
 * duration chip with the millisecond diff.
 *
 * Assumption about content JSON shape:
 *   - Tool call:   { "tool": "read_file", "args": { ... } | "string" }
 *   - Tool result: { "tool_result": <any>, "tool"?: "read_file" }
 *   Both come in as strings on `MessageLog.content` — we `JSON.parse` with
 *   try/catch and silently ignore non-JSON rows (except `delegation`).
 */

import { useMemo } from 'react'
import {
  CornerDownRight,
  Dot,
  FileEdit,
  FileText,
  Terminal,
  type LucideIcon
} from 'lucide-react'
import type { MessageLog } from '../../shared/orchestra'
import { useOrchestra } from './state/orchestra'

interface Props {
  agentId: string
  limit?: number
}

interface ToolCall {
  id: string
  at: string
  tool: string
  argsPreview: string
  durationMs: number | null
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  read_file: FileText,
  write_file: FileEdit,
  bash: Terminal,
  delegate_task: CornerDownRight
}

function iconFor(tool: string): LucideIcon {
  return TOOL_ICONS[tool] ?? Dot
}

/** Relative timestamp in the short style used elsewhere in the renderer. */
function relativeTime(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const sec = Math.max(0, Math.floor((now - then) / 1000))
  if (sec < 5) return 'now'
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  return `${day}d`
}

/** Best-effort parse. Returns `null` when the string is not JSON. */
function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

/** Renders args as a single truncated line. Objects are stringified compactly. */
function previewArgs(args: unknown, fallback: string): string {
  if (args === null || args === undefined) return fallback
  if (typeof args === 'string') return args.replace(/\s+/g, ' ').trim()
  try {
    return JSON.stringify(args).replace(/\s+/g, ' ')
  } catch {
    return fallback
  }
}

/** Extracts tool-call shape from a MessageLog entry, or null if it isn't one. */
function toToolCall(m: MessageLog): { tool: string; args: unknown } | null {
  if (m.kind === 'delegation') {
    const parsed = safeParse(m.content)
    const args =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : m.content
    return { tool: 'delegate_task', args }
  }
  const parsed = safeParse(m.content)
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  if (typeof obj.tool === 'string' && !('tool_result' in obj)) {
    return { tool: obj.tool, args: obj.args }
  }
  return null
}

/** Returns the matching tool-result entry for a given call, if any. */
function findToolResult(
  entries: MessageLog[],
  startIdx: number,
  tool: string
): MessageLog | null {
  for (let i = startIdx + 1; i < entries.length; i += 1) {
    const next = entries[i]
    if (!next) continue
    const parsed = safeParse(next.content)
    if (!parsed || typeof parsed !== 'object') continue
    const obj = parsed as Record<string, unknown>
    if (!('tool_result' in obj)) continue
    const resultTool = typeof obj.tool === 'string' ? obj.tool : null
    if (resultTool === null || resultTool === tool) return next
  }
  return null
}

export default function AgentToolTimeline({ agentId, limit = 20 }: Props) {
  const messageLog = useOrchestra((s) => s.messageLog)

  const calls = useMemo<ToolCall[]>(() => {
    // Keep chronological order (oldest first) for duration pairing.
    const scoped = messageLog.filter(
      (m) => m.fromAgentId === agentId || m.toAgentId === agentId
    )

    const out: ToolCall[] = []
    for (let i = 0; i < scoped.length; i += 1) {
      const m = scoped[i]
      if (!m) continue
      const call = toToolCall(m)
      if (!call) continue
      const result = findToolResult(scoped, i, call.tool)
      const durationMs = result
        ? Math.max(0, new Date(result.at).getTime() - new Date(m.at).getTime())
        : null
      out.push({
        id: m.id,
        at: m.at,
        tool: call.tool,
        argsPreview: previewArgs(call.args, m.content),
        durationMs
      })
    }

    // Newest first, capped.
    return out.reverse().slice(0, limit)
  }, [messageLog, agentId, limit])

  if (calls.length === 0) {
    return (
      <div className="px-2 py-1 text-[11px] font-mono text-text-4">
        No tool calls yet.
      </div>
    )
  }

  return (
    <ul className="flex flex-col font-mono">
      {calls.map((c) => {
        const Icon = iconFor(c.tool)
        return (
          <li
            key={c.id}
            className="flex items-center gap-2 border-b border-border-soft px-2 py-1 text-[11px] hover:bg-bg-3"
          >
            <span
              className="shrink-0 text-text-4 tabular-nums"
              title={new Date(c.at).toLocaleString()}
            >
              {relativeTime(c.at)}
            </span>
            <Icon
              size={12}
              strokeWidth={1.75}
              className="shrink-0 text-text-3"
              aria-hidden
            />
            <span className="shrink-0 text-text-1">{c.tool}</span>
            <span className="min-w-0 flex-1 truncate text-text-3" title={c.argsPreview}>
              {c.argsPreview}
            </span>
            {c.durationMs !== null && (
              <span className="shrink-0 rounded bg-bg-4 px-1 py-0.5 text-[10px] text-text-2 tabular-nums">
                {c.durationMs}ms
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
