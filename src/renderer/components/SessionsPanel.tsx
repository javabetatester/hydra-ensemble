import { Plus, Activity, RefreshCw, Inbox } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSessions } from '../state/sessions'
import { useSpawnDialog } from '../state/spawn'
import SessionCard from './SessionCard'
import AgentEditDialog from './AgentEditDialog'
import type { SessionMeta } from '../../shared/types'

export default function SessionsPanel() {
  const sessions = useSessions((s) => s.sessions)
  const activeId = useSessions((s) => s.activeId)
  const setActive = useSessions((s) => s.setActive)
  const clone = useSessions((s) => s.cloneSession)
  const destroy = useSessions((s) => s.destroySession)
  const isCreating = useSessions((s) => s.isCreating)
  const openSpawn = useSpawnDialog((s) => s.show)

  const [tab, setTab] = useState<'sessions' | 'activity'>('sessions')
  const [editing, setEditing] = useState<SessionMeta | null>(null)

  // Re-render every 30s so the relative ages stay roughly fresh.
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-border-soft bg-bg-2">
      {/* header */}
      <header className="flex items-center justify-between border-b border-border-soft px-3 py-2">
        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => setTab('sessions')}
            className={`font-semibold transition-colors ${
              tab === 'sessions' ? 'text-text-1' : 'text-text-4 hover:text-text-2'
            }`}
          >
            Sessions
          </button>
          <button
            type="button"
            onClick={() => setTab('activity')}
            className={`text-xs transition-colors ${
              tab === 'activity' ? 'text-text-1' : 'text-text-4 hover:text-text-2'
            }`}
          >
            Activity
          </button>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => force((n) => n + 1)}
            className="rounded p-1 text-text-4 hover:bg-bg-3 hover:text-text-1"
            title="refresh"
            aria-label="refresh"
          >
            <RefreshCw size={13} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => openSpawn()}
            disabled={isCreating}
            className="rounded p-1 text-text-2 hover:bg-bg-3 hover:text-text-1 disabled:opacity-40"
            title="new session"
            aria-label="new session"
          >
            <Plus size={14} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {/* body — scrolls only when content overflows the available space */}
      <div className="df-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {tab === 'sessions' ? <SessionList /> : <ActivityList />}
      </div>

      {sessions.length > 0 ? (
        <footer className="flex shrink-0 items-center justify-center gap-3 border-t border-border-soft px-3 py-1 font-mono text-[10px] text-text-4">
          <span>⌘0–9 Jump</span>
          <span>⌘[ Prev</span>
          <span>⌘] Next</span>
        </footer>
      ) : null}

      <AgentEditDialog session={editing} onClose={() => setEditing(null)} />
    </aside>
  )

  function SessionList() {
    if (sessions.length === 0) {
      return (
        <button
          type="button"
          onClick={() => openSpawn()}
          disabled={isCreating}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-mid bg-bg-3/40 px-4 py-6 text-center transition hover:border-accent-500/40 hover:bg-bg-3 disabled:opacity-50"
        >
          <Inbox size={26} strokeWidth={1.25} className="text-text-4" />
          <div className="text-sm text-text-2">{isCreating ? 'spawning…' : 'no sessions'}</div>
          <div className="text-[11px] text-text-4">click to pick a project + worktree</div>
        </button>
      )
    }
    return (
      <div className="flex flex-col gap-1.5">
        {sessions.map((s, i) => (
          <SessionCard
            key={s.id}
            session={s}
            index={i + 1}
            active={s.id === activeId}
            onClick={() => setActive(s.id)}
            onDestroy={() => destroy(s.id)}
            onEdit={() => setEditing(s)}
            onClone={() => void clone(s.id)}
          />
        ))}
      </div>
    )
  }

  function ActivityList() {
    const recent = [...sessions]
      .filter((s) => s.latestAssistantText)
      .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
      .slice(0, 10)

    if (recent.length === 0) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
          <Activity size={32} strokeWidth={1.25} className="text-text-4" />
          <div className="text-sm text-text-2">no activity yet</div>
          <div className="text-xs text-text-4">assistant messages will appear here</div>
        </div>
      )
    }
    return (
      <div className="flex flex-col gap-2">
        {recent.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setTab('sessions')
              setActive(s.id)
            }}
            className="rounded-md border border-border-soft bg-bg-3 px-3 py-2 text-left transition df-lift hover:bg-bg-4"
          >
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="truncate font-medium text-text-1">{s.name}</span>
              <span className="text-text-4 font-mono">{s.model ?? '—'}</span>
            </div>
            <div className="line-clamp-3 font-mono text-[11px] leading-relaxed text-text-3">
              {s.latestAssistantText}
            </div>
          </button>
        ))}
      </div>
    )
  }
}
