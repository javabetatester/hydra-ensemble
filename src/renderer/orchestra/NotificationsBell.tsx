/**
 * NotificationsBell — header-anchored notifications center for Orchestra.
 *
 * The bell reads the same mirrored slices as ActivityFeed but restricts
 * the event set to attention-worthy kinds: failures, errors, approval
 * requests, and (low-severity) completions. Unread status is computed
 * against `useNotifications.lastSeenAt`, a persisted ISO cursor bumped
 * whenever the user clicks "Clear".
 *
 * The dropdown is positioned with `absolute top-full right-0` relative
 * to the bell button, which is expected to live inside a `relative`
 * wrapper in the Orchestra header. Click-outside + Escape both close it;
 * clicking a row that carries a task opens the TaskDrawer then closes
 * the dropdown so the header doesn't linger over the drawer.
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
  Bell,
  CheckCircle2,
  CornerDownRight,
  XCircle
} from 'lucide-react'
import type { MessageLog, Task, UUID } from '../../shared/orchestra'
import { useOrchestra } from './state/orchestra'
import { useNotifications } from './state/notifications'
import { relativeTime } from '../lib/time'

/** Attention-worthy event kinds. Mirrors a subset of ActivityFeed's
 *  EventKind union — intentionally duplicated rather than imported so
 *  the bell stays loosely coupled to the feed's internals. */
type NotificationKind =
  | 'task.failed'
  | 'message.error'
  | 'message.approval_request'
  | 'task.done'

type Severity = 'error' | 'warn' | 'info'

interface Notification {
  id: string
  at: string
  kind: NotificationKind
  severity: Severity
  title: string
  detail?: string
  taskId: UUID | null
}

/** Matches the row sizing used elsewhere in the overlay chrome. Kept as
 *  constants so the JSX stays legible. */
const ICON_SIZE = 14
const ICON_STROKE = 2
const MAX_NOTIFICATIONS = 50


function quote(s: string, max = 80): string {
  const trimmed = s.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}

/** Per-kind severity mapping. `task.done` is deliberately `info` so it
 *  renders in the subdued style even when unread. */
function severityFor(kind: NotificationKind): Severity {
  switch (kind) {
    case 'task.failed':
    case 'message.error':
      return 'error'
    case 'message.approval_request':
      return 'warn'
    case 'task.done':
    default:
      return 'info'
  }
}

function iconFor(kind: NotificationKind): ReactNode {
  const base = 'shrink-0'
  switch (kind) {
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
    case 'message.approval_request':
      // Lucide's current bundle exposes `Handshake` (not `HandshakeIcon`).
      // Falling back to `CornerDownRight` keeps the component working on
      // any lucide minor version without a targeted import.
      return (
        <CornerDownRight
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
          className={`${base} text-amber-400`}
        />
      )
    case 'task.done':
    default:
      return (
        <CheckCircle2
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
          className={`${base} text-text-3`}
        />
      )
  }
}

interface Props {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export default function NotificationsBell(_: Props = {}) {
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const tasks = useOrchestra((s) => s.tasks)
  const messageLog = useOrchestra((s) => s.messageLog)
  const setTaskDrawer = useOrchestra((s) => s.setTaskDrawer)
  const lastSeenAt = useNotifications((s) => s.lastSeenAt)
  const markAllSeen = useNotifications((s) => s.markAllSeen)

  const [open, setOpen] = useState<boolean>(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // Compute the attention-worthy event list from the live slices.
  // Ordering: newest first; ties broken by id for stable React keys.
  const notifications = useMemo<Notification[]>(() => {
    if (!activeTeamId) return []

    const out: Notification[] = []

    // ---- Tasks: failed + done -----------------------------------------
    const teamTasks: Task[] = tasks.filter((t) => t.teamId === activeTeamId)
    for (const t of teamTasks) {
      if (t.status === 'failed') {
        out.push({
          id: `task-failed-${t.id}`,
          at: t.finishedAt ?? t.updatedAt,
          kind: 'task.failed',
          severity: severityFor('task.failed'),
          title: `Task failed · "${quote(t.title, 56)}"`,
          detail: t.blockedReason ? quote(t.blockedReason) : undefined,
          taskId: t.id
        })
      } else if (t.status === 'done') {
        out.push({
          id: `task-done-${t.id}`,
          at: t.finishedAt ?? t.updatedAt,
          kind: 'task.done',
          severity: severityFor('task.done'),
          title: `Task done · "${quote(t.title, 56)}"`,
          taskId: t.id
        })
      }
    }

    // ---- Messages: error + approval_request ---------------------------
    const relevantMessages: MessageLog[] = messageLog.filter(
      (m) =>
        m.teamId === activeTeamId &&
        (m.kind === 'error' || m.kind === 'approval_request')
    )
    for (const m of relevantMessages) {
      if (m.kind === 'error') {
        out.push({
          id: `msg-err-${m.id}`,
          at: m.at,
          kind: 'message.error',
          severity: severityFor('message.error'),
          title: `Error · ${quote(m.content, 56)}`,
          taskId: m.taskId
        })
      } else {
        out.push({
          id: `msg-appr-${m.id}`,
          at: m.at,
          kind: 'message.approval_request',
          severity: severityFor('message.approval_request'),
          title: 'Approval requested',
          detail: quote(m.content),
          taskId: m.taskId
        })
      }
    }

    out.sort((a, b) => {
      if (a.at === b.at) return a.id < b.id ? 1 : -1
      return a.at < b.at ? 1 : -1
    })

    return out.slice(0, MAX_NOTIFICATIONS)
  }, [tasks, messageLog, activeTeamId])

  // Partition by the persisted cursor. Strict `>` comparison ensures the
  // same ISO string doesn't straddle both buckets after markAllSeen().
  const { unread, read } = useMemo(() => {
    const u: Notification[] = []
    const r: Notification[] = []
    for (const n of notifications) {
      if (n.at > lastSeenAt) u.push(n)
      else r.push(n)
    }
    return { unread: u, read: r }
  }, [notifications, lastSeenAt])

  const unreadCount = unread.length
  const hasUnread = unreadCount > 0

  // Click-outside + Escape close. Using mousedown (not click) so a
  // downstream handler can't reopen the dropdown on the same event loop.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const w = wrapperRef.current
      if (!w) return
      if (!w.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = useCallback(() => setOpen((v) => !v), [])

  const onClear = useCallback(() => {
    markAllSeen()
  }, [markAllSeen])

  const onRowClick = useCallback(
    (n: Notification) => {
      if (n.taskId) setTaskDrawer(n.taskId)
      setOpen(false)
    },
    [setTaskDrawer]
  )

  // Display cap on the badge — avoids the pill stretching past two
  // glyphs when a long-running session piles up failures.
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount)

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={
          hasUnread
            ? `Notifications · ${unreadCount} unread`
            : 'Notifications'
        }
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative flex h-7 w-7 items-center justify-center rounded-sm border border-border-soft bg-bg-2 text-text-3 hover:border-border-mid hover:bg-bg-3 hover:text-text-1"
      >
        <Bell size={14} strokeWidth={ICON_STROKE} />
        {hasUnread ? (
          <>
            {/* Red dot — kept visually distinct from the count badge so
                at-a-glance "something happened" reads even when the
                badge overlaps the icon at small sizes. */}
            <span
              aria-hidden
              className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-status-attention"
            />
            <span
              aria-hidden
              className="absolute -right-1 -top-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full border border-bg-0 bg-status-attention px-1 font-mono text-[9px] font-semibold leading-none text-bg-0"
            >
              {badgeText}
            </span>
          </>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Notifications"
          className="df-fade-in absolute right-0 top-full z-[60] mt-1 w-[360px] overflow-hidden rounded-md border border-border-mid bg-bg-2 text-text-1 shadow-pop"
        >
          <header className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-3 py-2">
            <span className="df-label">notifications</span>
            <button
              type="button"
              onClick={onClear}
              disabled={!hasUnread}
              className="rounded-sm border border-border-soft bg-bg-2 px-1.5 py-0.5 font-mono text-[10px] text-text-3 hover:border-border-mid hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear
            </button>
          </header>

          <div className="df-scroll max-h-[420px] overflow-y-auto">
            {notifications.length === 0 ? (
              <EmptyState />
            ) : (
              <ul className="flex flex-col">
                {unread.map((n) => (
                  <NotificationRow
                    key={n.id}
                    notification={n}
                    dimmed={false}
                    onClick={onRowClick}
                  />
                ))}

                {unread.length > 0 && read.length > 0 ? (
                  <li
                    aria-hidden
                    className="border-b border-border-soft bg-bg-1 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-text-4"
                  >
                    earlier
                  </li>
                ) : null}

                {read.map((n) => (
                  <NotificationRow
                    key={n.id}
                    notification={n}
                    dimmed
                    onClick={onRowClick}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

interface NotificationRowProps {
  notification: Notification
  /** True when the row belongs to the "already seen" group. Also true
   *  for task.done events even when unread, since they're low-severity
   *  and shouldn't visually shout. */
  dimmed: boolean
  onClick: (n: Notification) => void
}

function NotificationRow({ notification, dimmed, onClick }: NotificationRowProps) {
  const clickable = notification.taskId !== null
  // task.done is always rendered subdued regardless of unread state.
  const lowSeverity = notification.severity === 'info'
  const rowDimmed = dimmed || lowSeverity

  const handleKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!clickable) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick(notification)
    }
  }

  return (
    <li>
      <div
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : -1}
        onClick={clickable ? () => onClick(notification) : undefined}
        onKeyDown={handleKey}
        className={[
          'flex gap-2 border-b border-border-soft px-3 py-2 transition-colors',
          rowDimmed ? 'opacity-70' : '',
          clickable
            ? 'cursor-pointer hover:bg-bg-3 focus:bg-bg-3 focus:outline-none'
            : ''
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label={notification.title}
      >
        <span className="mt-[2px]">{iconFor(notification.kind)}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className="truncate text-[12px] text-text-1"
            title={notification.title}
          >
            {notification.title}
          </span>
          {notification.detail ? (
            <span
              className="truncate font-mono text-[10px] text-text-3"
              title={notification.detail}
            >
              {notification.detail}
            </span>
          ) : null}
          <span className="font-mono text-[10px] text-text-4">
            {relativeTime(notification.at)}
          </span>
        </div>
      </div>
    </li>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-8 text-center">
      <span className="font-mono text-[11px] text-text-2">All caught up</span>
      <span className="font-mono text-[10px] text-text-4">
        No failures or approvals need your attention.
      </span>
    </div>
  )
}
