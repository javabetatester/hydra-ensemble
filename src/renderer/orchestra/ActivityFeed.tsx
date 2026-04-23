/**
 * ActivityFeed — chronological "what happened today" stream across the
 * whole active team.
 *
 * The panel derives a flat list of virtual events from the mirrored slices
 * in `useOrchestra` (tasks, routes, messageLog). No new store state, no new
 * IPC — events are computed on every render from the live data, capped at
 * 100 entries so long sessions stay snappy.
 *
 * Auto-scroll behaviour mirrors classic chat feeds: when the user is
 * already parked at the top the list snaps back to the top whenever a new
 * event lands; if they have scrolled away we respect their position and
 * only hint with a footer count delta. Detection is a `stickToTop` ref
 * flipped by the scroll handler so React re-renders don't churn it.
 *
 * Each event links to the TaskDrawer for its task when a `taskId` is
 * known, matching the rest of the orchestra UI where clicking anything
 * task-shaped opens the drawer.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CornerDownRight,
  FileText,
  MessageSquare,
  XCircle
} from 'lucide-react'
import type { MessageLog, Task, UUID } from '../../shared/orchestra'
import { useOrchestra } from './state/orchestra'
import { relativeTime } from '../lib/time'

/** Hard cap on how many events the panel keeps mounted at once. Older
 *  entries fall off the bottom — the event log on disk is the source of
 *  truth for anything past the window. */
const MAX_EVENTS = 100

type EventKind =
  | 'task.submitted'
  | 'task.routed'
  | 'task.delegated'
  | 'task.done'
  | 'task.failed'
  | 'message.status'
  | 'message.error'
  | 'message.approval'

interface Event {
  id: string
  at: string
  kind: EventKind
  icon: ReactNode
  title: string
  detail?: string
  onClick?: () => void
}

/** Icon palette — keeps all colour/size in one place so the feed rows
 *  don't have to special-case per kind. Error/failure share the red ramp,
 *  approvals sit on amber, everything else blends with text-3. */
const ICON_SIZE = 12
const ICON_STROKE = 2

function iconFor(kind: EventKind): ReactNode {
  const base = 'shrink-0'
  switch (kind) {
    case 'task.submitted':
      return (
        <FileText
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
          className={`${base} text-text-3`}
        />
      )
    case 'task.routed':
      return (
        <ArrowRight
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
          className={`${base} text-accent-400`}
        />
      )
    case 'task.delegated':
      return (
        <CornerDownRight
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
          className={`${base} text-accent-400`}
        />
      )
    case 'task.done':
      return (
        <CheckCircle2
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
          className={`${base} text-status-generating`}
        />
      )
    case 'task.failed':
      return (
        <XCircle
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
          className={`${base} text-status-attention`}
        />
      )
    case 'message.error':
      return (
        <AlertTriangle
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
          className={`${base} text-status-attention`}
        />
      )
    case 'message.approval':
      return (
        <AlertTriangle
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
          className={`${base} text-amber-400`}
        />
      )
    case 'message.status':
    default:
      return (
        <MessageSquare
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
          className={`${base} text-text-3`}
        />
      )
  }
}

/** Short quote helper — trims long content down to something the row can
 *  render on one line. Used for message detail lines which can hold full
 *  error bodies otherwise. */
function quote(s: string, max = 80): string {
  const trimmed = s.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}

export default function ActivityFeed() {
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const tasks = useOrchestra((s) => s.tasks)
  const routes = useOrchestra((s) => s.routes)
  const messageLog = useOrchestra((s) => s.messageLog)
  const agents = useOrchestra((s) => s.agents)
  const setTaskDrawer = useOrchestra((s) => s.setTaskDrawer)

  // Agent lookup keeps the event builder O(N) rather than O(N*M) when it
  // resolves "which agent was chosen" for routed events.
  const agentNameById = useMemo<Map<UUID, string>>(() => {
    const map = new Map<UUID, string>()
    for (const a of agents) map.set(a.id, a.name)
    return map
  }, [agents])

  // Fast membership check so route/message filtering can cheaply drop
  // entries from other teams without an inner .find on every row.
  const teamTaskIds = useMemo<Set<UUID>>(() => {
    const out = new Set<UUID>()
    if (!activeTeamId) return out
    for (const t of tasks) if (t.teamId === activeTeamId) out.add(t.id)
    return out
  }, [tasks, activeTeamId])

  const openTask = useCallback(
    (taskId: UUID) => setTaskDrawer(taskId),
    [setTaskDrawer]
  )

  const events = useMemo<Event[]>(() => {
    if (!activeTeamId) return []

    const out: Event[] = []

    // ---- Tasks --------------------------------------------------------
    // Each task yields one "submitted" event and, if terminal, one
    // "done"/"failed" event. Using updatedAt for the resolved event keeps
    // it chronologically correct even when main backfills old tasks.
    const teamTasks: Task[] = tasks.filter((t) => t.teamId === activeTeamId)
    for (const t of teamTasks) {
      out.push({
        id: `task-sub-${t.id}`,
        at: t.createdAt,
        kind: 'task.submitted',
        icon: iconFor('task.submitted'),
        title: `task.submitted · "${quote(t.title, 60)}"`,
        detail: t.tags.length > 0 ? t.tags.map((x) => `#${x}`).join(' ') : undefined,
        onClick: () => openTask(t.id)
      })
      if (t.status === 'done') {
        out.push({
          id: `task-done-${t.id}`,
          at: t.finishedAt ?? t.updatedAt,
          kind: 'task.done',
          icon: iconFor('task.done'),
          title: `task.done · "${quote(t.title, 60)}"`,
          onClick: () => openTask(t.id)
        })
      } else if (t.status === 'failed') {
        out.push({
          id: `task-failed-${t.id}`,
          at: t.finishedAt ?? t.updatedAt,
          kind: 'task.failed',
          icon: iconFor('task.failed'),
          title: `task.failed · "${quote(t.title, 60)}"`,
          detail: t.blockedReason ? quote(t.blockedReason) : undefined,
          onClick: () => openTask(t.id)
        })
      }
    }

    // ---- Routes -------------------------------------------------------
    // Only routes whose task belongs to the active team. A chosen agent
    // id that no longer resolves falls back to "unknown" so a deleted
    // agent doesn't blank out the line.
    for (const r of routes) {
      if (!teamTaskIds.has(r.taskId)) continue
      const chosen = agentNameById.get(r.chosenAgentId) ?? 'unknown'
      const scoreStr = Number.isFinite(r.score)
        ? ` · score ${r.score.toFixed(1)}`
        : ''
      out.push({
        id: `route-${r.id}`,
        at: r.at,
        kind: 'task.routed',
        icon: iconFor('task.routed'),
        title: `task.routed → ${chosen}${scoreStr}`,
        detail: r.reason ? quote(r.reason) : undefined,
        onClick: () => openTask(r.taskId)
      })
    }

    // ---- Messages -----------------------------------------------------
    // We keep delegation/error/approval kinds. Plain status/output noise
    // is filtered out — the feed is a higher-signal surface than the
    // full inspector timeline.
    const relevantMessages: MessageLog[] = messageLog.filter(
      (m) =>
        m.teamId === activeTeamId &&
        (m.kind === 'error' ||
          m.kind === 'approval_request' ||
          m.kind === 'delegation')
    )
    for (const m of relevantMessages) {
      if (m.kind === 'error') {
        out.push({
          id: `msg-${m.id}`,
          at: m.at,
          kind: 'message.error',
          icon: iconFor('message.error'),
          title: `message.error "${quote(m.content, 60)}"`,
          onClick: m.taskId ? () => openTask(m.taskId as UUID) : undefined
        })
      } else if (m.kind === 'approval_request') {
        out.push({
          id: `msg-${m.id}`,
          at: m.at,
          kind: 'message.approval',
          icon: iconFor('message.approval'),
          title: `message.approval · awaiting review`,
          detail: quote(m.content),
          onClick: m.taskId ? () => openTask(m.taskId as UUID) : undefined
        })
      } else {
        // delegation
        const fromName =
          m.fromAgentId === 'system' || m.fromAgentId === 'user'
            ? m.fromAgentId
            : (agentNameById.get(m.fromAgentId) ?? 'unknown')
        const toName =
          m.toAgentId === 'broadcast'
            ? 'broadcast'
            : (agentNameById.get(m.toAgentId) ?? 'unknown')
        out.push({
          id: `msg-${m.id}`,
          at: m.at,
          kind: 'task.delegated',
          icon: iconFor('task.delegated'),
          title: `task.delegated · ${fromName} → ${toName}`,
          detail: quote(m.content),
          onClick: m.taskId ? () => openTask(m.taskId as UUID) : undefined
        })
      }
    }

    // Newest first. Ties on `at` fall back to id so order is stable
    // across renders — React's key warning surfaced this on rapid
    // event bursts before the tiebreak.
    out.sort((a, b) => {
      if (a.at === b.at) return a.id < b.id ? 1 : -1
      return a.at < b.at ? 1 : -1
    })

    return out.slice(0, MAX_EVENTS)
  }, [tasks, routes, messageLog, teamTaskIds, agentNameById, activeTeamId, openTask])

  // Auto-scroll bookkeeping. `stickToTop` starts true (fresh mount is at
  // top) and flips whenever the user scrolls down past a small threshold.
  // We also store a ticker so every render that lands a new event nudges
  // the scroll container back to the top — but only when stickToTop is
  // still live.
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickToTop = useRef<boolean>(true)
  const [hiddenCount, setHiddenCount] = useState<number>(0)
  const lastTopEventId = useRef<string | null>(null)

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    // Anything within 8px of the top still counts as "parked at top" —
    // sub-pixel wheel events shouldn't break stickiness.
    const atTop = el.scrollTop <= 8
    stickToTop.current = atTop
    if (atTop && hiddenCount !== 0) setHiddenCount(0)
  }, [hiddenCount])

  useEffect(() => {
    const newest = events[0]?.id ?? null
    const changed = newest !== lastTopEventId.current
    lastTopEventId.current = newest
    if (!changed) return
    const el = scrollRef.current
    if (!el) return
    if (stickToTop.current) {
      el.scrollTop = 0
      if (hiddenCount !== 0) setHiddenCount(0)
    } else {
      setHiddenCount((n) => Math.min(n + 1, MAX_EVENTS))
    }
  }, [events, hiddenCount])

  const jumpToTop = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: 0, behavior: 'smooth' })
    stickToTop.current = true
    setHiddenCount(0)
  }, [])

  const hasEvents = events.length > 0

  return (
    <div
      data-coach="activity-feed"
      className="flex h-full w-full flex-col overflow-hidden border-l border-border-soft bg-bg-2 text-text-1"
    >
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-3 py-2">
        <span className="df-label">activity</span>
        <span className="font-mono text-[10px] text-text-4">
          {events.length} {events.length === 1 ? 'event' : 'events'}
        </span>
      </header>

      {/* Scroll region */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="df-scroll relative min-h-0 flex-1 overflow-y-auto"
      >
        {!activeTeamId ? (
          <EmptyState
            title="No team selected"
            subtitle="Pick a team to see its activity stream."
          />
        ) : !hasEvents ? (
          <EmptyState
            title="No activity yet"
            subtitle="Submit a task or trigger an agent to see events."
          />
        ) : (
          <ul className="flex flex-col">
            {events.map((evt) => (
              <EventRow key={evt.id} event={evt} />
            ))}
          </ul>
        )}

        {/* "N new" pill — appears only when the user has scrolled away
            and fresh events have arrived. Clicking snaps back to the top
            and re-arms stickiness. */}
        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={jumpToTop}
            className="sticky top-2 left-1/2 -translate-x-1/2 rounded-full border border-accent-600 bg-accent-500/90 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-bg-0 shadow-sm hover:bg-accent-500"
            aria-label={`${hiddenCount} new events — jump to top`}
          >
            {hiddenCount} new ↑
          </button>
        ) : null}
      </div>
    </div>
  )
}

interface EventRowProps {
  event: Event
}

function EventRow({ event }: EventRowProps) {
  const clickable = typeof event.onClick === 'function'
  const handleKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!clickable) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      event.onClick?.()
    }
  }
  return (
    <li>
      <div
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : -1}
        onClick={clickable ? event.onClick : undefined}
        onKeyDown={handleKey}
        className={`flex gap-2 border-b border-border-soft px-3 py-2 transition-colors ${
          clickable
            ? 'cursor-pointer hover:bg-bg-3 focus:bg-bg-3 focus:outline-none'
            : ''
        }`}
        aria-label={event.title}
      >
        <span className="mt-[3px]">{event.icon}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className="truncate text-[12px] text-text-1"
            title={event.title}
          >
            {event.title}
          </span>
          {event.detail ? (
            <span
              className="truncate font-mono text-[10px] text-text-3"
              title={event.detail}
            >
              {event.detail}
            </span>
          ) : null}
          <span className="font-mono text-[10px] text-text-4">
            {relativeTime(event.at)}
          </span>
        </div>
      </div>
    </li>
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
