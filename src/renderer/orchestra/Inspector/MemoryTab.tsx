import { useMemo, useState } from 'react'
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  RotateCcw,
  Wrench
} from 'lucide-react'
import type { Agent, MessageLog, Task, TaskStatus } from '../../../shared/orchestra'
import { useOrchestra } from '../state/orchestra'

interface Props {
  agent: Agent
}

/** Local cap on how many recent messages we pull into the conversation view.
 *  The store caps messageLog at 500 globally; this slices the last 40 for
 *  this specific agent so the tab stays readable without truncation logic. */
const RECENT_LIMIT = 40

/** Cap on the "files touched" list. Anything beyond this is hidden — an agent
 *  that churns through hundreds of files would otherwise drown out the tab. */
const FILES_LIMIT = 20

type SectionKey = 'recent' | 'files' | 'tools' | 'sessions'

/** Tailwind for the task-status pill. Covers every TaskStatus value so the
 *  switch is exhaustive and easy to update when new statuses land. */
function statusPillStyles(status: TaskStatus): string {
  switch (status) {
    case 'in_progress':
      return 'bg-status-generating/15 text-status-generating'
    case 'blocked':
      return 'bg-status-input/15 text-status-input'
    case 'failed':
      return 'bg-status-attention/15 text-status-attention'
    case 'done':
      return 'bg-accent-500/15 text-accent-400'
    case 'routing':
    case 'queued':
    default:
      return 'bg-bg-3 text-text-3'
  }
}

/** `HH:MM:SS` in local time — compact marker for each message row. Avoids the
 *  full ISO string that would blow up the 11px layout. */
function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--:--:--'
  const pad2 = (n: number): string => n.toString().padStart(2, '0')
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/** Try to parse a message's content as JSON and return a `path` string field.
 *  Anything that isn't a JSON object with a string `path` returns null so the
 *  caller can simply filter nulls out. Swallows parse errors by design — most
 *  messages are free-form text, not structured payloads. */
function extractPath(content: string): string | null {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const candidate = (parsed as Record<string, unknown>).path
      if (typeof candidate === 'string' && candidate.length > 0) return candidate
    }
  } catch {
    return null
  }
  return null
}

/** Heuristic: pull a tool name out of a status/output message. Looks for
 *  `tool:<name>`, `[tool] <name>`, or a JSON `{ "tool": "..." }` shape. If
 *  nothing matches we return null so the reducer skips it. */
function extractToolName(m: MessageLog): string | null {
  const content = m.content.trim()

  // JSON envelope — common for structured adapter output.
  if (content.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(content)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const t = (parsed as Record<string, unknown>).tool
        if (typeof t === 'string' && t.length > 0) return t
      }
    } catch {
      // fall through to string heuristics
    }
  }

  // `tool:Read` or `tool=Read`
  const inline = /\btool[:=]\s*([A-Za-z0-9_\-.]+)/.exec(content)
  if (inline && inline[1]) return inline[1]

  // `[tool] Read`
  const bracket = /^\[tool\]\s+([A-Za-z0-9_\-.]+)/.exec(content)
  if (bracket && bracket[1]) return bracket[1]

  return null
}

/** Group a list of messages by taskId. `null` (no task) becomes a pseudo-
 *  bucket keyed by the string `'_no_task'` so the UI can still render it. */
function groupByTask(entries: MessageLog[]): Array<{ taskId: string; items: MessageLog[] }> {
  const map = new Map<string, MessageLog[]>()
  for (const m of entries) {
    const key = m.taskId ?? '_no_task'
    const bucket = map.get(key)
    if (bucket) bucket.push(m)
    else map.set(key, [m])
  }
  return Array.from(map.entries()).map(([taskId, items]) => ({ taskId, items }))
}

export default function MemoryTab({ agent }: Props) {
  const messageLog = useOrchestra((s) => s.messageLog)
  const tasks = useOrchestra((s) => s.tasks)

  // Collapse state is section-scoped. Defaults mirror the order the user
  // would normally scan: recent convo open, everything else open too since
  // the tab is empty on first paint anyway.
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    recent: true,
    files: true,
    tools: true,
    sessions: true
  })
  // Per-task collapse inside the "recent conversation" section.
  const [taskOpen, setTaskOpen] = useState<Record<string, boolean>>({})
  const [copyStatus, setCopyStatus] = useState<'idle' | 'ok' | 'err'>('idle')

  // All messages involving this agent, newest first, capped at RECENT_LIMIT.
  // We include `toAgentId === agent.id` too so incoming delegations show up
  // in the memory — not just the agent's own outputs.
  const recent = useMemo<MessageLog[]>(() => {
    const all = messageLog.filter(
      (m) => m.fromAgentId === agent.id || m.toAgentId === agent.id
    )
    return all.slice(-RECENT_LIMIT).reverse()
  }, [messageLog, agent.id])

  const groupedRecent = useMemo(() => groupByTask(recent), [recent])

  // Files touched — only look at the agent's *own* output messages, since
  // incoming delegations are author-side not file-side. Dedupe by path,
  // preserve first-seen order, then cap.
  const filesTouched = useMemo<string[]>(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const m of messageLog) {
      if (m.fromAgentId !== agent.id) continue
      if (m.kind !== 'output') continue
      const path = extractPath(m.content)
      if (!path || seen.has(path)) continue
      seen.add(path)
      out.push(path)
      if (out.length >= FILES_LIMIT) break
    }
    return out
  }, [messageLog, agent.id])

  // Tool usage counts — map/reduce over the agent's own messages. Sorted
  // descending so the most-used tools surface first.
  const toolCounts = useMemo<Array<{ name: string; count: number }>>(() => {
    const counts = new Map<string, number>()
    for (const m of messageLog) {
      if (m.fromAgentId !== agent.id) continue
      const name = extractToolName(m)
      if (!name) continue
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [messageLog, agent.id])

  // Sessions / runs = tasks this agent was assigned, newest first. We sort
  // by createdAt desc so the most recent run is at the top of the list.
  const assignedTasks = useMemo<Task[]>(() => {
    return tasks
      .filter((t) => t.assignedAgentId === agent.id)
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }, [tasks, agent.id])

  // Quick lookup: taskId -> title, so the recent-conversation grouping can
  // surface a human-readable label next to the synthetic "_no_task" bucket.
  const taskTitleById = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>()
    for (const t of tasks) m.set(t.id, t.title)
    return m
  }, [tasks])

  const toggleSection = (key: SectionKey): void => {
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const toggleTask = (taskId: string): void => {
    setTaskOpen((prev) => ({ ...prev, [taskId]: !(prev[taskId] ?? true) }))
  }

  /** Dispatches a custom DOM event the store will eventually listen to. This
   *  is intentionally a DOM event rather than a zustand action because the
   *  corresponding `clearAgentMessages` reducer hasn't landed yet — see TODO
   *  below. Once it lands, this handler can call the action directly. */
  const handleClear = (): void => {
    // TODO: replace with `useOrchestra.getState().clearAgentMessages(agent.id)`
    // once that action is implemented in the store.
    const evt = new CustomEvent('orchestra:clear-agent-messages', {
      detail: { agentId: agent.id }
    })
    window.dispatchEvent(evt)
  }

  /** Render the grouped conversation as a plain-text block and shove it into
   *  the clipboard. We keep the format trivially greppable (timestamp + kind
   *  + content) so it's useful to paste into an issue or a prompt. */
  const handleCopy = async (): Promise<void> => {
    const lines: string[] = []
    for (const group of groupedRecent) {
      const label =
        group.taskId === '_no_task'
          ? '(no task)'
          : (taskTitleById.get(group.taskId) ?? group.taskId.slice(0, 8))
      lines.push(`## ${label}`)
      // Items are newest-first in `recent`; flip per-group to chronological
      // so the exported text reads top-to-bottom naturally.
      for (const m of [...group.items].reverse()) {
        lines.push(`[${formatTime(m.at)}] ${m.kind.toUpperCase()}: ${m.content}`)
      }
      lines.push('')
    }
    const text = lines.join('\n').trimEnd()
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus('ok')
    } catch {
      setCopyStatus('err')
    }
    window.setTimeout(() => setCopyStatus('idle'), 1500)
  }

  return (
    <div className="df-scroll h-full overflow-y-auto p-3">
      <div className="flex flex-col gap-3">
        {/* header row: title + actions */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-text-2">
            <Brain size={14} strokeWidth={1.75} aria-hidden />
            <span className="text-[12px] font-semibold lowercase tracking-wide">
              memory
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 rounded-sm border border-border-soft bg-bg-2 px-1.5 py-0.5 font-mono text-[10px] text-text-2 hover:border-border-mid hover:text-text-1"
              title="copy conversation as plain text"
            >
              <Copy size={10} strokeWidth={1.75} />
              {copyStatus === 'ok' ? 'copied' : copyStatus === 'err' ? 'failed' : 'copy'}
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="flex items-center gap-1 rounded-sm border border-border-soft bg-bg-2 px-1.5 py-0.5 font-mono text-[10px] text-text-2 hover:border-status-attention/40 hover:text-status-attention"
              title="clear local memory for this agent"
            >
              <RotateCcw size={10} strokeWidth={1.75} />
              clear
            </button>
          </div>
        </div>

        {/* 1. Recent conversation */}
        <section className="rounded-md border border-border-soft bg-bg-1">
          <button
            type="button"
            onClick={() => toggleSection('recent')}
            className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium text-text-2 hover:text-text-1"
            aria-expanded={open.recent}
          >
            {open.recent ? (
              <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
            ) : (
              <ChevronRight size={12} strokeWidth={1.75} aria-hidden />
            )}
            <Brain size={12} strokeWidth={1.75} aria-hidden />
            <span className="lowercase">recent conversation</span>
            <span className="ml-auto font-mono text-[10px] text-text-4">
              {recent.length}
            </span>
          </button>
          {open.recent && (
            <div className="border-t border-border-soft px-2.5 py-2">
              {groupedRecent.length === 0 ? (
                <div className="py-3 text-center text-[11px] text-text-4">
                  no recent activity
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {groupedRecent.map((group) => {
                    const expanded = taskOpen[group.taskId] ?? true
                    const label =
                      group.taskId === '_no_task'
                        ? '(no task)'
                        : (taskTitleById.get(group.taskId) ??
                          group.taskId.slice(0, 8))
                    return (
                      <li
                        key={group.taskId}
                        className="rounded-sm border border-border-soft bg-bg-2"
                      >
                        <button
                          type="button"
                          onClick={() => toggleTask(group.taskId)}
                          className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] text-text-2 hover:text-text-1"
                          aria-expanded={expanded}
                        >
                          {expanded ? (
                            <ChevronDown
                              size={10}
                              strokeWidth={1.75}
                              aria-hidden
                            />
                          ) : (
                            <ChevronRight
                              size={10}
                              strokeWidth={1.75}
                              aria-hidden
                            />
                          )}
                          <span className="truncate">{label}</span>
                          <span className="ml-auto font-mono text-[10px] text-text-4">
                            {group.items.length}
                          </span>
                        </button>
                        {expanded && (
                          <ul className="flex flex-col gap-1 border-t border-border-soft px-2 py-1.5">
                            {group.items.map((m) => (
                              <li key={m.id} className="font-mono text-[11px]">
                                <div className="flex items-center gap-1.5 text-text-4">
                                  <span className="tabular-nums">
                                    {formatTime(m.at)}
                                  </span>
                                  <span className="uppercase tracking-wide text-[9px]">
                                    {m.kind}
                                  </span>
                                </div>
                                <pre className="mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-snug text-text-1">
                                  {m.content}
                                </pre>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* 2. Files touched */}
        <section className="rounded-md border border-border-soft bg-bg-1">
          <button
            type="button"
            onClick={() => toggleSection('files')}
            className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium text-text-2 hover:text-text-1"
            aria-expanded={open.files}
          >
            {open.files ? (
              <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
            ) : (
              <ChevronRight size={12} strokeWidth={1.75} aria-hidden />
            )}
            <FileText size={12} strokeWidth={1.75} aria-hidden />
            <span className="lowercase">files touched</span>
            <span className="ml-auto font-mono text-[10px] text-text-4">
              {filesTouched.length}
            </span>
          </button>
          {open.files && (
            <div className="border-t border-border-soft px-2.5 py-2">
              {filesTouched.length === 0 ? (
                <div className="py-3 text-center text-[11px] text-text-4">
                  no structured file output recorded
                </div>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {filesTouched.map((p) => (
                    <li
                      key={p}
                      className="truncate rounded-sm px-1.5 py-0.5 font-mono text-[11px] text-text-1 hover:bg-bg-2"
                      title={p}
                    >
                      {p}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* 3. Tools used */}
        <section className="rounded-md border border-border-soft bg-bg-1">
          <button
            type="button"
            onClick={() => toggleSection('tools')}
            className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium text-text-2 hover:text-text-1"
            aria-expanded={open.tools}
          >
            {open.tools ? (
              <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
            ) : (
              <ChevronRight size={12} strokeWidth={1.75} aria-hidden />
            )}
            <Wrench size={12} strokeWidth={1.75} aria-hidden />
            <span className="lowercase">tools used</span>
            <span className="ml-auto font-mono text-[10px] text-text-4">
              {toolCounts.length}
            </span>
          </button>
          {open.tools && (
            <div className="border-t border-border-soft px-2.5 py-2">
              {toolCounts.length === 0 ? (
                <div className="py-3 text-center text-[11px] text-text-4">
                  no tool invocations detected
                </div>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {toolCounts.map((t) => (
                    <li
                      key={t.name}
                      className="flex items-center justify-between gap-2 rounded-sm px-1.5 py-0.5 font-mono text-[11px] text-text-1 hover:bg-bg-2"
                    >
                      <span className="truncate">{t.name}</span>
                      <span className="shrink-0 rounded-sm bg-bg-3 px-1.5 py-0.5 text-[10px] text-text-3 tabular-nums">
                        {t.count}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* 4. Sessions / runs */}
        <section className="rounded-md border border-border-soft bg-bg-1">
          <button
            type="button"
            onClick={() => toggleSection('sessions')}
            className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium text-text-2 hover:text-text-1"
            aria-expanded={open.sessions}
          >
            {open.sessions ? (
              <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
            ) : (
              <ChevronRight size={12} strokeWidth={1.75} aria-hidden />
            )}
            <Brain size={12} strokeWidth={1.75} aria-hidden />
            <span className="lowercase">sessions / runs</span>
            <span className="ml-auto font-mono text-[10px] text-text-4">
              {assignedTasks.length}
            </span>
          </button>
          {open.sessions && (
            <div className="border-t border-border-soft px-2.5 py-2">
              {assignedTasks.length === 0 ? (
                <div className="py-3 text-center text-[11px] text-text-4">
                  no assigned tasks
                </div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {assignedTasks.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-2 rounded-sm border border-border-soft bg-bg-2 px-2 py-1"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[11px] text-text-1">
                          {t.title}
                        </div>
                        <div className="truncate font-mono text-[10px] text-text-4">
                          {formatTime(t.createdAt)} · /{t.id.slice(0, 8)}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${statusPillStyles(
                          t.status
                        )}`}
                      >
                        {t.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
