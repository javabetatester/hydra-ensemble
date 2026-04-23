/**
 * DraggableTaskCard — paperclip-style "issue card" you can grab and drop.
 *
 * Orchestra historically only rendered `TaskChip` as a non-interactive flight
 * overlay, so the user had no way to hand-reassign a task mid-flight. This
 * card fills that gap: it is a native HTML5 drag source sized roughly like a
 * paperclip issue card (~180x64, or ~140x48 when `compact`) and exposes the
 * task id over a typed MIME so any `AgentCard` can opt-in as a drop target.
 *
 * ─── Drop target integration (consumers, do NOT modify this file) ──────────
 *
 * `AgentCard` consumers should wire two native handlers to accept the drop:
 *
 *   onDragOver: (e) => {
 *     if (e.dataTransfer.types.includes('application/x-hydra-task')) {
 *       e.preventDefault()
 *     }
 *   }
 *   onDrop: (e) => {
 *     const id = e.dataTransfer.getData('application/x-hydra-task')
 *     if (id) onReassignTask(id)   // route via store action
 *   }
 *
 * The `application/x-hydra-task` MIME is the load-bearing contract — using a
 * bespoke type (rather than `text/plain`) lets drop targets discriminate
 * Hydra task payloads from foreign drags (files, text selections, browser
 * links) without peeking at the payload value.
 */
import { useCallback, useMemo, useState } from 'react'
import type { CSSProperties, DragEvent } from 'react'
import { GripVertical } from 'lucide-react'
import type { Priority, Task, UUID } from '../../shared/orchestra'
import { useOrchestra } from './state/orchestra'
import { defaultAgentColor } from '../lib/agent'

/**
 * Custom MIME the drag-and-drop handshake uses. Exported so drop targets can
 * reference the exact same string without risking a typo drift.
 */
export const HYDRA_TASK_MIME = 'application/x-hydra-task'

interface Props {
  task: Task
  compact?: boolean
}

/** Matches the pill colour scheme already used by `TaskChip` / `TaskKanban`. */
const PRIORITY_PILL: Record<Priority, string> = {
  P0: 'border-red-500/70 bg-red-500/20 text-red-200',
  P1: 'border-amber-500/70 bg-amber-500/20 text-amber-200',
  P2: 'border-sky-500/60 bg-sky-500/15 text-sky-200',
  P3: 'border-border-mid bg-bg-3 text-text-2'
}

export default function DraggableTaskCard({ task, compact = false }: Props) {
  // We read `agents` off the store so the assignee chip stays live as the
  // store updates — the card may sit on-screen for a while before the user
  // commits a drop, and agent renames / reassignments shouldn't fossilise.
  const agents = useOrchestra((s) => s.agents)

  const agent = useMemo(() => {
    if (!task.assignedAgentId) return null
    return agents.find((a) => a.id === (task.assignedAgentId as UUID)) ?? null
  }, [agents, task.assignedAgentId])

  const assigneeName = agent?.name ?? '(unassigned)'
  const assigneeColor = agent ? agent.color || defaultAgentColor(agent.id) : undefined

  // `isDragging` drives the `opacity-40` ghost state. We deliberately track
  // this ourselves rather than relying on `:active` because HTML5 drag fires
  // `dragend` on drop/cancel even if the pointer never returned to the source
  // — using CSS pseudo-states leaves the element stuck translucent.
  const [isDragging, setIsDragging] = useState(false)
  const [isHover, setIsHover] = useState(false)

  const onDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      // Primary channel: the typed MIME drop targets sniff for. Carrying just
      // the task id keeps the payload minimal — the drop handler re-reads the
      // full task from the store so stale snapshots can't sneak in.
      e.dataTransfer.setData(HYDRA_TASK_MIME, task.id)
      // Fallback channel: some environments (notably external editors) only
      // surface `text/plain`. The title is a safe human-readable hint.
      e.dataTransfer.setData('text/plain', task.title)
      e.dataTransfer.effectAllowed = 'move'
      setIsDragging(true)
    },
    [task.id, task.title]
  )

  const onDragEnd = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Card dimensions are explicit (not just Tailwind min-w/min-h) so drag
  // ghosts rendered by the browser match the on-screen footprint exactly.
  const size: CSSProperties = compact
    ? { width: 140, height: 48 }
    : { width: 180, height: 64 }

  return (
    <div
      draggable
      role="button"
      tabIndex={0}
      aria-grabbed={isDragging}
      aria-label={`Drag task ${task.title} onto an agent to reassign`}
      data-task-id={task.id}
      data-compact={compact ? 'true' : 'false'}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      onFocus={() => setIsHover(true)}
      onBlur={() => setIsHover(false)}
      style={size}
      className={[
        'group relative flex shrink-0 cursor-grab select-none items-center gap-2 rounded-md border border-border-soft bg-bg-2 px-2 py-1.5 shadow-[0_1px_0_rgba(0,0,0,0.25)] transition',
        'hover:border-accent-500/60 hover:bg-bg-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-500',
        'active:cursor-grabbing',
        isDragging ? 'opacity-40' : ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Grip affordance — only visible on hover/focus so idle cards stay
          visually quiet. `aria-hidden` because the whole card is already the
          drag handle; the icon is pure affordance. */}
      <span
        aria-hidden
        className={`flex h-full shrink-0 items-center text-text-4 transition-opacity ${
          isHover || isDragging ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <GripVertical size={compact ? 12 : 14} />
      </span>

      {/* Body — priority pill above (or inline with) title, assignee chip
          tucked to the right so the title always gets the remaining width. */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={`shrink-0 rounded-sm border px-1 py-[1px] font-mono font-semibold tracking-wider ${PRIORITY_PILL[task.priority]} ${
              compact ? 'text-[8px]' : 'text-[9px]'
            }`}
            aria-label={`Priority ${task.priority}`}
          >
            {task.priority}
          </span>
          <span
            className={`truncate text-text-1 ${compact ? 'text-[11px]' : 'text-[12px]'}`}
            title={task.title}
          >
            {task.title}
          </span>
        </div>

        {/* Assignee chip — coloured dot + name, mirrors TaskKanban styling so
            a card dragged out of the board looks visually continuous. The row
            is omitted in compact mode to keep the 48px height. */}
        {!compact ? (
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: assigneeColor ?? 'var(--color-border-mid, #555)' }}
              aria-hidden
            />
            <span
              className="truncate font-mono text-[10px] text-text-3"
              title={assigneeName}
            >
              {assigneeName}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
