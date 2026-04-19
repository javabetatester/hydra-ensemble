import { useMemo } from 'react'
import { GitBranch, DollarSign, Hash, Activity } from 'lucide-react'
import { useSessions } from '../state/sessions'
import type { SessionMeta } from '../../shared/types'
import SessionStatePill from './SessionStatePill'

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return `${count}`
}

function formatCost(value: number): string {
  return value.toFixed(2)
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

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId),
    [sessions, activeId]
  )

  const totals = useMemo(() => {
    let cost = 0
    let tokensIn = 0
    let tokensOut = 0
    for (const s of sessions) {
      cost += s.cost ?? 0
      tokensIn += s.tokensIn ?? 0
      tokensOut += s.tokensOut ?? 0
    }
    return { cost, tokensIn, tokensOut }
  }, [sessions])

  const branch = activeBranch(active)
  const model = active?.model ?? 'sonnet'
  const sessionCount = sessions.length
  const hasCost = totals.cost > 0

  return (
    <div
      className="flex h-7 shrink-0 items-center gap-4 border-t border-border-soft bg-bg-2 px-3 text-[11px] text-text-3"
      role="status"
    >
      {active ? (
        <>
          <span className="flex items-center gap-1.5 font-mono text-text-2" title="current branch">
            <GitBranch size={12} strokeWidth={1.75} className="text-text-4" />
            <span className="truncate">{branch}</span>
          </span>
          <span className="flex items-center gap-1.5" title="model">
            <Activity size={12} strokeWidth={1.75} className="text-text-4" />
            <span className="font-mono text-text-2">{model}</span>
          </span>
          <SessionStatePill state={active.state ?? 'idle'} />
        </>
      ) : (
        <span className="flex items-center gap-2 text-text-4">
          <span className="h-1.5 w-1.5 rounded-full bg-text-4" />
          <span>no active session</span>
        </span>
      )}

      <span className="ml-auto flex items-center gap-4">
        {sessionCount > 0 ? (
          <>
            <span
              title="aggregate input/output tokens"
              className="flex items-center gap-1.5 font-mono tabular-nums"
            >
              <Hash size={12} strokeWidth={1.75} className="text-text-4" />
              <span className="text-text-2">{formatTokens(totals.tokensIn)}</span>
              <span className="text-text-4">in</span>
              <span className="text-text-2">{formatTokens(totals.tokensOut)}</span>
              <span className="text-text-4">out</span>
            </span>

            <span
              title="aggregate cost across all sessions"
              className={`flex items-center gap-1 font-mono tabular-nums ${
                hasCost ? 'text-status-generating' : 'text-text-3'
              }`}
            >
              <DollarSign size={12} strokeWidth={1.75} />
              <span>{formatCost(totals.cost)}</span>
            </span>
          </>
        ) : null}

        <span title="active sessions" className="flex items-center gap-1.5">
          <span className="font-mono tabular-nums text-text-2">{sessionCount}</span>
          <span className="text-text-4">
            {sessionCount === 1 ? 'session' : 'sessions'}
          </span>
        </span>
      </span>
    </div>
  )
}
