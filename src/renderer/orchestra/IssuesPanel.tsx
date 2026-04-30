/**
 * IssuesPanel — Linear/Paperclip-style triage list of Orchestra tasks.
 *
 * An "issue" here is just a `Task` dressed up as a structured ticket:
 *   - priority pill (P0 alarming → P3 muted),
 *   - short task id (first 6 of UUID, monospace),
 *   - title,
 *   - tags + comment count (messageLog entries tied to the task),
 *   - relative time (updatedAt, falling back to createdAt),
 *   - assignee (avatar + name) and status pill.
 *
 * This is a more opinionated view than `TasksPanel.tsx`; they coexist on
 * purpose so the user can flip between a lightweight list and a triage
 * board. All data flows through `useOrchestra`; the panel never talks to
 * IPC directly.
 *
 * Interaction surface:
 *   - Tabs: All · Mine · Unassigned · Blocked · Done (sort is always
 *     `updatedAt desc`).
 *   - Click row → open TaskDrawer for that task.
 *   - Right-click row → context menu (Cancel / Reassign… / Change priority
 *     / Copy task id).
 *   - Drag-and-drop: row accepts `application/x-hydra-task` (an agent card
 *     drop would flip assignee). Actual write is a TODO until the store
 *     exposes `updateTask`; for now we confirm the intent via a toast.
 *
 * "Mine" is a placeholder — Hydra has no viewer concept yet, so we derive
 * it from the active team's `mainAgentId`. The tooltip on the tab makes
 * that explicit so nobody thinks it's filtering by a real user id.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent
} from 'react'
import { Filter, MessageSquare, MoreHorizontal, Plus } from 'lucide-react'
import type {
  Agent,
  MessageLog,
  Priority,
  Task,
  TaskStatus,
  UUID
} from '../../shared/orchestra'
import { useOrchestra } from './state/orchestra'
import { useToasts } from '../state/toasts'
import { useNewTaskDialog } from '../state/newTaskDialog'
import { relativeTime as relativeTimeShared } from '../lib/time'

/** Tabs double as filters. "all" is the default; `blocked` + `done` are
 *  status-targeted buckets; `mine` and `unassigned` slice by assignee. */
type TabKey = 'all' | 'mine' | 'unassigned' | 'blocked' | 'done'

interface TabDef {
  key: TabKey
  label: string
  /** Short hint in the tab's `title`; explains the placeholder semantics of
   *  "Mine" while Hydra has no viewer identity yet. */
  hint?: string
}

const TABS: ReadonlyArray<TabDef> = [
  { key: 'all', label: 'All' },
  {
    key: 'mine',
    label: 'Mine',
    hint: 'Placeholder: filters by the team main agent until viewer identity exists'
  },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' }
]

/** Priority palette — consistent with `TaskRow.tsx` so users recognise the
 *  colours after switching panels. */
const PRIORITY_PILL: Record<Priority, string> = {
  P0: 'border-red-500/60 bg-red-500/15 text-red-300',
  P1: 'border-amber-500/60 bg-amber-500/15 text-amber-300',
  P2: 'border-sky-500/50 bg-sky-500/10 text-sky-300',
  P3: 'border-border-mid bg-bg-3 text-text-3'
}

const PRIORITY_ORDER: ReadonlyArray<Priority> = ['P0', 'P1', 'P2', 'P3']

/** Status pill palette — same convention as the priority pills so the eye
 *  picks up ticket state without reading the word. `in_progress`/`routing`
 *  pulse the accent to echo TaskRow's running state. */
const STATUS_PILL: Record<TaskStatus, string> = {
  queued: 'border-border-mid bg-bg-3 text-text-3',
  routing: 'border-accent-500/60 bg-accent-500/15 text-accent-300 df-pulse',
  in_progress:
    'border-accent-500/60 bg-accent-500/15 text-accent-300 df-pulse',
  blocked: 'border-amber-500/60 bg-amber-500/15 text-amber-300',
  done: 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300',
  failed: 'border-red-500/60 bg-red-500/15 text-red-300'
}

/** Short labels — "in_progress" is hostile in a pill, "active" reads better
 *  at the size issue pills live at. */
const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: 'queued',
  routing: 'routing',
  in_progress: 'active',
  blocked: 'blocked',
  done: 'done',
  failed: 'failed'
}

/** Mime type used when dragging a task between panels. Kept here (instead of
 *  a shared constant) so this file stays drop-in — if DraggableTaskCard ever
 *  migrates to the same mime, both sides converging is a simple search. */
const TASK_DRAG_MIME = 'application/x-hydra-task'

/** Tiny deterministic hash → colour so two agents look distinct without
 *  pulling in an avatar lib. Kept local to avoid a cross-cutting utility for
 *  a single caller. */
function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0
  }
  const hue = Math.abs(h) % 360
  return `hsl(${hue}, 55%, 42%)`
}

/** Two-letter avatar fallback. Prefers the first letter of the first two
 *  words; collapses to the first two letters of a single-word name. */
function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]
  if (!first) return '??'
  const second = parts[1]
  if (!second) return first.slice(0, 2).toUpperCase()
  return ((first[0] ?? '') + (second[0] ?? '')).toUpperCase() || '??'
}

/** Thin guard around the shared helper — this panel receives optional ISO
 *  strings and wants an empty string (not "just now") when input is falsy. */
const relativeTime = (iso: string | undefined): string =>
  iso ? relativeTimeShared(iso) : ''

/** First six chars of the UUID give plenty of uniqueness for display and
 *  matches the density of a Linear issue key (ORC-123 etc.). */
function shortId(id: UUID): string {
  return id.slice(0, 6)
}

// ---------------------------------------------------------------------------
// Context menu — declared in-file rather than reusing CanvasContextMenu so
// the menu shape stays task-specific (Cancel / Reassign / Change priority /
// Copy id) without widening that component's target union.
// ---------------------------------------------------------------------------

interface ContextMenuState {
  taskId: UUID
  x: number
  y: number
}

interface RowMenuProps {
  state: ContextMenuState
  task: Task
  teamAgents: Agent[]
  onClose: () => void
  onReassign: (agentId: UUID) => void
  onChangePriority: (p: Priority) => void
  onCancel: () => void
}

function RowContextMenu({
  state,
  task,
  teamAgents,
  onClose,
  onReassign,
  onChangePriority,
  onCancel
}: RowMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [submenu, setSubmenu] = useState<'reassign' | 'priority' | null>(null)

  // Dismiss on outside-mousedown / Escape / scroll / window blur. Mirrors
  // CanvasContextMenu so the two menus behave identically.
  useEffect(() => {
    const onMouseDown = (e: Event): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent | globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onScroll = (): void => onClose()
    const onBlur = (): void => onClose()
    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('keydown', onKey as EventListener)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('keydown', onKey as EventListener)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [onClose])

  // Cancel is only legal for non-terminal statuses. Wrapping the check here
  // so the menu item can render as disabled without the parent duplicating
  // the state machine.
  const canCancel = task.status !== 'done' && task.status !== 'failed'

  const MENU_WIDTH = 200
  const vw = typeof window !== 'undefined' ? window.innerWidth : MENU_WIDTH
  const vh = typeof window !== 'undefined' ? window.innerHeight : 400
  const left = Math.max(4, Math.min(state.x, vw - MENU_WIDTH - 4))
  const top = Math.max(4, Math.min(state.y, vh - 240))

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="issue context menu"
      style={{ left, top, width: MENU_WIDTH }}
      className="fixed z-50 rounded-sm border border-border-mid bg-bg-2 py-1 shadow-pop"
      onContextMenu={(e) => e.preventDefault()}
    >
      {submenu === null ? (
        <>
          <MenuRow
            label="Cancel"
            disabled={!canCancel}
            onClick={() => {
              onCancel()
              onClose()
            }}
            danger
          />
          <MenuRow
            label="Reassign…"
            disabled={teamAgents.length === 0}
            onClick={() => setSubmenu('reassign')}
            trailing="▸"
          />
          <MenuRow
            label="Change priority"
            onClick={() => setSubmenu('priority')}
            trailing="▸"
          />
          <div
            role="separator"
            className="my-1 border-t border-border-soft"
          />
          <MenuRow
            label="Copy task id"
            onClick={() => {
              void navigator.clipboard?.writeText(task.id).catch(() => {
                // Clipboard may be unavailable in some electron contexts;
                // swallow silently — the menu still closes below.
              })
              onClose()
            }}
          />
        </>
      ) : submenu === 'reassign' ? (
        <>
          <MenuRow label="← Back" onClick={() => setSubmenu(null)} />
          <div
            role="separator"
            className="my-1 border-t border-border-soft"
          />
          {teamAgents.length === 0 ? (
            <div className="px-3 py-1.5 font-mono text-[11px] text-text-4">
              No agents in this team
            </div>
          ) : (
            teamAgents.map((a) => (
              <MenuRow
                key={a.id}
                label={a.name || a.slug}
                onClick={() => {
                  onReassign(a.id)
                  onClose()
                }}
                trailing={
                  task.assignedAgentId === a.id ? '✓' : undefined
                }
              />
            ))
          )}
        </>
      ) : (
        <>
          <MenuRow label="← Back" onClick={() => setSubmenu(null)} />
          <div
            role="separator"
            className="my-1 border-t border-border-soft"
          />
          {PRIORITY_ORDER.map((p) => (
            <MenuRow
              key={p}
              label={p}
              onClick={() => {
                onChangePriority(p)
                onClose()
              }}
              trailing={task.priority === p ? '✓' : undefined}
            />
          ))}
        </>
      )}
    </div>
  )
}

interface MenuRowProps {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  trailing?: string
}

function MenuRow({
  label,
  onClick,
  disabled,
  danger,
  trailing
}: MenuRowProps) {
  const tone = disabled
    ? 'cursor-not-allowed text-text-4'
    : danger
      ? 'text-status-attention hover:bg-bg-3'
      : 'text-text-2 hover:bg-bg-3 hover:text-text-1'
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left font-mono text-[11px] outline-none transition-colors focus:bg-bg-3 focus:text-text-1 ${tone}`}
    >
      <span className="flex-1 truncate">{label}</span>
      {trailing ? (
        <span className="shrink-0 text-[10px] text-text-4">{trailing}</span>
      ) : null}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

interface Props {}

export default function IssuesPanel(_props: Props) {
  void _props

  // Per-field selectors keep re-renders tight. `messageLog` is the noisiest
  // subscription (streamed from main) — pulling it at the panel root is fine
  // because we need it for the comment counts anyway.
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const tasks = useOrchestra((s) => s.tasks)
  const agents = useOrchestra((s) => s.agents)
  const teams = useOrchestra((s) => s.teams)
  const messageLog = useOrchestra((s) => s.messageLog)
  const setTaskDrawer = useOrchestra((s) => s.setTaskDrawer)
  const cancelTask = useOrchestra((s) => s.cancelTask)
  const pushToast = useToasts((s) => s.push)

  const [tab, setTab] = useState<TabKey>('all')
  const showNewTaskDialog = useNewTaskDialog((s) => s.show)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  /** Id of the task currently hovered under a drag — drives the highlight
   *  and the tooltip so the user sees what the drop would target. */
  const [dragOverId, setDragOverId] = useState<UUID | null>(null)

  const activeTeam = useMemo(
    () => teams.find((t) => t.id === activeTeamId) ?? null,
    [teams, activeTeamId]
  )

  const teamAgents = useMemo<Agent[]>(
    () => (activeTeamId ? agents.filter((a) => a.teamId === activeTeamId) : []),
    [agents, activeTeamId]
  )

  // O(1) id → agent. Used by the row to render avatar + name, and by the
  // context menu for the reassign submenu.
  const agentById = useMemo<Map<UUID, Agent>>(() => {
    const m = new Map<UUID, Agent>()
    for (const a of agents) m.set(a.id, a)
    return m
  }, [agents])

  // Comments-per-task: single pass over the (bounded) messageLog. The cap
  // enforced in the store (500) keeps this trivially fast.
  const commentsByTask = useMemo<Map<UUID, number>>(() => {
    const m = new Map<UUID, number>()
    for (const entry of messageLog) {
      const tid = (entry as MessageLog).taskId
      if (!tid) continue
      m.set(tid, (m.get(tid) ?? 0) + 1)
    }
    return m
  }, [messageLog])

  // Narrow + tab-filter + sort. Sort is always `updatedAt desc` per spec;
  // falls back to `createdAt` when updatedAt is missing so brand-new tasks
  // still stack above old ones.
  const visibleTasks = useMemo<Task[]>(() => {
    if (!activeTeamId) return []
    const mineAgentId = activeTeam?.mainAgentId ?? null
    const teamTasks = tasks.filter((t) => t.teamId === activeTeamId)
    const filtered = teamTasks.filter((t) => {
      switch (tab) {
        case 'all':
          return true
        case 'mine':
          return mineAgentId !== null && t.assignedAgentId === mineAgentId
        case 'unassigned':
          return t.assignedAgentId === null
        case 'blocked':
          return t.status === 'blocked'
        case 'done':
          return t.status === 'done'
      }
    })
    return filtered.slice().sort((a, b) => {
      const ka = a.updatedAt || a.createdAt
      const kb = b.updatedAt || b.createdAt
      if (ka === kb) return 0
      return ka < kb ? 1 : -1
    })
  }, [tasks, activeTeamId, activeTeam?.mainAgentId, tab])

  // Header count per tab (a "4" next to Blocked makes the tab more scannable
  // than just highlighting the selected state).
  const tabCounts = useMemo<Record<TabKey, number>>(() => {
    const counts: Record<TabKey, number> = {
      all: 0,
      mine: 0,
      unassigned: 0,
      blocked: 0,
      done: 0
    }
    if (!activeTeamId) return counts
    const mineAgentId = activeTeam?.mainAgentId ?? null
    for (const t of tasks) {
      if (t.teamId !== activeTeamId) continue
      counts.all += 1
      if (mineAgentId !== null && t.assignedAgentId === mineAgentId) {
        counts.mine += 1
      }
      if (t.assignedAgentId === null) counts.unassigned += 1
      if (t.status === 'blocked') counts.blocked += 1
      if (t.status === 'done') counts.done += 1
    }
    return counts
  }, [tasks, activeTeamId, activeTeam?.mainAgentId])

  const teamHasAgents = teamAgents.length > 0
  const canCreateTask = Boolean(activeTeamId) && teamHasAgents
  const createDisabledReason = !activeTeamId
    ? 'Select a team first'
    : !teamHasAgents
      ? 'Create a team with at least one agent first'
      : 'Create a new issue'

  // Row handlers — grouped as callbacks so the row JSX stays readable and
  // React avoids reallocating them per render.

  const openContextMenu = useCallback(
    (e: MouseEvent, taskId: UUID) => {
      e.preventDefault()
      e.stopPropagation()
      setMenu({ taskId, x: e.clientX, y: e.clientY })
    },
    []
  )

  const closeContextMenu = useCallback(() => setMenu(null), [])

  const handleReassign = useCallback(
    (agentId: UUID) => {
      const agent = agentById.get(agentId)
      // `updateTask` does not exist on the store yet. Surface the intent
      // via a toast so the user knows the click was registered, and log a
      // TODO so the next store PR can light this up without a hunt.
      pushToast({
        kind: 'info',
        title: 'Reassign queued',
        body: `Would reassign to ${agent?.name ?? agentId} once updateTask lands.`
      })
      // eslint-disable-next-line no-console
      console.info(
        '[IssuesPanel] TODO: updateTask({ assignedAgentId }) when store exposes it'
      )
    },
    [agentById, pushToast]
  )

  const handleChangePriority = useCallback(
    (priority: Priority) => {
      pushToast({
        kind: 'info',
        title: 'Priority change queued',
        body: `Would set priority to ${priority} once updateTask lands.`
      })
      // eslint-disable-next-line no-console
      console.info(
        '[IssuesPanel] TODO: updateTask({ priority }) when store exposes it'
      )
    },
    [pushToast]
  )

  const handleCancel = useCallback(
    (taskId: UUID) => {
      void cancelTask(taskId)
    },
    [cancelTask]
  )

  // Drag target: accept the hydra-task mime (set by DraggableTaskCard or a
  // future source). We can't actually flip the assignee until `updateTask`
  // exists, so dropping shows a toast describing the would-be action.
  const onRowDragOver = useCallback((e: DragEvent, taskId: UUID) => {
    if (!Array.from(e.dataTransfer.types).includes(TASK_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverId(taskId)
  }, [])

  const onRowDragLeave = useCallback(
    (_e: DragEvent, taskId: UUID) => {
      setDragOverId((curr) => (curr === taskId ? null : curr))
    },
    []
  )

  const onRowDrop = useCallback(
    (e: DragEvent, target: Task) => {
      const payload = e.dataTransfer.getData(TASK_DRAG_MIME)
      if (!payload) return
      e.preventDefault()
      setDragOverId(null)
      pushToast({
        kind: 'info',
        title: 'Drop received',
        body: `Would reassign issue ${shortId(target.id)} using payload "${payload}" once updateTask lands.`
      })
      // eslint-disable-next-line no-console
      console.info(
        '[IssuesPanel] TODO: updateTask on drop',
        { targetTaskId: target.id, payload }
      )
    },
    [pushToast]
  )

  // Resolve the Task currently owning the context menu — the menu component
  // needs the fresh snapshot because `tasks` may have been updated by an IPC
  // event between right-click and selection.
  const menuTask = useMemo<Task | null>(() => {
    if (!menu) return null
    return tasks.find((t) => t.id === menu.taskId) ?? null
  }, [menu, tasks])

  return (
    <div
      data-coach="issues-panel"
      className="flex h-full w-full flex-col overflow-hidden border-l border-border-soft bg-bg-2 text-text-1"
    >
      {/* Header — panel title + icon-only "+ New" shortcut, matching the
          density of TasksPanel so the two sit comfortably side by side. */}
      <header className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="df-label">Issues</span>
          <Filter
            size={12}
            strokeWidth={2}
            className="text-text-4"
            aria-hidden
          />
        </div>
        <button
          type="button"
          onClick={() => showNewTaskDialog()}
          disabled={!canCreateTask}
          title={createDisabledReason}
          aria-label="New issue"
          className="flex h-6 items-center gap-1 rounded-sm border border-border-soft bg-bg-2 px-1.5 text-[10px] text-text-3 hover:border-border-mid hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={12} strokeWidth={2} />
          <span className="font-mono">New</span>
        </button>
      </header>

      {/* Tabs — primary filter dimension. Counts live inside each tab so the
          panel stays scannable even at a narrow width. */}
      <nav
        aria-label="Issue filters"
        className="flex items-center gap-1 overflow-x-auto border-b border-border-soft bg-bg-1 px-3 py-1.5"
      >
        {TABS.map((t) => {
          const selected = t.key === tab
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              title={t.hint}
              aria-pressed={selected}
              className={`flex items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-[10px] transition ${
                selected
                  ? 'border-accent-500 bg-accent-500/15 text-text-1'
                  : 'border-border-soft bg-bg-1 text-text-3 hover:border-border-mid hover:bg-bg-3 hover:text-text-1'
              }`}
            >
              <span>{t.label}</span>
              <span className="text-[9px] text-text-4">
                {tabCounts[t.key]}
              </span>
            </button>
          )
        })}
      </nav>

      {/* List */}
      <div className="df-scroll min-h-0 flex-1 overflow-y-auto">
        {!activeTeamId ? (
          <EmptyState
            title="No team selected"
            subtitle="Create or pick a team to see its issues."
          />
        ) : visibleTasks.length === 0 ? (
          <EmptyState
            title="Nothing here"
            subtitle={
              tab === 'all'
                ? 'No issues for this team yet.'
                : `No ${tab === 'mine' ? '"mine"' : tab} issues right now.`
            }
            cta={
              tab === 'all' && canCreateTask
                ? {
                    label: 'New issue',
                    onClick: () => showNewTaskDialog()
                  }
                : undefined
            }
          />
        ) : (
          <ul className="flex flex-col">
            {visibleTasks.map((t) => (
              <IssueRow
                key={t.id}
                task={t}
                assignee={
                  t.assignedAgentId ? (agentById.get(t.assignedAgentId) ?? null) : null
                }
                commentCount={commentsByTask.get(t.id) ?? 0}
                dragActive={dragOverId === t.id}
                onClick={() => setTaskDrawer(t.id)}
                onContextMenu={(e) => openContextMenu(e, t.id)}
                onDragOver={(e) => onRowDragOver(e, t.id)}
                onDragLeave={(e) => onRowDragLeave(e, t.id)}
                onDrop={(e) => onRowDrop(e, t)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Footer counter — mirrors TasksPanel so the eye has a stable anchor
          when swapping between panels. */}
      <footer className="flex items-center justify-between border-t border-border-soft bg-bg-1 px-3 py-1.5 font-mono text-[10px] text-text-4">
        <span>
          {visibleTasks.length}{' '}
          {visibleTasks.length === 1 ? 'issue' : 'issues'}
        </span>
        <span className="flex items-center gap-1">
          <MoreHorizontal size={12} strokeWidth={2} aria-hidden />
          Right-click for actions
        </span>
      </footer>

      {/* Creation modal lives globally in App.tsx (phase 4 of issue
          #12); opening flows through `useNewTaskDialog.show()`. */}

      {menu && menuTask ? (
        <RowContextMenu
          state={menu}
          task={menuTask}
          teamAgents={teamAgents}
          onClose={closeContextMenu}
          onReassign={(agentId) => handleReassign(agentId)}
          onChangePriority={(p) => handleChangePriority(p)}
          onCancel={() => handleCancel(menuTask.id)}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row — kept local because the visual layout is highly coupled to the panel
// (Linear-style dense line with avatar + status pill). Not worth a separate
// file; would only have one caller.
// ---------------------------------------------------------------------------

interface IssueRowProps {
  task: Task
  assignee: Agent | null
  commentCount: number
  dragActive: boolean
  onClick: () => void
  onContextMenu: (e: MouseEvent) => void
  onDragOver: (e: DragEvent) => void
  onDragLeave: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
}

function IssueRow({
  task,
  assignee,
  commentCount,
  dragActive,
  onClick,
  onContextMenu,
  onDragOver,
  onDragLeave,
  onDrop
}: IssueRowProps) {
  const onKey = (e: KeyboardEvent<HTMLLIElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick()
    }
  }

  const visibleTags = task.tags.slice(0, 2)
  const hiddenTagCount = task.tags.length - visibleTags.length
  const assigneeName = assignee?.name ?? null
  const time = relativeTime(task.updatedAt || task.createdAt)

  // Tooltip on the row surfaces the drop target identity — without a
  // dedicated tooltip primitive we lean on the native title attribute so
  // the hint travels with the mouse while dragging.
  const dropTitle = dragActive
    ? `Drop to reassign → ${task.title} (${shortId(task.id)})`
    : undefined

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKey}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-task-id={task.id}
      title={dropTitle}
      aria-label={`Open issue ${task.title}`}
      className={`flex min-h-[3.25rem] cursor-pointer flex-col gap-1 border-b border-border-soft px-3 py-2 transition-colors focus:outline-none ${
        dragActive
          ? 'bg-accent-500/10 ring-1 ring-inset ring-accent-500/50'
          : 'hover:bg-bg-3 focus:bg-bg-3'
      }`}
    >
      {/* Top row — priority pill, short id, title, assignee, status pill. */}
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`shrink-0 rounded-sm border px-1 py-[1px] font-mono text-[9px] font-semibold tracking-wider ${PRIORITY_PILL[task.priority]}`}
          aria-label={`Priority ${task.priority}`}
        >
          {task.priority}
        </span>
        <span
          className="shrink-0 font-mono text-[10px] text-text-4"
          aria-label={`Issue id ${shortId(task.id)}`}
          title={task.id}
        >
          {shortId(task.id)}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[12px] text-text-1"
          title={task.title}
        >
          {task.title}
        </span>

        {/* Assignee avatar + name. Falls back to a muted `unassigned` token
            so the row maintains a predictable right-edge silhouette. */}
        <span className="flex shrink-0 items-center gap-1">
          {assignee ? (
            <>
              <span
                aria-hidden
                style={{ backgroundColor: avatarColor(assignee.id) }}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-mono text-[8px] font-semibold text-white"
              >
                {avatarInitials(assignee.name || assignee.slug)}
              </span>
              <span
                className="max-w-[6rem] truncate font-mono text-[10px] text-text-3"
                title={assigneeName ?? ''}
              >
                {assignee.name || assignee.slug}
              </span>
            </>
          ) : (
            <span className="font-mono text-[10px] text-text-4">
              unassigned
            </span>
          )}
        </span>

        <span
          className={`shrink-0 rounded-sm border px-1 py-[1px] font-mono text-[9px] font-semibold tracking-wider ${STATUS_PILL[task.status]}`}
          aria-label={`Status ${task.status}`}
        >
          {STATUS_LABEL[task.status]}
        </span>
      </div>

      {/* Meta row — tags · comments · relative time. Mirrors TaskRow's
          second line so the two panels feel like siblings. */}
      <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-text-4">
        {visibleTags.length > 0 ? (
          <div className="flex min-w-0 items-center gap-1">
            {visibleTags.map((tag) => (
              <span
                key={tag}
                className="truncate rounded-sm border border-border-soft bg-bg-3 px-1 font-mono text-[9px] text-text-3"
                title={tag}
              >
                #{tag}
              </span>
            ))}
            {hiddenTagCount > 0 ? (
              <span className="font-mono text-[9px] text-text-4">
                +{hiddenTagCount}
              </span>
            ) : null}
            <span className="text-text-4" aria-hidden>
              ·
            </span>
          </div>
        ) : null}

        <span
          className="flex items-center gap-1 font-mono text-[10px] text-text-4"
          title={`${commentCount} comment${commentCount === 1 ? '' : 's'}`}
        >
          <MessageSquare size={10} strokeWidth={2} aria-hidden />
          {commentCount}
        </span>

        <span className="ml-auto shrink-0 font-mono text-[10px] text-text-4">
          {time}
        </span>
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Empty state — local mini-component so the panel body stays single-file.
// ---------------------------------------------------------------------------

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
