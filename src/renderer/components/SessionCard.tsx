import { useEffect, useRef, useState } from 'react'
import { GitBranch, X, RotateCw, Edit3, Copy } from 'lucide-react'
import type { SessionMeta, SessionState } from '../../shared/types'
import SessionStatePill from './SessionStatePill'
import AgentAvatar from './AgentAvatar'
import { defaultAgentColor, hexAlpha } from '../lib/agent'
import { fmtShortcut } from '../lib/platform'
import { useSessions } from '../state/sessions'

interface Props {
  session: SessionMeta
  index: number
  active: boolean
  onClick: () => void
  onDestroy: () => void
  onRestart?: () => void
  onEdit?: () => void
  onClone?: () => void
}

/**
 * Left-edge accent bar color per session state. Matches the semantic tokens
 * already used by `SessionStatePill` so idle rows fade into the sidebar while
 * active states (thinking/generating/userInput/needsAttention) "shout" at a
 * glance without forcing the user to parse the pill label.
 */
const STATE_BAR_CLASS: Record<SessionState, string> = {
  idle: 'bg-border-soft',
  thinking: 'bg-accent-400 df-pulse',
  generating: 'bg-status-generating',
  userInput: 'bg-status-input',
  needsAttention: 'bg-status-attention'
}
const STATE_BAR_UNKNOWN = 'bg-border-soft'

function relativeAge(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const sec = Math.max(0, Math.floor((now - then) / 1000))
  if (sec < 5) return 'now'
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  return `${day}d`
}

function formatTokens(n: number | undefined): string {
  if (!n || n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${n}`
}

/**
 * `lastStateAt` isn't declared on `SessionMeta` yet but may be populated by the
 * runtime (state tracker writes it when `state` flips). Read it defensively so
 * we can surface "time since last change" without a type break.
 */
function lastStateAt(session: SessionMeta): string | undefined {
  const raw = (session as unknown as { lastStateAt?: unknown }).lastStateAt
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

export default function SessionCard({
  session,
  index,
  active,
  onClick,
  onDestroy,
  onRestart,
  onEdit,
  onClone
}: Props) {
  const accent = session.accentColor || defaultAgentColor(session.id)
  const unread = useSessions((s) => !!s.unread[session.id] && !active)
  const renameSession = useSessions((s) => s.renameSession)

  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(session.name)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editingName) setDraftName(session.name)
  }, [session.name, editingName])

  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    }
  }, [editingName])

  const commitName = async (): Promise<void> => {
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== session.name) {
      await renameSession(session.id, trimmed)
    }
    setEditingName(false)
  }

  // Active card uses the agent's accent for a soft tinted ring. The left-edge
  // state bar (below) already provides the per-state cue, so when active we
  // drop the inset agent-colour rule and let the state bar sit flush. Inactive
  // cards still get the thin agent accent via the bar's `activeRing` tint.
  const cardStyle: React.CSSProperties = {
    borderRadius: 'var(--radius-md)',
    boxShadow: active ? `0 0 0 1px ${hexAlpha(accent, 0.28)}` : undefined
  }

  const barClass = session.state ? STATE_BAR_CLASS[session.state] : STATE_BAR_UNKNOWN
  // Live sub-status only makes sense while the agent is working — idle rows
  // stay quiet, and `userInput`/`needsAttention` already convey intent via the
  // bar + pill. Showing a stale "editing foo.ts" while idle would be misleading.
  const showSubStatus =
    (session.state === 'thinking' || session.state === 'generating') &&
    (!!session.subStatus || !!session.subTarget)
  const changedAt = lastStateAt(session)

  return (
    <div
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault()
        onEdit?.()
      }}
      style={cardStyle}
      className={`group relative cursor-pointer overflow-hidden border bg-bg-3 pl-3 pr-2.5 py-2 font-mono transition-[background,border,transform] duration-150 ease-out active:translate-y-px active:bg-bg-5 ${
        active
          ? 'border-transparent bg-bg-4'
          : 'border-border-soft hover:-translate-y-px hover:border-border-mid hover:bg-bg-4'
      }`}
    >
      {/* left edge state bar — the primary at-a-glance cue. Colour tracks the
          session's current state; idle is dim, thinking/generating pulse or
          glow, needsAttention burns red. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 w-[3px] ${barClass}`}
      />

      {/* row 1: avatar + name + (hover actions | kbd badge) */}
      <div className="flex items-start gap-2.5">
        <div className="relative">
          <AgentAvatar session={session} size={28} />
          {unread ? (
            <span
              className="df-pulse absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent-500 ring-2 ring-bg-3"
              title="new activity"
              aria-label="new activity"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            {editingName ? (
              <input
                ref={nameInputRef}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => void commitName()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void commitName()
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setDraftName(session.name)
                    setEditingName(false)
                  }
                }}
                className="min-w-0 flex-1 rounded-sm border border-accent-500 bg-bg-1 px-1.5 py-0 text-[13px] font-semibold tracking-tight text-text-1 outline-none"
              />
            ) : (
              <span
                className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-text-1"
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  setEditingName(true)
                }}
                title="double-click to rename"
              >
                {session.name}
              </span>
            )}
            <div className="flex shrink-0 items-center gap-0.5">
              {/* hover actions appear to the LEFT of the kbd badge so the
                  ⌘N shortcut hint is never covered by them */}
              <div className="flex gap-0.5 opacity-0 transition group-hover:opacity-100">
                {onClone ? (
                  <ActionBtn onClick={onClone} title="clone session" Icon={Copy} />
                ) : null}
                {onEdit ? (
                  <ActionBtn onClick={onEdit} title="edit agent" Icon={Edit3} />
                ) : null}
                {onRestart ? (
                  <ActionBtn onClick={onRestart} title="restart" Icon={RotateCw} />
                ) : null}
                <ActionBtn onClick={onDestroy} title="close" Icon={X} danger />
              </div>
              {index <= 9 ? (
                <span className="rounded-sm border border-border-soft bg-bg-2/80 px-1 py-0 text-[10px] leading-4 text-text-4">
                  {fmtShortcut(String(index === 9 ? 0 : index))}
                </span>
              ) : null}
            </div>
          </div>
          {session.description ? (
            <div className="truncate text-[11px] italic text-text-3">{session.description}</div>
          ) : (
            <div className="truncate text-[10px] text-text-4">/{session.id.slice(0, 6)}</div>
          )}
        </div>
      </div>

      {/* row 2: state pill + branch · model + time-since-last-change */}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
        <div className="flex min-w-0 items-center gap-1.5">
          <SessionStatePill state={session.state} />
          {session.branch ? (
            <span className="flex min-w-0 items-center gap-1 text-text-3">
              <span className="text-text-4">·</span>
              <GitBranch size={9} strokeWidth={1.75} className="shrink-0 text-text-4" />
              <span className="truncate">{session.branch}</span>
            </span>
          ) : null}
          {session.model ? (
            <>
              <span className="text-text-4">·</span>
              <span className="truncate text-text-3">{session.model}</span>
            </>
          ) : null}
        </div>
        {changedAt ? (
          <span
            className="shrink-0 tabular-nums text-text-4"
            title={`last state change ${changedAt}`}
          >
            {relativeAge(changedAt)}
          </span>
        ) : null}
      </div>

      {/* row 3: live sub-status — only rendered while the agent is actively
          working so it functions as a signal ("editing foo.ts", "running go
          test"), never as stale debris on an idle card. */}
      {showSubStatus ? (
        <div className="mt-1 flex min-w-0 items-center gap-1 truncate text-[10px] text-text-3">
          {session.subStatus ? (
            <span className="shrink-0 lowercase text-text-2">{session.subStatus}</span>
          ) : null}
          {session.subTarget ? (
            <>
              {session.subStatus ? <span className="text-text-4">·</span> : null}
              <span className="truncate font-mono text-text-3" title={session.subTarget}>
                {session.subTarget}
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      {/* row 4: cost + tokens — tabular nums so columns line up across cards */}
      <div
        className="mt-1 flex items-center gap-2 font-mono text-[10px] tabular-nums text-text-4"
        title={`input ${session.tokensIn ?? 0} tokens · output ${session.tokensOut ?? 0} tokens${
          session.cost != null ? ` · cost $${session.cost.toFixed(4)}` : ''
        }`}
      >
        {session.cost != null && session.cost > 0 ? (
          <>
            <span className="text-text-2">${session.cost.toFixed(2)}</span>
            <span className="text-text-4">·</span>
          </>
        ) : null}
        <span className="text-text-3">↓ {formatTokens(session.tokensIn)} in</span>
        <span className="text-text-3">↑ {formatTokens(session.tokensOut)} out</span>
      </div>
    </div>
  )
}

function ActionBtn({
  onClick,
  title,
  Icon,
  danger
}: {
  onClick: () => void
  title: string
  Icon: typeof X
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`rounded-sm bg-bg-1/85 p-1 text-text-3 transition hover:bg-bg-5 ${
        danger ? 'hover:text-status-attention' : 'hover:text-text-1'
      }`}
      title={title}
      aria-label={title}
    >
      <Icon size={11} strokeWidth={1.75} />
    </button>
  )
}
