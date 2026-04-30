/**
 * TaskRow — single line in the TasksPanel list.
 *
 * Keyboard-accessible button-row that opens the TaskDrawer on click. All
 * colour/label derivation happens in the parent (TasksPanel) so the row
 * stays presentational and cheap to re-render in large lists.
 *
 * UX affordances rendered inline on the row:
 *   · "auto" pill when the task was fallback-routed (no trigger matched)
 *   · "fix" chip when a failed task is waiting on provider config
 *     (no_api_key / missing claude CLI) — clicking opens ProvidersDialog
 *     via a window event so the store stays lean.
 */
import type { KeyboardEvent, MouseEvent } from 'react'
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Loader2,
  RotateCcw,
  Route as RouteIcon,
  Settings,
  Square
} from 'lucide-react'
import type { Priority, Task, TaskStatus } from '../../shared/orchestra'
import { relativeTime } from '../lib/time'

interface Props {
  task: Task
  /** Display string — "Alice", "(auto)", or null when unassigned. The
   *  parent resolves this from the agents slice so TaskRow doesn't need
   *  to touch the store. */
  assigneeName: string | null
  /** True when the latest Route for this task used a `fallback:*` reason.
   *  Resolved by the parent from the routes slice. When true we show a tiny
   *  neutral "auto" pill so the user can tell at a glance the router
   *  defaulted vs. matched a trigger. */
  autoRouted?: boolean
  /** Short failure reason (e.g. Task.blockedReason) — used to decide
   *  whether to surface the "fix" provider chip. */
  failureReason?: string
  onClick: () => void
  /** Optional inline-action callbacks. When provided, hover-reveal
   *  buttons appear on the meta row: Stop for in-flight tasks
   *  (queued/routing/in_progress/blocked), Re-run for terminal ones
   *  (done/failed). Both swallow click propagation so the row's
   *  drawer-open handler doesn't fire. */
  onStop?: (task: Task) => void
  onRerun?: (task: Task) => void
}

const ACTIVE_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'queued',
  'routing',
  'in_progress',
  'blocked'
])
const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'done',
  'failed'
])

/** Priority pill palette — kept in sync with TaskBar.tsx. P3 is the muted
 *  neutral, P0 the alarming red. */
const PRIORITY_PILL: Record<Priority, string> = {
  P0: 'border-red-500/60 bg-red-500/15 text-red-300',
  P1: 'border-amber-500/60 bg-amber-500/15 text-amber-300',
  P2: 'border-sky-500/50 bg-sky-500/10 text-sky-300',
  P3: 'border-border-mid bg-bg-3 text-text-3'
}

/** Human-readable label for each terminal/active state. Kept short so the
 *  meta-row doesn't wrap on narrow panel widths. */
const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: 'queued',
  routing: 'routing',
  in_progress: 'running',
  blocked: 'blocked',
  done: 'done',
  failed: 'failed'
}

/** Status color — running pulses the accent, done is green, failed red,
 *  everything else fades to text-4. Matches TaskDrawer conventions. */
function statusClass(s: TaskStatus): string {
  switch (s) {
    case 'in_progress':
    case 'routing':
      return 'text-accent-400 df-pulse'
    case 'done':
      return 'text-status-generating'
    case 'failed':
      return 'text-status-attention'
    case 'blocked':
      return 'text-amber-400'
    case 'queued':
    default:
      return 'text-text-4'
  }
}

/** Pick a lucide icon that matches the status dot to the left of the label. */
function StatusIcon({ status }: { status: TaskStatus }) {
  const cls = 'shrink-0'
  switch (status) {
    case 'in_progress':
    case 'routing':
      return <Loader2 size={10} strokeWidth={2} className={`${cls} animate-spin`} />
    case 'done':
      return <CircleCheck size={10} strokeWidth={2} className={cls} />
    case 'failed':
      return <CircleX size={10} strokeWidth={2} className={cls} />
    case 'blocked':
    case 'queued':
    default:
      return <CircleDashed size={10} strokeWidth={2} className={cls} />
  }
}

// relativeTime moved to ../lib/time — every surface renders the same
// "Ns / Nm / Nh / Nd / date" ladder now.

/** True when a failed task's reason points at missing provider configuration.
 *  Matches the two shapes we emit from main: the canonical `no_api_key`
 *  short-code and the human CLI-not-found message. Case-insensitive so
 *  minor wording drift doesn't break the affordance. */
function isProviderFailure(reason: string | undefined): boolean {
  if (!reason) return false
  const r = reason.toLowerCase()
  return r === 'no_api_key' || r.includes('claude cli not found')
}

export default function TaskRow({
  task,
  assigneeName,
  autoRouted = false,
  failureReason,
  onClick,
  onStop,
  onRerun
}: Props) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick()
    }
  }

  // Clamp the tag list so a pathological task with 20+ tags doesn't blow
  // the row height. First two visible, rest summarised as "+N".
  const visibleTags = task.tags.slice(0, 2)
  const hiddenTagCount = task.tags.length - visibleTags.length

  const showFixChip =
    task.status === 'failed' && isProviderFailure(failureReason)

  const onFixProvider = (e: MouseEvent<HTMLButtonElement>): void => {
    // Don't propagate to the row — the chip has its own destination.
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent('orchestra:open-providers'))
  }

  const onFixKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    // Swallow Enter/Space so the row's handler doesn't also fire.
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation()
    }
  }

  const swallowKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
  }
  const handleStop = (e: MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation()
    onStop?.(task)
  }
  const handleRerun = (e: MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation()
    onRerun?.(task)
  }
  const showStop = !!onStop && ACTIVE_STATUSES.has(task.status)
  const showRerun = !!onRerun && TERMINAL_STATUSES.has(task.status)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKey}
      data-task-id={task.id}
      className="flex min-h-16 cursor-pointer flex-col gap-1 border-b border-border-soft px-3 py-2 transition-colors hover:bg-bg-3 focus:bg-bg-3 focus:outline-none"
      aria-label={`Open task ${task.title}`}
    >
      {/* Top row — priority pill + title + optional affordances */}
      <div className="flex items-center gap-2">
        <span
          className={`shrink-0 rounded-sm border px-1 py-[1px] font-mono text-[9px] font-semibold tracking-wider ${PRIORITY_PILL[task.priority]}`}
          aria-label={`Priority ${task.priority}`}
        >
          {task.priority}
        </span>
        {autoRouted ? (
          <span
            className="flex shrink-0 items-center gap-0.5 rounded-sm border border-border-soft bg-bg-3 px-1 py-[1px] font-mono text-[9px] text-text-3"
            title="Auto-routed to main agent — no trigger matched"
            aria-label="Auto-routed"
          >
            <RouteIcon size={9} strokeWidth={1.75} />
            auto
          </span>
        ) : null}
        <span
          className="truncate text-[12px] text-text-1"
          title={task.title}
        >
          {task.title}
        </span>
        {showFixChip ? (
          <button
            type="button"
            onClick={onFixProvider}
            onKeyDown={onFixKey}
            className="ml-auto flex shrink-0 items-center gap-0.5 rounded-sm border border-red-500/60 bg-red-500/15 px-1 py-[1px] font-mono text-[9px] font-semibold text-red-300 hover:bg-red-500/25 hover:text-red-200"
            title={failureReason ?? 'Fix provider configuration'}
            aria-label="Fix provider configuration"
          >
            <Settings size={9} strokeWidth={2} />
            fix
          </button>
        ) : null}
      </div>

      {/* Meta row — tags, status, assignee, time */}
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
          </div>
        ) : null}

        {visibleTags.length > 0 ? (
          <span className="text-text-4" aria-hidden>
            ·
          </span>
        ) : null}

        <span
          className={`flex items-center gap-1 font-mono text-[10px] ${statusClass(task.status)}`}
        >
          <StatusIcon status={task.status} />
          {STATUS_LABEL[task.status]}
        </span>

        {assigneeName ? (
          <>
            <span className="text-text-4" aria-hidden>
              ·
            </span>
            <span className="truncate font-mono text-[10px] text-text-3" title={assigneeName}>
              {assigneeName}
            </span>
          </>
        ) : null}

        <span className="ml-auto shrink-0 font-mono text-[10px] text-text-4">
          {relativeTime(task.createdAt)}
        </span>

        {showStop ? (
          <button
            type="button"
            onClick={handleStop}
            onKeyDown={swallowKey}
            title="Stop task"
            aria-label={`Stop task ${task.title}`}
            className="df-hover-reveal shrink-0 rounded-sm p-0.5 text-text-4 hover:bg-bg-3 hover:text-status-attention"
          >
            <Square size={11} strokeWidth={2} />
          </button>
        ) : null}
        {showRerun ? (
          <button
            type="button"
            onClick={handleRerun}
            onKeyDown={swallowKey}
            title="Re-run task"
            aria-label={`Re-run task ${task.title}`}
            className="df-hover-reveal shrink-0 rounded-sm p-0.5 text-text-4 hover:bg-bg-3 hover:text-accent-400"
          >
            <RotateCcw size={11} strokeWidth={2} />
          </button>
        ) : null}
      </div>
    </div>
  )
}
