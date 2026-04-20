import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Activity,
  Info,
  LayoutDashboard,
  RotateCw,
  Trash2,
  X
} from 'lucide-react'
import { useSessions } from '../state/sessions'
import type { SessionMeta } from '../../shared/types'
import { fmtShortcut } from '../lib/platform'
import SessionStatePill from './SessionStatePill'

interface Props {
  open: boolean
  onClose: () => void
  /** 'inline' renders a self-contained pane (no portal/backdrop). */
  mode?: 'inline' | 'overlay'
}

interface CardProps {
  session: SessionMeta
  onFocus: (id: string) => void
  onRestart: (id: string) => void
  onDestroy: (id: string) => void
}

function previewText(session: SessionMeta): string {
  const text = session.latestAssistantText
  if (text && text.trim().length > 0) return text
  return 'No assistant response yet for this session.'
}

function DashboardCard({ session, onFocus, onRestart, onDestroy }: CardProps) {
  const model = session.model ?? 'sonnet'

  return (
    <div className="df-lift flex flex-col gap-3 rounded-md border border-border-soft bg-bg-3 p-4 hover:border-border-mid hover:bg-bg-4">
      <div className="flex items-start justify-between gap-2">
        <SessionStatePill state={session.state} />
      </div>

      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-text-1">
          {session.name}
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-text-4">
          {model}
        </div>
      </div>

      <div className="line-clamp-4 min-h-[3.5rem] font-mono text-[11px] leading-relaxed text-text-3">
        {previewText(session)}
      </div>

      <div className="mt-auto flex items-center gap-1 border-t border-border-soft pt-2">
        <button
          type="button"
          onClick={() => onFocus(session.id)}
          className="flex items-center gap-1 rounded-sm p-1 text-text-3 hover:bg-bg-2 hover:text-text-1"
          title="focus"
        >
          <Activity size={12} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => onRestart(session.id)}
          className="flex items-center gap-1 rounded-sm p-1 text-text-3 hover:bg-bg-2 hover:text-text-1"
          title="restart"
        >
          <RotateCw size={12} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => onDestroy(session.id)}
          className="ml-auto flex items-center gap-1 rounded-sm p-1 text-text-3 hover:bg-bg-2 hover:text-status-attention"
          title="destroy"
        >
          <Trash2 size={12} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

export default function Dashboard({ open, onClose, mode = 'inline' }: Props) {
  const sessions = useSessions((s) => s.sessions)
  const setActive = useSessions((s) => s.setActive)
  const destroySession = useSessions((s) => s.destroySession)
  const [showExplainer, setShowExplainer] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const handleFocus = (id: string): void => {
    setActive(id)
    onClose()
  }
  const handleRestart = (id: string): void => {
    void window.api.session.restart(id)
  }
  const handleDestroy = (id: string): void => {
    void destroySession(id)
  }

  const grid = useMemo(() => {
    if (sessions.length === 0) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16">
          <LayoutDashboard size={32} strokeWidth={1.25} className="text-text-4" />
          <div className="text-sm text-text-2">no active sessions</div>
          <div className="text-xs text-text-4">spawn an agent to see it here.</div>
        </div>
      )
    }
    return (
      <div className="df-scroll grid flex-1 gap-3 overflow-y-auto pr-1 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))] [grid-auto-rows:min-content]">
        {sessions.map((s) => (
          <DashboardCard
            key={s.id}
            session={s}
            onFocus={handleFocus}
            onRestart={handleRestart}
            onDestroy={handleDestroy}
          />
        ))}
      </div>
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions])

  if (!open) return null

  const body = (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-bg-2">
      <header className="flex shrink-0 items-center justify-between border-b border-border-soft bg-bg-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <LayoutDashboard size={14} strokeWidth={1.75} className="text-accent-400" />
          <span className="font-semibold text-text-1">dashboard</span>
          <span className="font-mono text-[10px] text-text-4">
            · {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowExplainer((v) => !v)}
            className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-[10px] text-text-4 hover:bg-bg-3 hover:text-text-1"
            title="what is the dashboard?"
          >
            <Info size={11} strokeWidth={1.75} />
            what?
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1.5 text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="close"
            title="Esc"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {showExplainer ? (
        <div className="border-b border-border-soft bg-bg-1 px-4 py-3 text-[11px] leading-relaxed text-text-3">
          <p className="mb-1.5">
            <strong className="text-text-2">Dashboard</strong> — overview of every running agent
            at once. Each card shows live state (thinking, generating, awaiting input), model and
            the latest assistant response.
          </p>
          <p>
            Useful when you have several agents running in parallel and want to monitor them at a
            glance without cycling through {fmtShortcut('1')} / {fmtShortcut('2')} / {fmtShortcut('3')}.
            Click a card to focus that session — the dashboard closes and the main terminal
            switches to it.
          </p>
        </div>
      ) : null}

      <div className="flex flex-1 flex-col overflow-hidden p-3">{grid}</div>
    </div>
  )

  if (mode === 'inline') return body

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-bg-0/85 p-6 backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="df-fade-in mx-auto h-full max-w-[1280px] overflow-hidden rounded-lg border border-border-mid bg-bg-2 shadow-pop">
        {body}
      </div>
    </div>,
    document.body
  )
}
