import { GitBranch, X, RotateCw, Maximize2 } from 'lucide-react'
import type { SessionMeta } from '../../shared/types'
import SessionStatePill from './SessionStatePill'

interface Props {
  session: SessionMeta
  index: number
  active: boolean
  onClick: () => void
  onDestroy: () => void
  onRestart?: () => void
}

function relativeAge(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const sec = Math.max(0, Math.floor((now - then) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

function formatCost(c: number | undefined): string {
  if (!c || c <= 0) return '<$0.01'
  if (c < 0.01) return '<$0.01'
  if (c < 1) return `$${c.toFixed(2)}`
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
  onRestart
}: Props) {
  return (
    <div
      onClick={onClick}
      className={`group relative cursor-pointer rounded-md border px-2.5 py-2 transition-all df-lift ${
        active
          ? 'border-accent-500/70 bg-bg-4 shadow-[0_0_0_1px_rgba(124,136,255,0.2)]'
          : 'border-border-soft bg-bg-3 hover:border-border-mid hover:bg-bg-4'
      }`}
    >
      {/* row 1: state + name + index */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <SessionStatePill state={session.state} label={false} />
          <span className="truncate text-sm font-medium text-text-1">{session.name}</span>
        </div>
        {index <= 9 ? (
          <span className="shrink-0 rounded bg-bg-2 px-1.5 py-0.5 font-mono text-[10px] text-text-4">
            ⌘{index}
          </span>
        ) : null}
      </div>

      {/* compact meta row: branch · model · cost · age */}
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
        <div className="flex min-w-0 items-center gap-2 text-text-3">
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
      <div className="absolute right-2 top-2 flex gap-0.5 opacity-0 transition group-hover:opacity-100">
        {onRestart ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRestart()
            }}
            className="rounded bg-bg-2/80 p-1 text-text-3 hover:bg-bg-5 hover:text-text-1"
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
            onClick()
          }}
          className="rounded bg-bg-2/80 p-1 text-text-3 hover:bg-bg-5 hover:text-text-1"
          title="focus"
          aria-label="focus"
        >
          <Maximize2 size={11} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDestroy()
          }}
          className="rounded bg-bg-2/80 p-1 text-text-3 hover:bg-status-attention/20 hover:text-status-attention"
          title="close"
          aria-label="close"
        >
          <X size={11} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
