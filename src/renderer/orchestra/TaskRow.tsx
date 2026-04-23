/**
 * TaskRow — single line in the TasksPanel list.
 *
 * Keyboard-accessible button-row that opens the TaskDrawer on click. All
 * colour/label derivation happens in the parent (TasksPanel) so the row
 * stays presentational and cheap to re-render in large lists.
 */
import type { KeyboardEvent } from 'react'
import { CircleCheck, CircleDashed, CircleX, Loader2 } from 'lucide-react'
import type { Priority, Task, TaskStatus } from '../../shared/orchestra'

interface Props {
  task: Task
  /** Display string — "Alice", "(auto)", or null when unassigned. The
   *  parent resolves this from the agents slice so TaskRow doesn't need
   *  to touch the store. */
  assigneeName: string | null
  onClick: () => void
}

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

/** Relative time in tiny units. "3s", "2m", "1h", "yesterday", else a
 *  short locale date. Inline, zero-dep. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const now = Date.now()
  const diffSec = Math.max(0, Math.floor((now - then) / 1000))
  if (diffSec < 60) return `${diffSec}s`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay === 1) return 'yesterday'
  if (diffDay < 7) return `${diffDay}d`
  return new Date(iso).toLocaleDateString()
}

export default function TaskRow({ task, assigneeName, onClick }: Props) {
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
      {/* Top row — priority pill + title */}
      <div className="flex items-center gap-2">
        <span
          className={`shrink-0 rounded-sm border px-1 py-[1px] font-mono text-[9px] font-semibold tracking-wider ${PRIORITY_PILL[task.priority]}`}
          aria-label={`Priority ${task.priority}`}
        >
          {task.priority}
        </span>
        <span
          className="truncate text-[12px] text-text-1"
          title={task.title}
        >
          {task.title}
        </span>
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
      </div>
    </div>
  )
}
