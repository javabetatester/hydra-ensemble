/**
 * TaskDrawer — right-side 420px slide-in panel for a single Task.
 *
 * Displays:
 *   · header with priority, title, relative submit time, status transition
 *   · a "why this agent?" RouteExplain block
 *   · a merged chronological timeline (route + messageLog + delegation
 *     subtasks, with subtasks visually indented by parent grouping)
 *   · an ApprovalCard inline for any `approval_request` entry
 *   · a destructive Cancel button with confirm-on-in_progress
 *
 * The drawer reads `taskDrawerTaskId` from the store; the `open` prop is
 * driven by callers from that id's presence (matches Hydra's existing
 * PRInspector convention). Esc closes.
 *
 * See PRD.md §10.F5 (submit task flow), §10.F6 (delegation), §15 (failure
 * states), §16 (safeMode) and PLAN.md §7 (router + Route entries).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowRight, CornerDownRight, X } from 'lucide-react'
import type {
  Agent,
  MessageKind,
  MessageLog,
  Priority,
  Route,
  Task,
  TaskStatus
} from '../../shared/orchestra'
import { useOrchestra } from './state/orchestra'
import ApprovalCard from './ApprovalCard'
import RouteExplain from './RouteExplain'

interface Props {
  open: boolean
  onClose: () => void
}

/** Unified timeline row — either a route event or a log entry. */
type TimelineRow =
  | { kind: 'route'; id: string; at: string; route: Route }
  | { kind: 'log'; id: string; at: string; entry: MessageLog }

const PRIORITY_STYLE: Record<Priority, string> = {
  P0: 'border-red-500/70 bg-red-500/20 text-red-200',
  P1: 'border-amber-500/70 bg-amber-500/20 text-amber-200',
  P2: 'border-sky-500/60 bg-sky-500/15 text-sky-200',
  P3: 'border-border-mid bg-bg-3 text-text-2'
}

const STATUS_STYLE: Record<TaskStatus, string> = {
  queued: 'text-text-3',
  routing: 'text-status-input',
  in_progress: 'text-status-generating',
  blocked: 'text-amber-400',
  done: 'text-status-generating',
  failed: 'text-status-attention'
}

const KIND_STYLE: Record<MessageKind, string> = {
  error: 'bg-status-attention/15 text-status-attention',
  delegation: 'bg-accent-500/15 text-accent-400',
  approval_request: 'bg-amber-500/15 text-amber-300',
  status: 'bg-bg-4 text-text-3',
  output: 'bg-bg-3 text-text-2'
}

/** Relative "3s ago" style formatter. No date-fns dependency needed. */
function relTime(iso: string, now: number): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const diff = Math.max(0, Math.floor((now - then) / 1000))
  if (diff < 5) return 'just now'
  if (diff < 60) return `${diff}s ago`
  const m = Math.floor(diff / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

/** Short hh:mm:ss pill for timeline rows. */
function clockTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString()
}

/** Resolves a MessageLog participant (agent id | 'system' | 'user' | 'broadcast')
 *  to a display string. */
function participantLabel(
  id: string,
  agents: Agent[]
): string {
  if (id === 'system') return 'system'
  if (id === 'user') return 'user'
  if (id === 'broadcast') return 'broadcast'
  const a = agents.find((x) => x.id === id)
  return a?.name ?? 'unknown'
}

export default function TaskDrawer({ open, onClose }: Props) {
  const taskDrawerTaskId = useOrchestra((s) => s.taskDrawerTaskId)
  const tasks = useOrchestra((s) => s.tasks)
  const agents = useOrchestra((s) => s.agents)
  const routes = useOrchestra((s) => s.routes)
  const messageLog = useOrchestra((s) => s.messageLog)
  const cancelTask = useOrchestra((s) => s.cancelTask)

  // Re-tick the header's relative time every 10s so "3s ago" doesn't lie.
  const [now, setNow] = useState<number>(() => Date.now())
  useEffect(() => {
    if (!open) return
    const id = window.setInterval(() => setNow(Date.now()), 10_000)
    return () => window.clearInterval(id)
  }, [open])

  // Track message-log entry expansion so long content stays collapsed by default.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // Esc → close. Scoped to open state so we don't steal Esc on other pages.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const task: Task | undefined = useMemo(
    () => tasks.find((t) => t.id === taskDrawerTaskId),
    [tasks, taskDrawerTaskId]
  )

  // Children (delegation subtasks) grouped by parent id — we only show
  // immediate children under the parent's header; grandchildren nest as
  // their own groups only when their parent is also a child of this task.
  const children = useMemo<Task[]>(() => {
    if (!task) return []
    return tasks.filter((t) => t.parentTaskId === task.id)
  }, [tasks, task])

  const taskIdSet = useMemo<Set<string>>(() => {
    const s = new Set<string>()
    if (task) s.add(task.id)
    for (const c of children) s.add(c.id)
    return s
  }, [task, children])

  // Merge timeline: routes for this task (+ children) and all log entries
  // addressed to those tasks, sorted ascending by `at`.
  const timeline = useMemo<TimelineRow[]>(() => {
    if (!task) return []
    const rows: TimelineRow[] = []
    for (const r of routes) {
      if (taskIdSet.has(r.taskId)) {
        rows.push({ kind: 'route', id: `route:${r.id}`, at: r.at, route: r })
      }
    }
    for (const m of messageLog) {
      if (m.taskId && taskIdSet.has(m.taskId)) {
        rows.push({ kind: 'log', id: `log:${m.id}`, at: m.at, entry: m })
      }
    }
    rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    return rows
  }, [task, routes, messageLog, taskIdSet])

  const onCancel = useCallback(async (): Promise<void> => {
    if (!task) return
    if (task.status === 'in_progress') {
      const ok = window.confirm(
        `Cancel "${task.title}"? The agent is currently working on it.`
      )
      if (!ok) return
    }
    await cancelTask(task.id)
    onClose()
  }, [task, cancelTask, onClose])

  // Injected no-op handlers for ApprovalCard. Real safe-mode wiring lands in
  // a follow-up task — these log so we can verify the UI round-trips.
  const approveNoop = useCallback(async (): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log('[TaskDrawer] approve (stub)')
  }, [])
  const denyNoop = useCallback(async (): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log('[TaskDrawer] deny (stub)')
  }, [])

  if (!open) return null

  // Task might be missing briefly if the id points to a deleted row;
  // render a minimal frame rather than crashing.
  if (!task) {
    return (
      <aside
        className="df-slide-in fixed right-0 top-0 z-40 flex h-full w-[420px] flex-col border-l border-border-mid bg-bg-2 shadow-[-12px_0_24px_-8px_rgba(0,0,0,0.6)]"
        role="dialog"
        aria-label="Task drawer"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border-soft px-3 py-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1.5 text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="Close"
            title="Esc"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
          <span className="text-[11px] text-text-4">task not found</span>
        </header>
        <div className="flex flex-1 items-center justify-center text-xs text-text-4">
          This task no longer exists.
        </div>
      </aside>
    )
  }

  const assignedAgent = agents.find((a) => a.id === task.assignedAgentId)

  // Status label: show the canonical transition "Queued → In progress"
  // based on the current status. A task always starts in `queued`, so we
  // describe where we are now.
  const statusLine = (() => {
    const label = task.status.replace('_', ' ')
    if (task.status === 'queued') return `Queued`
    if (task.status === 'done') return `Done`
    if (task.status === 'failed') return `Failed`
    if (task.status === 'blocked') return `Blocked — ${task.blockedReason ?? 'no reason'}`
    return `Queued → ${label}`
  })()

  return (
    <aside
      className="df-slide-in fixed right-0 top-0 z-40 flex h-full w-[420px] flex-col border-l border-border-mid bg-bg-2 shadow-[-12px_0_24px_-8px_rgba(0,0,0,0.6)]"
      role="dialog"
      aria-label={`Task drawer: ${task.title}`}
    >
      {/* Header */}
      <header className="flex shrink-0 flex-col gap-1 border-b border-border-soft px-3 py-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="Close"
            title="Esc"
          >
            <X size={12} strokeWidth={1.75} />
            close
          </button>
          <span className="ml-auto flex items-center gap-2 text-right">
            <span
              className={`shrink-0 rounded-sm border px-1.5 py-[1px] font-mono text-[10px] font-semibold tracking-wider ${PRIORITY_STYLE[task.priority]}`}
              aria-label={`Priority ${task.priority}`}
            >
              {task.priority}
            </span>
            <span
              className="max-w-[240px] truncate text-[12px] font-semibold text-text-1"
              title={task.title}
            >
              {task.title}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2 pl-1 text-[11px] text-text-4">
          <span>submitted {relTime(task.createdAt, now)}</span>
          <span>·</span>
          <span className={STATUS_STYLE[task.status]}>{statusLine}</span>
          {assignedAgent ? (
            <>
              <span>·</span>
              <span className="truncate text-text-3" title={assignedAgent.name}>
                {assignedAgent.name}
              </span>
            </>
          ) : null}
        </div>
        {task.tags.length > 0 ? (
          <ul className="flex flex-wrap gap-1 pl-1 pt-1">
            {task.tags.map((t) => (
              <li
                key={t}
                className="rounded-sm border border-border-soft bg-bg-3 px-1.5 py-[1px] font-mono text-[10px] text-text-3"
              >
                {t}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      {/* Body */}
      <div className="df-scroll min-h-0 flex-1 overflow-y-auto">
        {/* Why this agent? */}
        <section className="border-b border-border-soft px-3 py-3">
          <div className="df-label mb-2">why this agent?</div>
          <RouteExplain taskId={task.id} />
        </section>

        {/* Timeline */}
        <section className="px-3 py-3">
          <div className="df-label mb-2">timeline</div>
          {timeline.length === 0 ? (
            <div className="rounded-md border border-dashed border-border-soft bg-bg-1 px-3 py-4 text-center text-[11px] text-text-4">
              no activity yet
            </div>
          ) : (
            <ol className="space-y-1.5">
              {timeline.map((row) => {
                // Rows tied to a child task get a left-indent so subtask
                // activity reads as nested beneath the parent.
                const rowTaskId =
                  row.kind === 'route' ? row.route.taskId : row.entry.taskId
                const isChildRow = rowTaskId !== null && rowTaskId !== task.id

                if (row.kind === 'route') {
                  const r = row.route
                  const chosen = agents.find((a) => a.id === r.chosenAgentId)
                  return (
                    <li
                      key={row.id}
                      className={`rounded-md border border-border-soft bg-bg-1 px-2.5 py-1.5 ${
                        isChildRow ? 'ml-4 border-l-2 border-l-accent-500/40' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-text-4">
                          {clockTime(row.at)}
                        </span>
                        <span className="rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-accent-400 bg-accent-500/10">
                          route
                        </span>
                        <span className="flex items-center gap-1 text-[11px] text-text-2">
                          <ArrowRight size={11} strokeWidth={1.75} className="text-text-4" />
                          <span className="text-text-1">{chosen?.name ?? 'unknown'}</span>
                          <span className="text-text-4">
                            · score {r.score.toFixed(1)}
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 pl-1 text-[11px] text-text-3">
                        {r.reason}
                      </div>
                    </li>
                  )
                }

                const m = row.entry
                const from = participantLabel(m.fromAgentId, agents)
                const to = participantLabel(m.toAgentId, agents)
                const isApproval = m.kind === 'approval_request'
                const isExpanded = expanded[m.id] === true

                // Approval rows get the full ApprovalCard; other rows get
                // the compact "from -> to · content" layout.
                if (isApproval) {
                  return (
                    <li
                      key={row.id}
                      className={isChildRow ? 'ml-4' : ''}
                    >
                      <div className="mb-1 flex items-center gap-2 pl-0.5">
                        <span className="font-mono text-[10px] text-text-4">
                          {clockTime(row.at)}
                        </span>
                        <span className="text-[11px] text-text-3">
                          <span className="text-text-1">{from}</span>
                          <ArrowRight
                            size={10}
                            strokeWidth={1.75}
                            className="mx-1 inline text-text-4"
                          />
                          <span className="text-text-1">{to}</span>
                        </span>
                      </div>
                      <ApprovalCard
                        entry={m}
                        onApprove={approveNoop}
                        onDeny={denyNoop}
                      />
                    </li>
                  )
                }

                const needsTruncate = m.content.length > 160
                const shown =
                  isExpanded || !needsTruncate
                    ? m.content
                    : `${m.content.slice(0, 160)}…`

                return (
                  <li
                    key={row.id}
                    className={`rounded-md border border-border-soft bg-bg-1 px-2.5 py-1.5 ${
                      isChildRow ? 'ml-4 border-l-2 border-l-accent-500/40' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-text-4">
                        {clockTime(row.at)}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${KIND_STYLE[m.kind]}`}
                      >
                        {m.kind}
                      </span>
                      <span className="flex items-center gap-1 truncate text-[11px] text-text-2">
                        <span className="truncate text-text-1">{from}</span>
                        {m.kind === 'delegation' ? (
                          <CornerDownRight
                            size={10}
                            strokeWidth={1.75}
                            className="mx-0.5 text-accent-400"
                          />
                        ) : (
                          <ArrowRight
                            size={10}
                            strokeWidth={1.75}
                            className="mx-0.5 text-text-4"
                          />
                        )}
                        <span className="truncate text-text-1">{to}</span>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!needsTruncate) return
                        setExpanded((prev) => ({ ...prev, [m.id]: !isExpanded }))
                      }}
                      className={`mt-1 flex w-full items-start gap-1.5 text-left font-mono text-[11px] leading-snug text-text-2 ${
                        needsTruncate ? 'cursor-pointer hover:text-text-1' : 'cursor-default'
                      }`}
                      aria-expanded={needsTruncate ? isExpanded : undefined}
                    >
                      {needsTruncate ? (
                        <ArrowDown
                          size={10}
                          strokeWidth={1.75}
                          className={`mt-0.5 shrink-0 text-text-4 transition-transform ${
                            isExpanded ? '' : '-rotate-90'
                          }`}
                        />
                      ) : null}
                      <span className="whitespace-pre-wrap break-words">{shown}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          )}

          {/* Delegation subtasks summary — a compact list of children so the
              user can see "this task spawned 3 subtasks" without scanning
              every route row. */}
          {children.length > 0 ? (
            <div className="mt-4">
              <div className="df-label mb-1.5">
                delegations ({children.length})
              </div>
              <ul className="space-y-1">
                {children.map((c) => {
                  const a = agents.find((x) => x.id === c.assignedAgentId)
                  return (
                    <li
                      key={c.id}
                      className="flex items-center gap-2 rounded-sm border border-border-soft bg-bg-1 px-2 py-1 text-[11px]"
                    >
                      <CornerDownRight
                        size={11}
                        strokeWidth={1.75}
                        className="shrink-0 text-accent-400"
                      />
                      <span className="truncate text-text-1" title={c.title}>
                        {c.title}
                      </span>
                      <span className={`ml-auto shrink-0 ${STATUS_STYLE[c.status]}`}>
                        {c.status.replace('_', ' ')}
                      </span>
                      {a ? (
                        <span
                          className="shrink-0 truncate text-text-4"
                          title={a.name}
                        >
                          · {a.name}
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}
        </section>
      </div>

      {/* Footer */}
      <footer className="flex shrink-0 items-center justify-end border-t border-border-soft px-3 py-2">
        <button
          type="button"
          onClick={() => void onCancel()}
          disabled={task.status === 'done' || task.status === 'failed'}
          className="flex h-8 items-center gap-1.5 rounded-md border border-status-attention/40 bg-status-attention/10 px-3 font-mono text-[11px] font-semibold text-status-attention hover:bg-status-attention/20 disabled:cursor-not-allowed disabled:border-border-soft disabled:bg-bg-3 disabled:text-text-4"
          title={
            task.status === 'done' || task.status === 'failed'
              ? 'Task already finished'
              : 'Cancel task'
          }
          aria-label="Cancel task"
        >
          <X size={12} strokeWidth={2} />
          Cancel task
        </button>
      </footer>
    </aside>
  )
}
