/**
 * TaskChat — chat-style panel for a single Orchestra task.
 *
 * Mounted as a right-drawer (alternative to TaskDrawer). Shows the messageLog
 * entries filtered to `taskId` as conversational bubbles (user / system /
 * agent output / delegation chip / error / approval request). The composer
 * is intentionally rendered but disabled: the runner does not accept
 * mid-task injections yet — we keep the UI so the feature can land in a
 * later phase without a re-layout.
 *
 * Autoscroll mirrors ConsoleTab: stick to bottom unless the user scrolled
 * away, then reveal a "jump to latest" pill.
 *
 * See PRD.md §10.F5 / §10.F6 and PLAN.md §2 (messageLog as task conversation).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  CornerDownRight,
  Send,
  X
} from 'lucide-react'
import type { Agent, MessageLog, Task } from '../../shared/orchestra'
import { useOrchestra } from './state/orchestra'
import { useToasts } from '../state/toasts'
import { relativeTime } from '../lib/time'

interface Props {
  taskId: string
  onClose: () => void
}

/** Bubble author resolution — agent name from `agents`, or 'system' / 'user'. */
function participantLabel(id: string, agents: Agent[]): string {
  if (id === 'system') return 'system'
  if (id === 'user') return 'user'
  if (id === 'broadcast') return 'broadcast'
  const a = agents.find((x) => x.id === id)
  return a?.name ?? 'unknown'
}

/** Thin shim so the tick-driven `now` drives re-render while the actual
 *  formatting stays in the shared helper. */
const relTime = (iso: string, now: number): string =>
  relativeTime(iso, new Date(now))

/** Anything within this many pixels of the bottom counts as "still following". */
const STICK_THRESHOLD_PX = 32
/** Content longer than this gets a "show more" toggle. */
const TRUNCATE_AT = 280

/** Try to parse an `approval_request` payload for inline Allow/Deny affordance.
 *  Mirrors ApprovalCard's shape; we only need the tool name here. */
function tryParseApproval(
  content: string
): { tool: string; args: unknown } | null {
  try {
    const obj = JSON.parse(content) as Record<string, unknown>
    if (typeof obj.tool !== 'string') return null
    return { tool: obj.tool, args: obj.args }
  } catch {
    return null
  }
}

export default function TaskChat({ taskId, onClose }: Props) {
  const tasks = useOrchestra((s) => s.tasks)
  const agents = useOrchestra((s) => s.agents)
  const messageLog = useOrchestra((s) => s.messageLog)
  const pushToast = useToasts((s) => s.push)

  const task: Task | undefined = useMemo(
    () => tasks.find((t) => t.id === taskId),
    [tasks, taskId]
  )

  // Entries addressed to this task, chronological.
  const entries = useMemo<MessageLog[]>(
    () =>
      messageLog
        .filter((m) => m.taskId === taskId)
        .slice()
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)),
    [messageLog, taskId]
  )

  // Re-tick relative times every 10s so "3s ago" doesn't lie.
  const [now, setNow] = useState<number>(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 10_000)
    return () => window.clearInterval(id)
  }, [])

  // Per-bubble expansion for long content.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // Autoscroll / sticky-bottom state, matching ConsoleTab.
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevScrollTopRef = useRef(0)
  const [paused, setPaused] = useState(false)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (!paused) {
      el.scrollTop = el.scrollHeight
      prevScrollTopRef.current = el.scrollTop
    }
  }, [entries, paused])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distanceFromBottom <= STICK_THRESHOLD_PX
    const delta = el.scrollTop - prevScrollTopRef.current
    prevScrollTopRef.current = el.scrollTop

    if (atBottom) {
      if (paused) setPaused(false)
      return
    }
    if (delta < 0 && !paused) setPaused(true)
  }

  const jumpToLatest = (): void => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    prevScrollTopRef.current = el.scrollTop
    setPaused(false)
  }

  // Esc → close the panel. Scoped so we don't steal Esc elsewhere.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Reply composer state. Send is a stub — we keep the input wired so the
  // interaction model is already there; a later phase swaps the toast for a
  // real IPC call.
  const [draft, setDraft] = useState('')

  const notifyDisabled = useCallback((): void => {
    pushToast({
      kind: 'info',
      title: 'Mid-task replies are not supported yet',
      body: 'The runner does not accept mid-task injections in this build.'
    })
  }, [pushToast])

  const onKeyDownComposer = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // TODO(task-chat): wire to IPC once the runner accepts mid-task
      // injections. For now we just surface a toast so users know why the
      // keystroke didn't send anything.
      notifyDisabled()
    }
  }

  const onSendClick = (): void => {
    // TODO(task-chat): replace stub with IPC call when mid-task injection ships.
    notifyDisabled()
  }

  // Approval stubs — same behavior as ApprovalCard's injected no-ops:
  // log to console and close the drawer so the flow feels terminal.
  const onApprove = useCallback((): void => {
    // eslint-disable-next-line no-console
    console.log('[TaskChat] approve (stub)')
    onClose()
  }, [onClose])
  const onDeny = useCallback((): void => {
    // eslint-disable-next-line no-console
    console.log('[TaskChat] deny (stub)')
    onClose()
  }, [onClose])

  // Task might be missing briefly if the id points to a deleted row.
  if (!task) {
    return (
      <aside
        className="df-slide-in fixed right-0 top-0 z-40 flex h-full w-[420px] flex-col border-l border-border-mid bg-bg-2 shadow-[-12px_0_24px_-8px_rgba(0,0,0,0.6)]"
        role="dialog"
        aria-label="Task chat"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border-soft px-3 py-2">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="Back"
            title="Esc"
          >
            <ArrowLeft size={12} strokeWidth={1.75} />
            back
          </button>
          <span className="text-[11px] text-text-4">task not found</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1.5 text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="Close"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </header>
        <div className="flex flex-1 items-center justify-center text-xs text-text-4">
          This task no longer exists.
        </div>
      </aside>
    )
  }

  return (
    <aside
      className="df-slide-in fixed right-0 top-0 z-40 flex h-full w-[420px] flex-col border-l border-border-mid bg-bg-2 shadow-[-12px_0_24px_-8px_rgba(0,0,0,0.6)]"
      role="dialog"
      aria-label={`Task chat: ${task.title}`}
    >
      {/* Header: back · title · close */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border-soft px-3 py-2.5">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] text-text-3 hover:bg-bg-3 hover:text-text-1"
          aria-label="Back"
          title="Esc"
        >
          <ArrowLeft size={12} strokeWidth={1.75} />
          back
        </button>
        <span
          className="min-w-0 flex-1 truncate text-center text-[12px] font-semibold text-text-1"
          title={task.title}
        >
          {task.title}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm p-1.5 text-text-3 hover:bg-bg-3 hover:text-text-1"
          aria-label="Close"
          title="Esc"
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </header>

      {/* Scrollable conversation surface */}
      <div className="relative flex min-h-0 flex-1 flex-col bg-bg-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="df-scroll flex-1 overflow-y-auto px-3 py-3"
        >
          {entries.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[11px] text-text-4">
              no messages yet
            </div>
          ) : (
            <ul className="space-y-2.5">
              {entries.map((m) => {
                const author = participantLabel(m.fromAgentId, agents)
                const isUser = m.fromAgentId === 'user'
                const isSystem = m.fromAgentId === 'system'
                const isUserOrSystem =
                  (isUser || isSystem) && m.kind === 'status'
                const isError = m.kind === 'error'
                const isDelegation = m.kind === 'delegation'
                const isApproval = m.kind === 'approval_request'

                // Delegation chip — compact inline row with "delegated to X".
                if (isDelegation) {
                  const target = participantLabel(m.toAgentId, agents)
                  return (
                    <li
                      key={m.id}
                      className="flex items-center justify-center"
                    >
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-500/30 bg-accent-500/10 px-2 py-0.5 text-[10px] text-accent-400">
                        <CornerDownRight
                          size={10}
                          strokeWidth={1.75}
                          className="text-accent-400"
                        />
                        <span className="text-text-3">{author}</span>
                        <span>delegated to</span>
                        <span className="text-text-1">{target}</span>
                        <span className="text-text-4">
                          · {relTime(m.at, now)}
                        </span>
                      </span>
                    </li>
                  )
                }

                // Bubble styling by role.
                let bubbleCls =
                  'border-border-soft bg-bg-3/60 text-text-1'
                if (isError) {
                  bubbleCls =
                    'border-status-attention/40 bg-status-attention/10 text-text-1'
                } else if (isApproval) {
                  bubbleCls =
                    'border-amber-500/40 bg-amber-500/10 text-text-1'
                } else if (isUserOrSystem) {
                  bubbleCls = 'border-border-soft bg-bg-3/70 text-text-1'
                } else if (m.kind === 'output') {
                  bubbleCls =
                    'border-accent-500/30 bg-accent-500/[0.15] text-text-1'
                }

                const isExpanded = expanded[m.id] === true
                const needsTruncate = m.content.length > TRUNCATE_AT
                const shown =
                  isExpanded || !needsTruncate
                    ? m.content
                    : `${m.content.slice(0, TRUNCATE_AT)}…`

                const parsedApproval = isApproval
                  ? tryParseApproval(m.content)
                  : null

                return (
                  <li key={m.id} className="flex flex-col items-start">
                    <div className="mb-0.5 flex items-center gap-1.5 pl-0.5 text-[10px] text-text-4">
                      {isError ? (
                        <AlertTriangle
                          size={10}
                          strokeWidth={1.75}
                          className="text-status-attention"
                        />
                      ) : null}
                      <span className="font-medium text-text-2">{author}</span>
                      <span>·</span>
                      <span>{relTime(m.at, now)}</span>
                      {isApproval ? (
                        <>
                          <span>·</span>
                          <span className="uppercase tracking-wide text-amber-400">
                            approval
                          </span>
                        </>
                      ) : null}
                    </div>

                    <div
                      className={`max-w-[92%] rounded-md border px-2.5 py-1.5 ${bubbleCls}`}
                    >
                      {parsedApproval ? (
                        <div className="mb-2 text-[11px] text-text-3">
                          agent wants to run{' '}
                          <span className="font-mono text-text-1">
                            {parsedApproval.tool}
                          </span>
                        </div>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => {
                          if (!needsTruncate) return
                          setExpanded((prev) => ({
                            ...prev,
                            [m.id]: !isExpanded
                          }))
                        }}
                        className={`block w-full text-left ${
                          needsTruncate
                            ? 'cursor-pointer'
                            : 'cursor-default'
                        }`}
                        aria-expanded={
                          needsTruncate ? isExpanded : undefined
                        }
                      >
                        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-inherit">
                          {shown}
                        </pre>
                        {needsTruncate ? (
                          <span className="mt-1 inline-block font-mono text-[10px] text-text-4 hover:text-text-2">
                            {isExpanded ? 'show less' : 'show more'}
                          </span>
                        ) : null}
                      </button>

                      {isApproval ? (
                        <div className="mt-2 flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={onDeny}
                            className="flex h-6 flex-1 items-center justify-center rounded-sm border border-status-attention/40 bg-status-attention/10 px-2 text-[10px] font-semibold text-status-attention hover:bg-status-attention/20"
                            aria-label="Deny"
                          >
                            Deny
                          </button>
                          <button
                            type="button"
                            onClick={onApprove}
                            className="flex h-6 flex-1 items-center justify-center rounded-sm border border-accent-600 bg-accent-500/90 px-2 text-[10px] font-semibold text-bg-0 hover:bg-accent-500"
                            aria-label="Allow"
                          >
                            Allow
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {paused && entries.length > 0 ? (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 right-3 flex items-center gap-1 rounded-sm border border-accent-500/40 bg-accent-500/10 px-2 py-1 font-mono text-[10px] text-accent-400 shadow-sm hover:bg-accent-500/20"
            title="jump to latest"
          >
            jump to latest
          </button>
        ) : null}
      </div>

      {/* Composer — visually present, behaviorally disabled. */}
      <footer className="flex shrink-0 flex-col gap-1.5 border-t border-border-soft bg-bg-2 px-3 py-2">
        <div className="flex items-end gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDownComposer}
            disabled
            rows={2}
            placeholder="Reply… (disabled — runner has no mid-task injection yet)"
            title="Mid-task replies are not supported yet"
            className="flex-1 resize-none rounded-sm border border-border-soft bg-bg-1 px-2 py-1.5 font-mono text-[11px] leading-snug text-text-2 placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent-500/40 disabled:cursor-not-allowed disabled:opacity-70"
            aria-label="Reply"
            aria-disabled="true"
          />
          <button
            type="button"
            onClick={onSendClick}
            disabled
            title="Mid-task replies are not supported yet"
            aria-label="Send reply"
            aria-disabled="true"
            className="flex h-8 items-center gap-1 rounded-sm border border-border-soft bg-bg-3 px-2.5 font-mono text-[11px] font-semibold text-text-4 hover:border-border-mid disabled:cursor-not-allowed"
          >
            <Send size={11} strokeWidth={1.75} />
            Send
          </button>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-text-4">
          <AlertTriangle
            size={10}
            strokeWidth={1.75}
            className="text-amber-400"
          />
          <span>
            Disabled: runner does not accept mid-task injections yet.
          </span>
        </div>
      </footer>
    </aside>
  )
}
