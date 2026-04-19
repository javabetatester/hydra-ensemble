import { GitBranch, X, RotateCw, Edit3 } from 'lucide-react'
import type { SessionMeta } from '../../shared/types'
import SessionStatePill from './SessionStatePill'
import AgentAvatar from './AgentAvatar'
import { defaultAgentColor, hexAlpha } from '../lib/agent'

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
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  return `${day}d`
}

function formatCost(c: number | undefined): string {
  if (!c || c <= 0) return '<$0.01'
  if (c < 0.01) return '<$0.01'
  return `$${c.toFixed(2)}`
}

function shortModel(m: string | undefined): string {
  if (!m) return '—'
  return m
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
  return (
    <div
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault()
        onEdit?.()
      }}
      className={`group relative cursor-pointer overflow-hidden border bg-bg-3 px-2.5 py-2 transition-all df-lift ${
        active ? 'border-transparent bg-bg-4 df-glow-accent' : 'border-border-soft hover:border-border-mid hover:bg-bg-4'
      }`}
      style={{
        borderRadius: 'var(--radius-md)',
        ...(active ? { boxShadow: `inset 3px 0 0 0 ${accent}, 0 0 0 1px ${hexAlpha(accent, 0.35)}` } : {})
      }}
    >
      {/* row 1: avatar + name + index */}
      <div className="flex items-start gap-2.5">
        <AgentAvatar session={session} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-semibold tracking-tight text-text-1">
              {session.name}
            </span>
            {index <= 9 ? (
              <span className="shrink-0 rounded-sm border border-border-soft bg-bg-2 px-1.5 py-0.5 font-mono text-[10px] text-text-4">
                ⌘{index === 9 ? 0 : index}
              </span>
            ) : null}
          </div>
          {session.description ? (
            <div className="truncate text-[11px] italic text-text-3">{session.description}</div>
          ) : null}
        </div>
      </div>

      {/* row 2: state + sub-status */}
      <div className="mt-1.5 flex items-center gap-2">
        <SessionStatePill state={session.state} />
        {session.subStatus ? (
          <span className="truncate font-mono text-[10px] text-text-3">
            {session.subStatus}
            {session.subTarget ? (
              <span className="text-text-4"> · {session.subTarget}</span>
            ) : null}
          </span>
        ) : null}
      </div>

      {/* row 3: meta */}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
        <div className="flex min-w-0 items-center gap-1.5 text-text-3">
          {session.branch ? (
            <span className="flex min-w-0 items-center gap-1">
              <GitBranch size={10} strokeWidth={1.75} className="shrink-0 text-text-4" />
              <span className="truncate font-mono">{session.branch}</span>
            </span>
          ) : (
            <span className="text-text-4">no branch</span>
          )}
          <span className="text-text-4">·</span>
          <span className="font-mono text-text-3">{shortModel(session.model)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 font-mono text-text-4">
          <span
            className={session.cost && session.cost > 0 ? 'text-status-generating' : 'text-text-4'}
          >
            {formatCost(session.cost)}
          </span>
          <span>·</span>
          <span>{relativeAge(session.createdAt)}</span>
        </div>
      </div>

      {/* hover actions */}
      <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition group-hover:opacity-100">
        {onEdit ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            className="rounded-sm bg-bg-1/90 p-1 text-text-3 hover:bg-bg-5 hover:text-text-1"
            title="edit agent"
            aria-label="edit agent"
          >
            <Edit3 size={11} strokeWidth={1.75} />
          </button>
        ) : null}
        {onRestart ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRestart()
            }}
            className="rounded-sm bg-bg-1/90 p-1 text-text-3 hover:bg-bg-5 hover:text-text-1"
            title="restart"
            aria-label="restart"
          >
            <RotateCw size={11} strokeWidth={1.75} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDestroy()
          }}
          className="rounded-sm bg-bg-1/90 p-1 text-text-3 hover:bg-status-attention/20 hover:text-status-attention"
          title="close"
          aria-label="close"
        >
          <X size={11} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
