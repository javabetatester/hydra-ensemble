import { useMemo } from 'react'
import { GitBranch, Hash, Activity, Network, Loader2, Inbox } from 'lucide-react'
import { useSessions } from '../state/sessions'
import { useOrchestra } from '../orchestra/state/orchestra'
import type { SessionMeta } from '../../shared/types'
import SessionStatePill from './SessionStatePill'

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return `${count}`
}

function activeBranch(active: SessionMeta | undefined): string {
  if (!active) return 'main'
  if (active.branch && active.branch.length > 0) return active.branch
  if (active.worktreePath) {
    const parts = active.worktreePath.split(/[\\/]/).filter(Boolean)
    const last = parts[parts.length - 1]
    if (last) return last
  }
  return 'main'
}

export default function StatusBar() {
  const sessions = useSessions((s) => s.sessions)
  const activeId = useSessions((s) => s.activeId)

  const orchestraEnabled = useOrchestra((s) => s.settings.enabled)
  const teamsCount = useOrchestra((s) => s.teams.length)
  const runningAgentsCount = useOrchestra(
    (s) => s.agents.filter((a) => a.state === 'running').length
  )
  const queuedTasksCount = useOrchestra(
    (s) => s.tasks.filter((t) => t.status === 'queued').length
  )
  const setOrchestraOverlayOpen = useOrchestra((s) => s.setOverlayOpen)

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId),
    [sessions, activeId]
  )

  const totals = useMemo(() => {
    let tokensIn = 0
    let tokensOut = 0
    for (const s of sessions) {
      tokensIn += s.tokensIn ?? 0
      tokensOut += s.tokensOut ?? 0
    }
    return { tokensIn, tokensOut }
  }, [sessions])

  const branch = activeBranch(active)
  const model = active?.model ?? 'sonnet'
  const sessionCount = sessions.length

  return (
    <div
      className="flex h-6 shrink-0 items-center gap-3 border-t border-border-soft bg-bg-2 px-3 font-mono text-[10px] text-text-3"
      role="status"
    >
      {active ? (
        <>
          <Cell label="branch" icon={<GitBranch size={10} strokeWidth={1.75} />}>
            <span className="text-text-2">{branch}</span>
          </Cell>
          <Sep />
          <Cell label="model" icon={<Activity size={10} strokeWidth={1.75} />}>
            <span className="text-text-2">{model}</span>
          </Cell>
          <Sep />
          <SessionStatePill state={active.state ?? 'idle'} />
        </>
      ) : (
        <span className="flex items-center gap-2 text-text-4">
          <span className="h-1.5 w-1.5 rounded-sm bg-text-4" />
          <span>no active session</span>
        </span>
      )}

      <span className="ml-auto flex items-center gap-3 tabular-nums">
        {sessionCount > 0 ? (
          <>
            <Cell label="tokens" icon={<Hash size={10} strokeWidth={1.75} />}>
              <span className="text-text-2">{formatTokens(totals.tokensIn)}</span>
              <span className="text-text-4">↓</span>
              <span className="text-text-2">{formatTokens(totals.tokensOut)}</span>
              <span className="text-text-4">↑</span>
            </Cell>
            <Sep />
          </>
        ) : null}

        <span className="flex items-center gap-1">
          <span className="text-text-4">sessions</span>
          <span className="text-text-2">{sessionCount}</span>
        </span>

        {orchestraEnabled ? (
          <>
            <Sep />
            <button
              type="button"
              onClick={() => setOrchestraOverlayOpen(true)}
              className="flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 transition-colors hover:bg-bg-3"
              title="Open Orchestra"
              aria-label="Open Orchestra — teams"
            >
              <span className="text-text-4">
                <Network size={10} strokeWidth={1.75} />
              </span>
              <span className="text-text-4">teams</span>
              <span className="text-text-2">{teamsCount}</span>
            </button>
            <button
              type="button"
              onClick={() => setOrchestraOverlayOpen(true)}
              className="flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 transition-colors hover:bg-bg-3"
              title="Open Orchestra"
              aria-label="Open Orchestra — running agents"
            >
              <span className="relative flex items-center text-text-4">
                <Loader2 size={10} strokeWidth={1.75} />
                {runningAgentsCount > 0 ? (
                  <span
                    className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-accent-500"
                    aria-hidden
                  />
                ) : null}
              </span>
              <span className="text-text-4">running agents</span>
              <span className="text-text-2">{runningAgentsCount}</span>
            </button>
            <button
              type="button"
              onClick={() => setOrchestraOverlayOpen(true)}
              className="flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 transition-colors hover:bg-bg-3"
              title="Open Orchestra"
              aria-label="Open Orchestra — queued tasks"
            >
              <span className="text-text-4">
                <Inbox size={10} strokeWidth={1.75} />
              </span>
              <span className="text-text-4">queued tasks</span>
              <span className="text-text-2">{queuedTasksCount}</span>
            </button>
          </>
        ) : null}
      </span>
    </div>
  )
}

function Cell({
  label,
  icon,
  children,
  className
}: {
  label: string
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <span className={`flex items-center gap-1.5 ${className ?? ''}`}>
      {icon ? <span className="text-text-4">{icon}</span> : null}
      <span className="text-text-4">{label}</span>
      {children}
    </span>
  )
}

function Sep() {
  return <span className="text-text-4">|</span>
}
