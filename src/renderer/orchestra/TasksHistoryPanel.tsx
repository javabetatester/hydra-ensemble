/**
 * TasksHistoryPanel — right-side chronicle of resolved tasks.
 *
 * Mirror of TasksPanel but scoped to the terminal buckets (`done` | `failed`).
 * Read-only list, newest-first, with a "Reopen" affordance that re-submits a
 * clone of the original task (fresh id, prefixed title, `re-run` tag) so the
 * router treats it as a brand-new work item.
 *
 * Sibling semantics to TasksPanel — same visual system (bg-bg-2, border-l,
 * font-mono 10px footer) so the two panels are interchangeable when mounted
 * side-by-side or swapped behind a toggle.
 */
import { useMemo, useState } from 'react'
import { CircleCheck, CircleX, RotateCcw } from 'lucide-react'
import type { Route, Task, TaskStatus, UUID } from '../../shared/orchestra'
import { useOrchestra } from './state/orchestra'
import { useToasts } from '../state/toasts'
import { humanReason } from './routeReason'
import { relativeTime } from '../lib/time'

type FilterKey = 'all' | 'done' | 'failed'

const FILTER_OPTIONS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'all' },
  { key: 'done', label: 'done' },
  { key: 'failed', label: 'failed' }
]

/** Terminal statuses that this panel surfaces. Anything else belongs in the
 *  active TasksPanel. */
const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'done',
  'failed'
])

function matchesFilter(status: TaskStatus, filter: FilterKey): boolean {
  switch (filter) {
    case 'all':
      return TERMINAL_STATUSES.has(status)
    case 'done':
      return status === 'done'
    case 'failed':
      return status === 'failed'
  }
}

/** Format a millisecond duration as "2.3s", "47s", "4m", or "1h". Tuned for
 *  the compact footer — no decimals above the second threshold. */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const sec = ms / 1000
  if (sec < 10) return `${sec.toFixed(1)}s`
  if (sec < 60) return `${Math.round(sec)}s`
  const min = sec / 60
  if (min < 60) return `${Math.round(min)}m`
  const hr = min / 60
  return `${hr.toFixed(1)}h`
}

export default function TasksHistoryPanel() {
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const tasks = useOrchestra((s) => s.tasks)
  const agents = useOrchestra((s) => s.agents)
  const routes = useOrchestra((s) => s.routes)
  const setTaskDrawer = useOrchestra((s) => s.setTaskDrawer)

  const [filter, setFilter] = useState<FilterKey>('all')

  // Resolved tasks for the active team, newest-resolution first. Prefer
  // finishedAt when present so late-reporting workers don't shuffle rows
  // around; fall back to updatedAt then createdAt to keep ordering stable
  // for tasks still missing a finishedAt timestamp.
  const teamHistory = useMemo<Task[]>(() => {
    if (!activeTeamId) return []
    return tasks
      .filter(
        (t) => t.teamId === activeTeamId && TERMINAL_STATUSES.has(t.status)
      )
      .slice()
      .sort((a, b) => {
        const aKey = a.finishedAt ?? a.updatedAt ?? a.createdAt
        const bKey = b.finishedAt ?? b.updatedAt ?? b.createdAt
        return aKey < bKey ? 1 : -1
      })
  }, [tasks, activeTeamId])

  const filteredTasks = useMemo<Task[]>(
    () => teamHistory.filter((t) => matchesFilter(t.status, filter)),
    [teamHistory, filter]
  )

  // O(1) agent-id → name lookup for row meta. Recomputed only when the
  // agents slice changes.
  const agentNameById = useMemo<Map<UUID, string>>(() => {
    const map = new Map<UUID, string>()
    for (const a of agents) map.set(a.id, a.name)
    return map
  }, [agents])

  // Latest route per task — the drawer's "what the router chose" metadata
  // belongs next to the row too so the user can see *why* a task landed on
  // a given agent without opening the timeline.
  const routeByTaskId = useMemo<Map<UUID, Route>>(() => {
    const map = new Map<UUID, Route>()
    for (const r of routes) {
      const prev = map.get(r.taskId)
      if (!prev || prev.at < r.at) map.set(r.taskId, r)
    }
    return map
  }, [routes])

  const doneCount = teamHistory.filter((t) => t.status === 'done').length
  const failedCount = teamHistory.filter((t) => t.status === 'failed').length

  // Footer stats — average resolution time + delegated-routes tally.
  // Only tasks with both timestamps contribute to the average; partial data
  // would produce misleading numbers.
  const { avgDurationMs, avgSampleSize } = useMemo(() => {
    let total = 0
    let n = 0
    for (const t of teamHistory) {
      if (!t.finishedAt) continue
      const start = new Date(t.createdAt).getTime()
      const end = new Date(t.finishedAt).getTime()
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue
      total += end - start
      n += 1
    }
    return { avgDurationMs: n === 0 ? 0 : total / n, avgSampleSize: n }
  }, [teamHistory])

  const delegatedRouteCount = useMemo(() => {
    if (!activeTeamId) return 0
    // Route entries don't carry a teamId directly, so narrow via the
    // task. A route counts as "delegated" whenever its reason starts with
    // the `delegation:` prefix emitted by the router.
    const historyIds = new Set(teamHistory.map((t) => t.id))
    let count = 0
    for (const r of routes) {
      if (!historyIds.has(r.taskId)) continue
      if (r.reason.startsWith('delegation:')) count += 1
    }
    return count
  }, [routes, teamHistory, activeTeamId])

  const hasAnyHistory = teamHistory.length > 0

  const handleReopen = async (task: Task): Promise<void> => {
    const cloned = await useOrchestra.getState().submitTask({
      teamId: task.teamId,
      title: `Re-run: ${task.title}`,
      body: task.body,
      priority: task.priority,
      tags: [...task.tags, 're-run'],
      assignedAgentId: task.assignedAgentId ?? undefined
    })
    if (cloned) {
      useToasts.getState().push({
        kind: 'success',
        title: 'Task re-submitted',
        body: `"${task.title}" has been re-queued.`
      })
    }
  }

  return (
    <div
      data-coach="tasks-history-panel"
      className="flex h-full w-full flex-col overflow-hidden border-l border-border-soft bg-bg-2 text-text-1"
    >
      {/* Header — static label + per-status tallies */}
      <header className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-3 py-2">
        <span className="df-label">history</span>
        <span className="font-mono text-[10px] text-text-4">
          <span className="text-status-generating">{doneCount}</span> done
          <span className="mx-1 text-text-4" aria-hidden>
            ·
          </span>
          <span className="text-status-attention">{failedCount}</span> failed
        </span>
      </header>

      {/* Filter chips — scoped to the two terminal buckets */}
      <div className="flex items-center gap-1 border-b border-border-soft bg-bg-1 px-3 py-1.5">
        {FILTER_OPTIONS.map((opt) => {
          const sel = opt.key === filter
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setFilter(opt.key)}
              className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] transition ${
                sel
                  ? 'border-accent-500 bg-accent-500/15 text-text-1'
                  : 'border-border-soft bg-bg-1 text-text-3 hover:border-border-mid hover:bg-bg-3 hover:text-text-1'
              }`}
              aria-pressed={sel}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* List */}
      <div className="df-scroll min-h-0 flex-1 overflow-y-auto">
        {!activeTeamId ? (
          <EmptyState
            title="No team selected"
            subtitle="Pick a team to see its resolved tasks."
          />
        ) : !hasAnyHistory ? (
          <EmptyState
            title="No history yet"
            subtitle="Resolved tasks will appear here."
          />
        ) : filteredTasks.length === 0 ? (
          <EmptyState
            title="Nothing in this filter"
            subtitle={`No ${filter} tasks to show.`}
          />
        ) : (
          <ul className="flex flex-col">
            {filteredTasks.map((t) => {
              const route = routeByTaskId.get(t.id) ?? null
              const agentName = t.assignedAgentId
                ? (agentNameById.get(t.assignedAgentId) ?? null)
                : null
              return (
                <li key={t.id}>
                  <HistoryRow
                    task={t}
                    agentName={agentName}
                    route={route}
                    onOpen={() => setTaskDrawer(t.id)}
                    onReopen={() => void handleReopen(t)}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Stats footer — avg duration + delegated-routes tally */}
      <footer className="flex items-center justify-between border-t border-border-soft bg-bg-1 px-3 py-1.5 font-mono text-[10px] text-text-4">
        <span title={`${avgSampleSize} sampled`}>
          {avgSampleSize === 0
            ? 'avg —'
            : `avg ${formatDuration(avgDurationMs)}`}
        </span>
        <span>
          {delegatedRouteCount}{' '}
          {delegatedRouteCount === 1 ? 'delegation' : 'delegations'}
        </span>
      </footer>
    </div>
  )
}

interface HistoryRowProps {
  task: Task
  agentName: string | null
  route: Route | null
  onOpen: () => void
  onReopen: () => void
}

/** Single history entry — status icon on the left, title + meta in the
 *  middle, relative time + Reopen button on the right. Click anywhere on
 *  the row (except the Reopen button) opens the TaskDrawer. */
function HistoryRow({
  task,
  agentName,
  route,
  onOpen,
  onReopen
}: HistoryRowProps) {
  const isDone = task.status === 'done'
  const finishedIso = task.finishedAt ?? task.updatedAt ?? task.createdAt

  // Failed tasks surface blockedReason when present; otherwise the router's
  // last reason is the next-best explanation. Done tasks only show a
  // reason when it came from the router ("delegation: ...") since a vanilla
  // success message would just be noise.
  const rawReason = !isDone
    ? (task.blockedReason ?? route?.reason ?? null)
    : route?.reason?.startsWith('delegation:')
      ? route.reason
      : null
  // blockedReason is free-form user text (e.g. 'cancelled'); reason is the
  // machine tag from the router. Only run humanReason over the latter.
  const subtitleReason =
    rawReason && rawReason === route?.reason ? humanReason(rawReason) : rawReason

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      data-task-id={task.id}
      className="flex min-h-16 cursor-pointer items-start gap-2 border-b border-border-soft px-3 py-2 transition-colors hover:bg-bg-3 focus:bg-bg-3 focus:outline-none"
      aria-label={`Open task ${task.title}`}
    >
      {/* Left — status icon, colour-coded */}
      <span
        className={`mt-0.5 shrink-0 ${
          isDone ? 'text-status-generating' : 'text-status-attention'
        }`}
        aria-hidden
      >
        {isDone ? (
          <CircleCheck size={12} strokeWidth={2} />
        ) : (
          <CircleX size={12} strokeWidth={2} />
        )}
      </span>

      {/* Middle — title + meta stack. min-w-0 is critical for the truncate
           on the title line to kick in inside the flex row. */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className="truncate text-[12px] text-text-1"
          title={task.title}
        >
          {task.title}
        </span>
        <div className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-text-4">
          {agentName ? (
            <span
              className="truncate text-text-3"
              title={agentName}
            >
              {agentName}
            </span>
          ) : (
            <span className="text-text-4">unassigned</span>
          )}
          <span aria-hidden>·</span>
          <span className="shrink-0">{task.priority}</span>
          {subtitleReason ? (
            <>
              <span aria-hidden>·</span>
              <span
                className="truncate text-text-4"
                title={subtitleReason}
              >
                {subtitleReason}
              </span>
            </>
          ) : null}
        </div>
      </div>

      {/* Right — finished-ago + Reopen. Stopping propagation on the button
           so clicking it doesn't also open the drawer. */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span
          className="whitespace-nowrap font-mono text-[10px] text-text-4"
          title={finishedIso}
        >
          finished {relativeTime(finishedIso)}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onReopen()
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className="flex items-center gap-1 rounded-sm border border-border-soft bg-bg-1 px-1.5 py-0.5 font-mono text-[10px] text-text-2 transition hover:border-accent-500 hover:bg-accent-500/15 hover:text-text-1"
          title="Re-submit this task as a new one"
          aria-label={`Re-submit task ${task.title}`}
        >
          <RotateCcw size={10} strokeWidth={2} />
          Reopen
        </button>
      </div>
    </div>
  )
}

interface EmptyStateProps {
  title: string
  subtitle: string
}

function EmptyState({ title, subtitle }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="font-mono text-[11px] text-text-2">{title}</span>
      <span className="font-mono text-[10px] text-text-4">{subtitle}</span>
    </div>
  )
}
