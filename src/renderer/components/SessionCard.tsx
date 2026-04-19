import { GitBranch, X, RotateCw, Edit3 } from 'lucide-react'
import type { SessionMeta } from '../../shared/types'
import SessionStatePill from './SessionStatePill'
import AgentAvatar from './AgentAvatar'
import { defaultAgentColor, hexAlpha } from '../lib/agent'
import { fmtShortcut } from '../lib/platform'

interface Props {
  session: SessionMeta
  index: number
  active: boolean
  onClick: () => void
  onDestroy: () => void
  onRestart?: () => void
  onEdit?: () => void
}

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

function formatCost(c: number | undefined): string {
  if (!c || c <= 0) return '—'
  if (c < 0.01) return '<$.01'
  return `$${c.toFixed(2)}`
}

export default function SessionCard({
  session,
  index,
  active,
  onClick,
  onDestroy,
  onRestart,
  onEdit
}: Props) {
  const accent = session.accentColor || defaultAgentColor(session.id)

  // Active card uses the agent's accent for a left rule + soft tinted ring.
  // No global df-glow-accent so the colour respects the per-agent identity
  // (previous coral hardcoded glow looked broken on a violet/purple agent).
  const cardStyle: React.CSSProperties = {
    borderRadius: 'var(--radius-md)',
    boxShadow: active
      ? `inset 3px 0 0 0 ${accent}, 0 0 0 1px ${hexAlpha(accent, 0.28)}`
      : undefined
  }

  return (
    <div
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault()
        onEdit?.()
      }}
      style={cardStyle}
      className={`group relative cursor-pointer overflow-hidden border bg-bg-3 px-2.5 py-2 font-mono transition-[background,border,transform] duration-150 ease-out active:translate-y-px active:bg-bg-5 ${
        active
          ? 'border-transparent bg-bg-4'
          : 'border-border-soft hover:-translate-y-px hover:border-border-mid hover:bg-bg-4'
      }`}
    >
      {/* row 1: avatar + name + (hover actions | kbd badge) */}
      <div className="flex items-start gap-2.5">
        <AgentAvatar session={session} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-semibold tracking-tight text-text-1">
              {session.name}
            </span>
            <div className="flex shrink-0 items-center gap-0.5">
              {/* hover actions appear to the LEFT of the kbd badge so the
                  ⌘N shortcut hint is never covered by them */}
              <div className="flex gap-0.5 opacity-0 transition group-hover:opacity-100">
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

      {/* row 2: state + sub-status */}
      <div className="mt-1.5 flex min-h-[16px] items-center gap-1.5 text-[10px]">
        <SessionStatePill state={session.state} />
        {session.subStatus ? (
          <span className="flex min-w-0 items-center gap-1 truncate text-text-3">
            <span className="text-text-4">›</span>
            <span>{session.subStatus}</span>
            {session.subTarget ? (
              <span className="truncate text-text-2">{session.subTarget}</span>
            ) : null}
          </span>
        ) : null}
      </div>

      {/* row 3: meta */}
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-text-4">
        <div className="flex min-w-0 items-center gap-1.5">
          {session.branch ? (
            <span className="flex min-w-0 items-center gap-1 text-text-3">
              <GitBranch size={9} strokeWidth={1.75} className="shrink-0 text-text-4" />
              <span className="truncate">{session.branch}</span>
            </span>
          ) : null}
          {session.model ? (
            <>
              {session.branch ? <span>·</span> : null}
              <span className="text-text-3">{session.model}</span>
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 tabular-nums">
          <span
            className={session.cost && session.cost > 0 ? 'text-status-generating' : 'text-text-4'}
          >
            {formatCost(session.cost)}
          </span>
          <span>·</span>
          <span>{relativeAge(session.createdAt)}</span>
        </div>
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
