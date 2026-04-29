import { Plus, X } from 'lucide-react'
import { useSessions } from '../state/sessions'
import { useSpawnDialog } from '../state/spawn'
import SessionStatePill from './SessionStatePill'

export default function SessionTabs() {
  const sessions = useSessions((s) => s.sessions)
  const activeId = useSessions((s) => s.activeId)
  const setActive = useSessions((s) => s.setActive)
  const destroy = useSessions((s) => s.destroySession)
  const isCreating = useSessions((s) => s.isCreating)
  const openSpawn = useSpawnDialog((s) => s.show)

  if (sessions.length === 0) {
    return (
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border-soft bg-bg-1 px-3">
        <button
          type="button"
          onClick={() => openSpawn()}
          disabled={isCreating}
          className="df-lift inline-flex items-center gap-1.5 rounded-md bg-accent-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-600 disabled:opacity-50"
        >
          <Plus size={14} strokeWidth={1.75} />
          <span>{isCreating ? 'creating…' : 'new claude session'}</span>
        </button>
        <span className="text-xs text-text-4">no sessions yet</span>
      </div>
    )
  }

  return (
    <div className="df-scroll flex h-9 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border-soft bg-bg-1 pl-1 pr-2">
      {sessions.map((s) => {
        const active = s.id === activeId
        return (
          <div
            key={s.id}
            className={`group relative flex shrink-0 items-center gap-2 px-3 text-xs transition-colors ${
              active
                ? 'border-t-2 border-accent-500 bg-bg-1 text-text-1 -mt-px'
                : 'mt-0.5 border-t-2 border-transparent text-text-3 hover:bg-bg-2 hover:text-text-2'
            }`}
          >
            <button
              type="button"
              onClick={() => setActive(s.id)}
              className="flex items-center gap-2 py-1.5"
              title={`${s.name} · ${s.claudeConfigDir}`}
            >
              <SessionStatePill state={s.state} label={false} />
              <span className={active ? 'font-medium' : ''}>{s.name}</span>
            </button>
            <button
              type="button"
              onClick={() => destroy(s.id)}
              className="df-hover-reveal flex h-4 w-4 items-center justify-center rounded text-text-4 hover:bg-bg-3 hover:text-status-attention group-hover:opacity-100"
              title="close session"
              aria-label="close session"
            >
              <X size={12} strokeWidth={1.75} />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => openSpawn()}
        disabled={isCreating}
        className="ml-1 inline-flex shrink-0 items-center gap-1 self-center rounded-sm px-2 py-1 text-xs text-text-3 transition-colors hover:bg-bg-3 hover:text-text-1 disabled:opacity-50"
        title="new session"
        aria-label="new session"
      >
        <Plus size={14} strokeWidth={1.75} />
      </button>
    </div>
  )
}
