/**
 * TasksPanel — right-side list of tasks for the active team.
 *
 * Layout (top → bottom): header with "+ New Task", status filter chips,
 * scrollable list of TaskRow, footer counter. The parent owns width/height
 * via w-full / h-full so the panel drops cleanly into OrchestraView's aside
 * at 320px without hardcoding that width here.
 *
 * Data comes exclusively from `useOrchestra` — no IPC, no new store
 * actions (integration of mount + keybind is a follow-up).
 */
import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { Task, TaskStatus, UUID } from '../../shared/orchestra'
import { useOrchestra } from './state/orchestra'
import TaskRow from './TaskRow'
import NewTaskDialog from './modals/NewTaskDialog'

type FilterKey = 'all' | 'active' | 'done' | 'failed'

/** Active-bucket statuses — anything that is neither terminal-done nor
 *  terminal-failed. Kept centralised so the footer counter and the filter
 *  agree on what "running" means. */
const ACTIVE_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'queued',
  'routing',
  'in_progress',
  'blocked'
])

const FILTER_OPTIONS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'all' },
  { key: 'active', label: 'active' },
  { key: 'done', label: 'done' },
  { key: 'failed', label: 'failed' }
]

/** Map a filter key to a predicate. Extracted so the list and the
 *  potentially-different empty state share a single definition. */
function matchesFilter(status: TaskStatus, filter: FilterKey): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'active':
      return ACTIVE_STATUSES.has(status)
    case 'done':
      return status === 'done'
    case 'failed':
      return status === 'failed'
  }
}

export default function TasksPanel() {
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const tasks = useOrchestra((s) => s.tasks)
  const agents = useOrchestra((s) => s.agents)
  const setTaskDrawer = useOrchestra((s) => s.setTaskDrawer)

  const [filter, setFilter] = useState<FilterKey>('all')
  const [dialogOpen, setDialogOpen] = useState(false)

  // Narrow to the active team's tasks and sort newest-first. Memoised so
  // typing a filter change doesn't re-walk the tasks array.
  const teamTasks = useMemo<Task[]>(() => {
    if (!activeTeamId) return []
    return tasks
      .filter((t) => t.teamId === activeTeamId)
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }, [tasks, activeTeamId])

  const filteredTasks = useMemo<Task[]>(
    () => teamTasks.filter((t) => matchesFilter(t.status, filter)),
    [teamTasks, filter]
  )

  // Assignee lookup — O(1) agent-id → name resolution for the row meta line.
  // The row itself stays presentational; we hand it the string it should
  // render so it doesn't need to touch the store.
  const agentNameById = useMemo<Map<UUID, string>>(() => {
    const map = new Map<UUID, string>()
    for (const a of agents) map.set(a.id, a.name)
    return map
  }, [agents])

  const runningCount = useMemo(
    () =>
      teamTasks.filter(
        (t) => t.status === 'in_progress' || t.status === 'routing'
      ).length,
    [teamTasks]
  )

  // The prominent "New task" button is only actionable when the active team
  // has at least one agent — otherwise auto-routing and direct assignment are
  // both impossible. We keep the flag local so the tooltip and the disabled
  // styling stay in sync.
  const teamHasAgents = useMemo(
    () =>
      activeTeamId
        ? agents.some((a) => a.teamId === activeTeamId)
        : false,
    [agents, activeTeamId]
  )
  const canCreateTask = Boolean(activeTeamId) && teamHasAgents
  const createDisabledReason = !activeTeamId
    ? 'Select a team first'
    : !teamHasAgents
      ? 'Create a team with at least one agent first'
      : 'Create a new task'

  const resolveAssigneeName = (t: Task): string | null => {
    if (t.assignedAgentId) {
      return agentNameById.get(t.assignedAgentId) ?? null
    }
    // Auto-routed tasks that haven't landed on an agent yet read as "(auto)"
    // so the meta row isn't blank. Terminal-unassigned tasks stay null.
    if (ACTIVE_STATUSES.has(t.status)) return '(auto)'
    return null
  }

  const hasAnyTeamTasks = teamTasks.length > 0

  return (
    <div
      data-coach="tasks-panel"
      className="flex h-full w-full flex-col overflow-hidden border-l border-border-soft bg-bg-2 text-text-1"
    >
      {/* Header — label only. The full-width accent button below is the
          dominant "create task" affordance; a tiny duplicate icon-button
          here confused users asking "why two pluses?" */}
      <header className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-3 py-2">
        <span className="df-label">tasks</span>
        <span className="font-mono text-[10px] text-text-4">
          {teamTasks.length}
        </span>
      </header>

      {/* Primary CTA — full-width accent button so "create a task" is the
          dominant affordance of the panel. Disabled + tooltipped when the
          active team has no agents to route/assign the task to. */}
      <div className="flex flex-col gap-1 border-b border-border-soft bg-bg-1 px-3 pb-2 pt-2">
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          disabled={!canCreateTask}
          title={createDisabledReason}
          aria-label="New task"
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-sm bg-accent-500 font-mono text-[12px] font-semibold text-white transition hover:bg-accent-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-2 disabled:cursor-not-allowed disabled:bg-bg-3 disabled:text-text-4 disabled:hover:bg-bg-3"
        >
          <Plus size={14} strokeWidth={2.25} />
          New task
        </button>
        <span className="font-mono text-[10px] text-text-4">
          Assign to anyone in the team — Auto-route lets Orchestrador pick.
        </span>
      </div>

      {/* Filter chips */}
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
            subtitle="Create or pick a team to see its tasks."
          />
        ) : !hasAnyTeamTasks ? (
          <EmptyState
            title="No tasks yet"
            subtitle="Submit one to dispatch agents."
            cta={{
              label: 'New Task',
              onClick: () => setDialogOpen(true)
            }}
          />
        ) : filteredTasks.length === 0 ? (
          <EmptyState
            title="Nothing in this filter"
            subtitle={`No ${filter} tasks right now.`}
          />
        ) : (
          <ul className="flex flex-col">
            {filteredTasks.map((t) => (
              <li key={t.id}>
                <TaskRow
                  task={t}
                  assigneeName={resolveAssigneeName(t)}
                  onClick={() => setTaskDrawer(t.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer counter */}
      <footer className="flex items-center justify-between border-t border-border-soft bg-bg-1 px-3 py-1.5 font-mono text-[10px] text-text-4">
        <span>
          {teamTasks.length} {teamTasks.length === 1 ? 'task' : 'tasks'}
        </span>
        <span>{runningCount} running</span>
      </footer>

      {/* Creation modal — rendered inline so callers don't need to mount a
          portal host in OrchestraView before this panel works. */}
      <NewTaskDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  )
}

interface EmptyStateProps {
  title: string
  subtitle: string
  cta?: { label: string; onClick: () => void }
}

function EmptyState({ title, subtitle, cta }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="font-mono text-[11px] text-text-2">{title}</span>
      <span className="font-mono text-[10px] text-text-4">{subtitle}</span>
      {cta ? (
        <button
          type="button"
          onClick={cta.onClick}
          className="mt-2 flex items-center gap-1 rounded-sm border border-accent-600 bg-accent-500/90 px-2.5 py-1 font-mono text-[10px] font-semibold text-bg-0 hover:bg-accent-500"
        >
          <Plus size={10} strokeWidth={2} />
          {cta.label}
        </button>
      ) : null}
    </div>
  )
}
