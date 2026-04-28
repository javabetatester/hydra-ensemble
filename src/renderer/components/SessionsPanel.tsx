import { Plus, Activity, RefreshCw, Inbox, Folder } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSessions } from '../state/sessions'
import { useSpawnDialog } from '../state/spawn'
import { fmtShortcut } from '../lib/platform'
import SessionCard from './SessionCard'
import AgentEditDialog from './AgentEditDialog'
import type { SessionMeta, SessionState } from '../../shared/types'

type Filter = 'all' | 'yours' | 'working' | 'attention'

const FILTERS: Array<{ id: Filter; label: string; matches: (s: SessionMeta) => boolean }> = [
  { id: 'all', label: 'all', matches: () => true },
  {
    id: 'yours',
    label: 'your turn',
    matches: (s) => s.state === 'userInput' || s.state === 'idle'
  },
  {
    id: 'working',
    label: 'working',
    matches: (s) => s.state === 'thinking' || s.state === 'generating'
  },
  {
    id: 'attention',
    label: 'attention',
    matches: (s) => s.state === 'needsAttention'
  }
]

const FILTER_DOT: Record<Filter, string> = {
  all: 'bg-text-4',
  yours: 'bg-status-input',
  working: 'bg-status-generating',
  attention: 'bg-status-attention'
}

function countByFilter(sessions: SessionMeta[], filter: Filter): number {
  const fn = FILTERS.find((f) => f.id === filter)?.matches
  return fn ? sessions.filter(fn).length : sessions.length
}

export default function SessionsPanel() {
  const sessions = useSessions((s) => s.sessions)
  const activeId = useSessions((s) => s.activeId)
  const setActive = useSessions((s) => s.setActive)
  const clone = useSessions((s) => s.cloneSession)
  const destroy = useSessions((s) => s.destroySession)
  const isCreating = useSessions((s) => s.isCreating)
  const openSpawn = useSpawnDialog((s) => s.show)

  const [tab, setTab] = useState<'sessions' | 'activity'>('sessions')
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<SessionMeta | null>(null)

  const filtered = useMemo(() => {
    const fn = FILTERS.find((f) => f.id === filter)?.matches ?? (() => true)
    return sessions.filter(fn)
  }, [sessions, filter])

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
          {/* Keybind chip — discoverability for the panel-hide toggle.
              Lives next to Activity so the user always knows how to
              dismiss the column without scanning the help overlay. */}
          <span
            className="ml-1 rounded-sm border border-border-soft bg-bg-3 px-1 py-px font-mono text-[9px] uppercase text-text-4"
            title={`Hide sessions panel (${fmtShortcut('Q')})`}
          >
            {fmtShortcut('Q')}
          </span>
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
            data-tour-id="spawn-session"
            className="rounded p-1 text-text-2 hover:bg-bg-3 hover:text-text-1 disabled:opacity-40"
            title="new session"
            aria-label="new session"
          >
            <Plus size={14} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {/* segmented filter — slides between all / your-turn / working / attention */}
      {tab === 'sessions' && sessions.length > 0 ? (
        <FilterStrip
          active={filter}
          onPick={setFilter}
          counts={Object.fromEntries(
            FILTERS.map((f) => [f.id, countByFilter(sessions, f.id)])
          ) as Record<Filter, number>}
        />
      ) : null}

      {/* body — scrolls only when content overflows the available space */}
      <div className="df-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {tab === 'sessions' ? <SessionList /> : <ActivityList />}
      </div>

      {sessions.length > 0 ? (
        <footer className="flex shrink-0 items-center justify-center gap-3 border-t border-border-soft px-3 py-1 font-mono text-[10px] text-text-4">
          <span>{fmtShortcut('0–9')} Jump</span>
          <span>{fmtShortcut('[')} Prev</span>
          <span>{fmtShortcut(']')} Next</span>
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
    if (filtered.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-8 text-center">
          <span className={`h-2 w-2 rounded-full ${FILTER_DOT[filter]}`} />
          <div className="text-xs text-text-2">no sessions match this filter</div>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className="font-mono text-[10px] text-text-4 hover:text-text-1"
          >
            show all →
          </button>
        </div>
      )
    }

    // Group sessions by project (cwd)
    const groups = new Map<string, SessionMeta[]>()
    for (const s of filtered) {
      const key = s.worktreePath ?? s.cwd
      const bucket = groups.get(key)
      if (bucket) bucket.push(s)
      else groups.set(key, [s])
    }
    const groupEntries = Array.from(groups.entries())
    const multipleGroups = groupEntries.length > 1

    return (
      <div className="flex flex-col gap-1.5">
        {groupEntries.map(([projectPath, items], gi) => {
          const label = projectPath.split('/').filter(Boolean).pop() || projectPath
          return (
            <div key={projectPath} className="flex flex-col gap-1.5">
              {multipleGroups && (
                <>
                  {gi > 0 && (
                    <div className="my-1 border-t border-border-soft" />
                  )}
                  <div className="flex items-center gap-1.5 px-1 py-0.5">
                    <Folder size={11} strokeWidth={1.75} className="shrink-0 text-text-4" />
                    <span className="truncate text-[10px] font-medium text-text-3" title={projectPath}>
                      {label}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] text-text-4">{items.length}</span>
                  </div>
                </>
              )}
              {items.map((s) => {
                const realIndex = sessions.findIndex((x) => x.id === s.id)
                return (
                  <SessionCard
                    key={s.id}
                    session={s}
                    index={realIndex + 1}
                    active={s.id === activeId}
                    onClick={() => setActive(s.id)}
                    onDestroy={() => destroy(s.id)}
                    onEdit={() => setEditing(s)}
                    onClone={() => void clone(s.id)}
                  />
                )
              })}
            </div>
          )
        })}
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

function FilterStrip({
  active,
  onPick,
  counts
}: {
  active: Filter
  onPick: (f: Filter) => void
  counts: Record<Filter, number>
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b border-border-soft px-2 py-1.5">
      {FILTERS.map((f) => {
        const isActive = active === f.id
        const n = counts[f.id]
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onPick(f.id)}
            className={`flex items-center gap-1.5 rounded-sm px-2 py-1 text-[10px] transition ${
              isActive
                ? 'bg-bg-4 text-text-1'
                : 'text-text-3 hover:bg-bg-3 hover:text-text-1'
            }`}
            title={`${f.label} (${n})`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${FILTER_DOT[f.id]}`} aria-hidden />
            <span>{f.label}</span>
            <span className="font-mono text-text-4">{n}</span>
          </button>
        )
      })}
    </div>
  )
}
